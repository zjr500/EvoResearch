"""Export source, documentation and the complete .git directory; exclude private runtime data."""
from pathlib import Path
import hashlib,json,subprocess,sys,zipfile
root=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(root/'scripts/check_repository.py')],cwd=root,check=True)
names=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z'],cwd=root).decode('utf-8').split('\0')
out=root/'dist/EvoResearch-repository-0.8.0.zip'
out.parent.mkdir(exist_ok=True)
manifest={}
git_dir=root/'.git'
if not git_dir.is_dir():raise RuntimeError('A complete .git directory is required, not a worktree pointer.')
# Audit all stored blobs, including unreachable historical objects.
import re
objects=subprocess.check_output(['git','cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype) %(objectsize)'],cwd=root).decode().splitlines()
for row in objects:
    oid,kind,size=row.split()
    if int(size)>5_000_000:raise RuntimeError('Large historical object requires review: '+oid)
    if kind=='blob':
        data=subprocess.check_output(['git','cat-file','blob',oid],cwd=root)
        if re.search(rb'\bsk-[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):raise RuntimeError('Historical credential pattern: '+oid)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as bundle:
    for name in sorted(set(filter(None,names))):
        path=root/name
        if not path.is_file():continue
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise RuntimeError('External file: '+name)
        data=path.read_bytes();manifest[name]=hashlib.sha256(data).hexdigest()
        bundle.writestr('EvoResearch/'+name,data)
    for path in sorted(git_dir.rglob('*')):
        if not path.is_file():continue
        if path.is_symlink():raise RuntimeError('Symlink in .git')
        if path.name.endswith('.lock'):raise RuntimeError('Git operation in progress; retry after completion')
        name=path.relative_to(root).as_posix();data=path.read_bytes()
        if re.search(rb'https?://[^/\s]+:[^/\s]+@',data):raise RuntimeError('Credential-bearing URL in Git metadata: '+name)
        manifest[name]=hashlib.sha256(data).hexdigest();bundle.writestr('EvoResearch/'+name,data)
    bundle.writestr('EvoResearch/SHA256.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(out) as bundle:
    assert bundle.testzip() is None
    for name,digest in manifest.items():assert hashlib.sha256(bundle.read('EvoResearch/'+name)).hexdigest()==digest
print(f'Exported {len(manifest)} files: {out}')
print('SHA256: '+hashlib.sha256(out.read_bytes()).hexdigest())
