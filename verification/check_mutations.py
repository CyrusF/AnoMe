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
    'archive incorrectly deletes quota history': original.replace(
        "UPDATE questions SET status='archived',updated_at=?1 WHERE id=?2",
        "DELETE FROM questions WHERE id=?2 AND ?1 IS NOT NULL"),
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
print('PASS: all 3 broken SQL variants detected; production source was unchanged.')
