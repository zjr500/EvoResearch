import os,sys,time,subprocess,json
child=subprocess.Popen([sys.executable,'-u','-c',"import time;exec('while True: print(\"child-tick\",flush=True);time.sleep(0.3)')"])
print(json.dumps({'parent_pid':os.getpid(),'child_pid':child.pid}),flush=True)
while True:
 print('parent-tick',flush=True)
 time.sleep(0.3)
