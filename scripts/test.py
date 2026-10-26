"""Run all portable suites, fail if any suite fails."""
import os, subprocess, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env=dict(os.environ, PYTHONUTF8='1')
env['PYTHONPATH']=os.pathsep.join(str(root/p) for p in ('.','packages/autoresearch/src','services/research/src','apps/workbench'))
commands=[[sys.executable,'-m','pytest','-q'],['node','--test',*[str(p.relative_to(root)) for p in sorted((root/'tests').rglob('*.test.mjs'))], 'tests/autoresearch/test_web.mjs']]
failed=False
for command in commands:
    result=subprocess.run(command,cwd=root,env=env)
    failed |= result.returncode != 0
raise SystemExit(1 if failed else 0)
