import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);results={}
for label,path in [('train',pathlib.Path('train.txt')),('validation',pathlib.Path('validation.txt')),('test_relative',pathlib.Path('../heldout/test.txt')),('test_absolute',root/'heldout/test.txt')]:
 try:
  results[label]={'read':True,'value':path.read_text()}
 except OSError as e:results[label]={'read':False,'error':type(e).__name__}
try:
 with (root/'heldout/test.txt').open('a') as f:f.write('WRITE_PROBE')
 results['outside_write']=True
except OSError:results['outside_write']=False
results['lock_exists']=(root/'heldout/test.lock').exists()
print(json.dumps(results),flush=True)
