"""Check tracked and unignored files without printing secret values."""
from pathlib import Path
import re, subprocess

root=Path(__file__).resolve().parents[1]
files=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z'],cwd=root).decode().split('\0')
bad=[]
for name in sorted(set(filter(None,files))):
    path=root/name
    if not path.is_file():continue
    if any(p in {'.venv','node_modules','__pycache__','.secrets','mlruns','mlartifacts'} or p.startswith('.audit-') for p in path.relative_to(root).parts):
        bad.append((name,'generated/private directory'))
    if path.suffix.lower() in {'.zip','.db','.sqlite','.sqlite3','.npy','.npz','.pyc'}:
        bad.append((name,'generated/private file'))
    if path.name.startswith('.env') and path.name!='.env.example':bad.append((name,'private configuration'))
    text=path.read_bytes().decode('utf-8',errors='ignore')
    patterns=[r'\bsk-[A-Za-z0-9_-]{24,}',r'\bgh[pousr]_[A-Za-z0-9]{25,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
    if any(re.search(p,text) for p in patterns):bad.append((name,'credential pattern'))
for name,reason in bad:print(f'{name}: {reason}')
print(f'Checked {len(set(filter(None,files)))} repository files; violations={len(bad)}')
raise SystemExit(bool(bad))
