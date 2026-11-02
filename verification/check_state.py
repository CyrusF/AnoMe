"""Exhaustively execute the production SQL over a bounded state space.

No translated quota function: SQL is extracted directly from src/sql.ts.
SQLite serializes each write statement; enumerating all orders covers writes
from requests whose earlier, non-authoritative quota/existence reads raced.
"""
from collections import deque
from pathlib import Path
import re
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/sql.ts"
IDS = ("A", "B", "C")
DAYS = ("2026-11-01", "2026-11-02")
LIMIT = 2


def statements():
    text = SOURCE.read_text()
    return {name: re.search(r"export const " + name + r"\s*=\s*`([\s\S]*?)`;", text).group(1)
            for name in ("insertSubmission", "publishQuestion", "archiveQuestion", "restoreQuestion", "deleteQuestion")}


def connection(rows):
    db = sqlite3.connect(":memory:")
    for migration in sorted((ROOT / "migrations").glob('*.sql')):
        db.executescript(migration.read_text())
    db.execute("UPDATE settings SET value=? WHERE key='daily_limit'", (str(LIMIT),))
    for identity, day, status, deleted in rows:
        db.execute("INSERT INTO questions(id,question,status,ip_hash,quota_day,receipt_hash,created_at,updated_at,request_id,deleted_at,search_tokens) VALUES(?,?,?,'ip',?,'receipt','now','now','request',?,?)",
                   (identity, '' if deleted else 'question', status, day, deleted, '' if deleted else 'question'))
    # Equality with a checked revision is all the INSERT observes. Normalize
    # the current revision to zero; a stale credential is represented by -1.
    db.execute("UPDATE settings SET value='0' WHERE key='hidden_revision'")
    return db


def verify():
    sql = statements()
    # State: current day; persisted rows; identities successfully accepted, with
    # their original quota day. Acceptance history must survive archiving.
    start = (0, (), (), False)
    queue = deque([(start, [])])
    visited = {start}
    transitions = 0
    while queue:
        (day_index, rows, history, policy_changed), trace = queue.popleft()
        actions = [("submit", identity) for identity in IDS]
        if policy_changed:
            actions += [("stale_submit", identity) for identity in IDS]
        actions += [(action, row[0]) for row in rows if not row[3]
                    for action in ("publish", "archive", "restore", "delete")]
        # A delayed reply can still arrive after deletion.
        actions += [("publish", row[0]) for row in rows if row[3]]
        if day_index == 0:
            actions.append(("next_day", ""))
        for action, identity in actions:
            transitions += 1
            db = connection(rows)
            accepted = dict(history)
            next_day = day_index
            step = action + (" " + identity if identity else "")
            try:
                if action in ("submit", "stale_submit"):
                    result = db.execute(sql["insertSubmission"],
                        (identity, "question", "ip", DAYS[day_index], "receipt", "now", "request", "question", -1 if action == 'stale_submit' else 0)).fetchall()
                    exists = db.execute("SELECT id FROM questions WHERE id=?", (identity,)).fetchone()
                    if action == 'stale_submit':
                        assert not result, "an outdated hidden-policy check allowed a new submission"
                    if identity in accepted:
                        assert exists and not result, "a retried submission must succeed with the existing identity and add no row"
                    elif result:
                        accepted[identity] = DAYS[day_index]
                elif action == "publish":
                    db.execute(sql["publishQuestion"], ("answer", "now", identity))
                elif action == "archive":
                    db.execute(sql["archiveQuestion"], ("now", identity))
                elif action == "restore":
                    db.execute(sql["restoreQuestion"], ("now", identity))
                elif action == "delete":
                    db.execute(sql["deleteQuestion"], ("now", identity))
                else:
                    next_day = 1
                new_rows = tuple(db.execute("SELECT id,quota_day,status,deleted_at FROM questions ORDER BY id"))
                assert set(accepted) == {row[0] for row in new_rows}, "hiding/deletion must retain each accepted identity and its quota charge"
                for day in DAYS:
                    assert sum(1 for value in accepted.values() if value == day) <= LIMIT, "successful submissions exceeded the per-IP daily quota"
                assert all(accepted[row[0]] == row[1] for row in new_rows), "an existing submission changed its quota day"
                for deleted in (row for row in new_rows if row[3]):
                    content = db.execute('SELECT question,answer,search_tokens FROM questions WHERE id=?', (deleted[0],)).fetchone()
                    assert content == ('', None, ''), "deleted question content was retained or restored"
                    assert deleted[2] == 'archived', "a delayed reply restored a deleted question"
                public_ids = {row[0] for row in db.execute('SELECT question_id FROM question_search')}
                hidden_ids = {row[0] for row in db.execute('SELECT question_id FROM hidden_question_search')}
                assert public_ids == {row[0] for row in new_rows if row[2] != 'archived' and not row[3]}, "public search includes hidden/deleted questions or omits a visible one"
                assert hidden_ids == {row[0] for row in new_rows if row[2] == 'archived' and not row[3]}, "hidden-policy search is out of sync with question visibility"
                changed = policy_changed or int(db.execute("SELECT value FROM settings WHERE key='hidden_revision'").fetchone()[0]) > 0
                next_state = (next_day, new_rows, tuple(sorted(accepted.items())), changed)
                if next_state not in visited:
                    visited.add(next_state)
                    queue.append((next_state, trace + [step]))
            except (AssertionError, sqlite3.Error) as error:
                print("FAIL:", error)
                print("Shortest counterexample:", " -> ".join(trace + [step]))
                return False
            finally:
                db.close()
    print(f"PASS: {len(visited)} states, {transitions} transitions; 1 IP, 3 submission IDs, 2 days, limit {LIMIT}.")
    print("Properties: quota, idempotent retry, retained quota history, stale hidden-policy rejection, deletion erasure, no resurrection, and search visibility.")
    print("Scope: real SQLite statements and all serial write orders within these bounds; excludes HTTP, AI, cookies, D1 outages, and a proof for arbitrary bounds.")
    return True


if __name__ == "__main__":
    sys.exit(0 if verify() else 1)
