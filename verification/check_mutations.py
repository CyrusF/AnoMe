"""Prove the state check detects broken production SQL in a scratch checkout."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
original = (ROOT / 'src/sql.ts').read_text()
quota_guard = "WHERE (SELECT count(*) FROM questions WHERE ip_hash=?3 AND quota_day=?4)\n    < CAST((SELECT value FROM settings WHERE key='daily_limit') AS INTEGER)"
mutants = {
    'quota guard removed': original.replace(quota_guard, 'WHERE 1=1'),
    'retry conflict handling removed': original.replace('ON CONFLICT(id) DO NOTHING', ''),
    'hide incorrectly deletes quota history': original.replace(
        "UPDATE questions SET status='archived',updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",
        "DELETE FROM questions WHERE id=?2 AND ?1 IS NOT NULL"),
    'hidden policy revision guard removed': original.replace("AND CAST((SELECT value FROM settings WHERE key='hidden_revision') AS INTEGER)=?9", "AND ?9 IS NOT NULL"),
    'delete retains question text': original.replace("SET question='',answer=NULL", "SET question=question,answer=NULL"),
    'delayed reply restores deleted question': original.replace("WHERE id=?3 AND deleted_at IS NULL", "WHERE id=?3"),
}
scratch_parent = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if scratch_parent:
    scratch_parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='anome-state-', dir=scratch_parent) as temporary:
    scratch = Path(temporary)
    for directory in ('src', 'migrations', 'verification'):
        shutil.copytree(ROOT / directory, scratch / directory)
    for name, changed in mutants.items():
        assert changed != original, f'Mutation no longer matches production SQL: {name}'
        (scratch / 'src/sql.ts').write_text(changed)
        result = subprocess.run([sys.executable, str(scratch / 'verification/check_state.py')], capture_output=True, text=True)
        if result.returncode == 0:
            print('FAIL: verification missed:', name)
            sys.exit(1)
        if 'Shortest counterexample:' not in result.stdout:
            print(result.stdout, result.stderr)
            sys.exit('FAIL: mutation caused an infrastructure error rather than a counterexample')
        print('CAUGHT:', name)
        print(result.stdout.strip())
    (scratch / 'src/sql.ts').write_text(original)
    migration_name = '0002_public_questions_and_hidden_policy.sql'
    migration = (ROOT / 'migrations' / migration_name).read_text()
    index_mutants = {
        'public index exposes hidden questions': migration.replace("NEW.status IN ('pending','answered')", "NEW.status IN ('pending','answered','archived')"),
        'hidden index stops tracking hidden questions': migration.replace("WHERE NEW.status='archived' AND NEW.deleted_at IS NULL", "WHERE 0 AND NEW.status='archived' AND NEW.deleted_at IS NULL"),
    }
    for name, changed in index_mutants.items():
        assert changed != migration, f'Mutation no longer matches migration: {name}'
        (scratch / 'migrations' / migration_name).write_text(changed)
        result = subprocess.run([sys.executable, str(scratch / 'verification/check_state.py')], capture_output=True, text=True)
        if result.returncode == 0 or 'Shortest counterexample:' not in result.stdout:
            print(result.stdout, result.stderr)
            sys.exit('FAIL: index mutation was missed or failed without a counterexample: '+name)
        print('CAUGHT:', name)
        print(result.stdout.strip())
print(f'PASS: all {len(mutants)+len(index_mutants)} broken SQL/index variants detected; production source was unchanged.')
