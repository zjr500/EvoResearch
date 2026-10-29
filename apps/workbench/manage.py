"""Managed local processes. Secrets stay in ignored local configuration."""
import argparse,json,os,secrets,subprocess,sys,time
from pathlib import Path

PHASE=Path(__file__).resolve().parent
ROOT=PHASE.parents[1]
PLUGIN=ROOT/'plugins/dsh'
PRIVATE=ROOT/'.audit-data/workbench-local'

def refresh_plugin():
    """File-package installs may retain an old snapshot after source edits."""
    target=(ROOT/'.audit-data/dsh-workbench/profiles/web/node_modules/dsh-evoresearch').resolve()
    if not target.is_relative_to((ROOT/'.audit-data').resolve()):
        if target==(PLUGIN).resolve():return
        raise RuntimeError('Unexpected installed plugin path')
    if not target.is_dir():raise RuntimeError('Install the DSH plugin with setup.ps1 first')
    for name in ('package.json','index.mjs','tools.mjs','client.js','cordis.patch.yml'):
        source=PLUGIN/name;destination=target/name
        data=source.read_bytes()
        if destination.exists() and destination.read_bytes()==data:continue
        temp=target/(name+'.refresh.tmp');temp.write_bytes(data);temp.replace(destination)

def environment(config):
    env=os.environ.copy()
    env.update({str(k):str(v) for k,v in config.get('env',{}).items()})
    env['AUTORESEARCH_HOME']=str(Path(config.get('data_dir',ROOT/'.audit-data/workbench')).resolve())
    env['DSH_HOME']=str(ROOT/'.audit-data/dsh-workbench')
    env['EVORESEARCH_TOKEN']=(PRIVATE/'access-token.txt').read_text().strip()
    keyfile=config.get('llm_key_file')
    if keyfile:
        import re
        text=Path(keyfile).read_text(encoding='utf-8-sig')
        match=re.search(r'sk-[A-Za-z0-9_-]+',text)
        if not match:raise ValueError('No API key in configured key file')
        env['AUTORESEARCH_MODEL_API_KEY']=match.group()
        env['DEEPSEEK_API_KEY']=match.group()
        env['GRAPHITI_LLM_KEY_FILE']=str(Path(keyfile).resolve())
    env['PATH']=str(Path(config['node']).parent)+os.pathsep+env.get('PATH','')
    return env

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['init','start','stop','status'])
    args=parser.parse_args();PRIVATE.mkdir(parents=True,exist_ok=True)
    configfile=PRIVATE/'config.json';pidfile=PRIVATE/'processes.json'
    if args.action=='init':
        if not (PRIVATE/'access-token.txt').exists():(PRIVATE/'access-token.txt').write_text(secrets.token_urlsafe(32))
        if not configfile.exists():
            config={'python':str(ROOT/'.audit-venvs/phase5/Scripts/python.exe'),'node':'node',
                    'data_dir':str(ROOT/'.audit-data/workbench'),'llm_key_file':'',
                    'env':{'AUTORESEARCH_RUNNER':'local_trusted','AUTORESEARCH_PROVIDER':'openai_compatible',
                           'AUTORESEARCH_MODEL':'deepseek-v4-flash','AUTORESEARCH_MODEL_BASE_URL':'https://api.deepseek.com',
                           'GRAPHITI_URI':'bolt://127.0.0.1:17687','GRAPHITI_PASSWORD':'',
                           'GRAPHITI_MODEL':'deepseek-v4-flash','GRAPHITI_EMBEDDING_CACHE':str(ROOT/'.audit-cache/phase4-embeddings')}}
            configfile.write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
        print('Private configuration:',configfile);print('Access code file:',PRIVATE/'access-token.txt');return
    config=json.loads(configfile.read_text(encoding='utf-8'));env=environment(config)
    if args.action=='start':
        if pidfile.exists():raise SystemExit('Existing process record; use status/stop before starting again')
        refresh_plugin()
        py=config['python'];node=config['node'];cli=ROOT/'.audit-runtime/dsh-workbench/node_modules/@deepseek-ai/dsh/lib/bin.js'
        commands={'api':[py,str(PHASE/'server.py')],'worker':[py,'-m','evoresearch','worker'],
                  'projection':[py,str(PHASE/'projection.py')],
                  'pdf':[py,str(PHASE/'pdf_ingestion.py')],
                  'dsh':[node,str(cli),'web','--no-open','--host','127.0.0.1','--port','9000']}
        pids={}
        for name,cmd in commands.items():
            with (PRIVATE/(name+'.log')).open('ab') as log:
                process=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,
                                         creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            pids[name]=process.pid
            pidfile.write_text(json.dumps(pids),encoding='utf-8')
        print('Started:',', '.join(pids));print('DSH URL is in',PRIVATE/'dsh.log');print('Workbench: http://127.0.0.1:8091/workbench')
    elif args.action=='stop':
        if not pidfile.exists():print('No managed processes');return
        # Restrict termination to recorded PIDs whose command line belongs to this workspace.
        import psutil
        for name,pid in json.loads(pidfile.read_text()).items():
            try:
                process=psutil.Process(pid);cmd=' '.join(process.cmdline())
                owned=str(ROOT).lower() in cmd.lower() or ('-m evoresearch' in cmd and Path(process.cwd()).resolve()==ROOT.resolve())
                if not owned:raise RuntimeError('PID ownership changed; refusing to terminate '+name)
                for child in process.children(recursive=True):child.terminate()
                process.terminate()
            except psutil.NoSuchProcess:pass
        pidfile.unlink();print('Managed processes stopped. In-flight experiments recover on restart; projection events remain durable.')
    else:
        import httpx
        for name,url in [('api','http://127.0.0.1:8091/health'),('dsh','http://127.0.0.1:9000/')]:
            try:print(name,httpx.get(url,timeout=5).status_code)
            except httpx.HTTPError:print(name,'unavailable')
        print('Process record:',pidfile.exists());print('Logs:',PRIVATE)

if __name__=='__main__':main()
