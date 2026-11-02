---
name: verify-submission-state
description: Verify AnoMe's daily IP quota, idempotent submission retry, and hide/delete accounting when changing submission SQL, question identity, quota counting, or publish/hide/delete behavior.
---

# Verify submission state

Use this skill for changes to `src/sql.ts`, the `/api/questions` submission and administrator mutation handlers in `src/index.ts`, or question constraints in `migrations/0001_initial.sql`.

## The promises

- A successful new submission cannot exceed the IP's daily quota. Breaking this lets concurrent requests bypass the configured limit.
- Retrying one checked submission returns the existing question without another row or quota charge. Breaking this causes duplicate questions or request failures when requests race.
- Hiding and deletion retain the submission identity and quota day. Deletion erases question content and cannot be undone by a delayed reply.
- Hidden-policy changes invalidate stale checks at the atomic INSERT boundary; public and hidden search indexes match visibility.
- Bulk deletion executes the same `deleteQuestion` SQL once per selected ID inside one D1 batch. API tests cover selection validation, authentication, marks cleanup and per-question audit records; the explorer covers the underlying deletion transition.

## Run

From the repository root:

```sh
npm run verify:state
npm run verify:mutations
```

Prefix commands with `rtk proxy` when the environment requires RTK. There are no Python package dependencies. The confirmed toolchain is Python 3.13.0 and its SQLite 3.45.3; SQLite must support `RETURNING` (3.35+).

`verification/check_state.py` reads the actual production template literals from `src/sql.ts` and executes them in SQLite. It explores every reachable serial order within these bounds: one IP, three distinct checked-submission IDs, two monotonically ordered days, daily limit two, and pending/answered/archived/deleted question states, and current/stale hidden-policy checks. Passing output is 986 states and 12805 transitions.

The question is about ordering of atomic database writes, so this uses SQLite itself and a bounded exhaustive explorer. Each modeled submission is exactly the single `insertSubmission` SQL statement. Publication, hide, restore and delete represent the effect of their D1 batch transaction on question rows. Earlier quota and existence reads are deliberately non-authoritative: concurrent requests can already have read the same old state before either write executes.

Run the Workers API tests with `npm test` as well when changing handlers, receipts, authentication, search visibility, or timezone handling. Those tests cover the surrounding real Worker code that the SQL explorer does not execute.

## Read failures

A failure prints the shortest sequence. Use the actual code and SQL to decide whether it is a product bug or a stale verification mapping.

- `submit A -> submit B -> submit C`: three successes with a limit of two. Inspect the condition inside the INSERT; a separate preceding SELECT does not enforce concurrency.
- `submit A -> submit A`: two already-started requests reach the INSERT for the same checked ID. A uniqueness error means retry conflict handling broke.
- `submit A -> archive A`: archiving removed the persisted submission or its quota history.

`verification/check_mutations.py` copies production source, migration and checker into a temporary scratch directory, changes the real SQL there, and requires each broken variant to fail with a counterexample. It detects eight mutations: missing quota predicate, missing `ON CONFLICT`, hide deleting quota history, missing hidden-policy revision guard, delete retaining text, delayed reply resurrecting deleted content, public search exposing hidden questions, and hidden search losing hidden questions. It does not mutate the working source. An optional directory argument places the scratch copy in the task's `work/` directory.

If SQL declarations or bind positions change, update the extraction/mapping to the new production statements and review every invariant. A parser mismatch or missing mutation target is a verification error. A reachable invariant failure is a finding: report the request sequence and user-visible harm; do not weaken the invariant to get a pass. Change product behavior only within the user's authorized task.

## Scope and assumptions

This is bounded exhaustive checking of production SQL, not an unbounded proof or a proof of the whole application. It assumes SQLite/D1 executes each write atomically and each administrator batch transaction commits together. It excludes provider/network failures, HTTP parsing, signing, browser storage, arbitrary quota sizes, administrator limit changes during an in-flight submission, and the calendar mapping of dates. Actual D1 concurrency, timezone boundaries, model failures and public visibility are covered separately by Workers tests and deployment checks.

## Coverage and synchronization

Coverage synchronized on 2026-11-02 for the v2026 public-pending, hidden-policy, Mark and bulk-deletion update. Rerun the checks whenever covered code changes.

| Production code | Verification mapping |
| --- | --- |
| `src/sql.ts`: `insertSubmission` | Atomic conditional insert, stable checked ID, conflict handling and quota day |
| `src/sql.ts`: `publishQuestion`, `archiveQuestion`, `restoreQuestion`, `deleteQuestion` | Question-state transitions and retained quota history |
| `src/index.ts`: submission and administrator mutation handlers | Preliminary reads may race; SQL write / D1 batch is the atomic boundary |
| `migrations/*.sql`: questions, settings and search triggers | Primary key, status, quota-counted rows, hidden-policy revision and index visibility |

When a covered file changes after this synchronization, review this mapping before trusting a pass. Run both checks; confirm all scratch mutations fail; then rerun the unchanged production checker and applicable API tests. Advance the synchronization commit only after confirming the verification still describes that code.

This workflow follows the user-provided pstack `create-formal-verification-skill` constraint. For later changes that bypassed this check, use `/maintain-formal-verification-skill` to bring the coverage record back in line. This checker uses SQLite rather than a TLA+ model, so no `/statechart` tool invocation is required.
