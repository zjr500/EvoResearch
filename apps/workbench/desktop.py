"""Windows local deployment, readiness checks and authenticated browser launch."""
import argparse,json,os,re,secrets,subprocess,sys,time,webbrowser
from pathlib import Path
import httpx,psutil
from manage import ROOT,PHASE,PRIVATE,environment

HIDDEN={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}

def run(args,**kwargs):
    return subprocess.run([str(x) for x in args],check=True,cwd=ROOT,**HIDDEN,**kwargs)

def config():
    return json.loads((PRIVATE/'config.json').read_text(encoding='utf-8'))

def configure(node=None):
    run([sys.executable,PHASE/'manage.py','init'])
    c=config();c['python']=str(Path(sys.executable).resolve())
    if node:c['node']=str(Path(node).resolve())
    existing=c.get('llm_key_file','')
    if not existing or not Path(existing).is_file():
        candidate=ROOT/'.secrets/llm-api_key.txt'
        if candidate.is_file():c['llm_key_file']=str(candidate)
        else:
            value=input('DeepSeek API key FILE path (never paste key here): ').strip().strip('"')
            if not value or not Path(value).is_file():raise ValueError('A valid API key file is required. Run Configure.cmd to retry.')
            c['llm_key_file']=str(Path(value).resolve())
    if not c['env'].get('GRAPHITI_PASSWORD'):c['env']['GRAPHITI_PASSWORD']=secrets.token_hex(16)
    # Existing configurations and credentials are preserved; Zotero is optional for first launch.
    (PRIVATE/'config.json').write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
    environment(c)  # Validate key format without printing it.
    print('Configuration ready. Optional Zotero settings: .audit-data/workbench-local/config.json')

def graph_ready(c):
    from neo4j import GraphDatabase
    with GraphDatabase.driver(c['env'].get('GRAPHITI_URI','bolt://127.0.0.1:17687'),
        auth=('neo4j',c['env']['GRAPHITI_PASSWORD']),connection_timeout=3,connection_acquisition_timeout=5,max_transaction_retry_time=0) as driver:
        driver.verify_connectivity()
        with driver.session() as session:session.run('RETURN apoc.version() AS version').single(strict=True)

def ensure_graph(c):
    """Check an explicitly configured database; never install or launch Docker."""
    try:
        graph_ready(c)
        print('Neo4j + APOC: ready (existing database reused)')
        return True
    except Exception:
        print('WARNING: Knowledge database unavailable. Web and experiment services will start; Graphiti retrieval and ingestion require Neo4j + APOC. No replacement database was created.')
        return False


def owned_processes():
    path=PRIVATE/'processes.json'
    if not path.exists():return {}
    result={}
    for name,pid in json.loads(path.read_text()).items():
        try:
            p=psutil.Process(pid);cmd=' '.join(p.cmdline())
            owned=str(ROOT).lower() in cmd.lower() or ('-m evoresearch' in cmd and Path(p.cwd()).resolve()==ROOT.resolve())
            if not owned:
                # Windows can reuse PIDs after a reboot. Never treat that application as ours.
                continue
            result[name]=p
        except psutil.NoSuchProcess:pass
    return result

def login_url(log):
    # Never accept arbitrary log-provided hosts, nor print bearer URLs to diagnostics.
    urls=re.findall(r'http://(?:127\.0\.0\.1|localhost):9000/[^\s\x1b<>"\']*\?token=[A-Za-z0-9._~%+\-/=]+',log)
    return urls[-1] if urls else None

def readiness(c):
    live=owned_processes()
    if set(live)!={'api','worker','projection','pdf','dsh'}:raise RuntimeError('One or more service processes exited; inspect private logs.')
    url=login_url((PRIVATE/'dsh.log').read_text(encoding='utf-8',errors='replace'))
    if not url:raise RuntimeError('DSH login URL not ready')
    with httpx.Client(timeout=5,trust_env=False) as client:
        client.get('http://127.0.0.1:8091/health').raise_for_status()
        client.get('http://127.0.0.1:8091/api/wb/projects',headers={'Authorization':'Bearer '+(PRIVATE/'access-token.txt').read_text().strip()}).raise_for_status()
        response=client.get(url,follow_redirects=True)
        if response.status_code!=200:raise RuntimeError('DSH authenticated page is not ready')
        if 'dsh-evoresearch' not in response.text:raise RuntimeError('DSH page does not include the EvoResearch plugin')
    return url

def start(no_open=False):
    c=config();environment(c);ensure_graph(c)
    live=owned_processes()
    if live and set(live)!={'api','worker','projection','pdf','dsh'}:
        raise RuntimeError('Some services are running but others are missing. Run Stop.cmd then Start.cmd; this avoids interrupting active experiments silently.')
    if not live:
        pidfile=PRIVATE/'processes.json'
        if pidfile.exists():pidfile.unlink()
        # Detect occupied listeners before spawning any process.
        import socket
        for port in (8091,9000):
            with socket.socket() as sock:
                try:sock.bind(('127.0.0.1',port))
                except OSError:raise RuntimeError(f'Port {port} is occupied. Stop its owner or previous deployment first.') from None
        run([sys.executable,PHASE/'manage.py','start'])
    print('Checking API, authenticated DSH page and five workers...')
    for _ in range(30):
        try:url=readiness(c);break
        except Exception:time.sleep(2)
    else:raise RuntimeError('Startup checks failed; run Check.cmd and inspect .audit-data/workbench-local logs.')
    print('Ready: http://127.0.0.1:9000 — enable EvoResearch in the DSH header.')
    print('Workbench access code: .audit-data/workbench-local/access-token.txt')
    if not no_open:
        webbrowser.open(url)
        if os.name=='nt':os.startfile(str(PRIVATE/'access-token.txt'))

def check():
    c=config();results={}
    for name,fn in [('configuration',lambda:environment(c)),('graphiti_database',lambda:graph_ready(c)),('services_and_authenticated_page',lambda:readiness(c))]:
        try:fn();results[name]='passed'
        except Exception as exc:results[name]=('unavailable' if name=='graphiti_database' else 'failed')+' ('+type(exc).__name__+'); inspect configuration and private logs'
    results['browser_visual_and_click_acceptance']='pending_user'
    (PRIVATE/'deployment-check.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results,indent=2))
    if any(v.startswith('failed') for v in results.values()):raise RuntimeError('Deployment checks incomplete')

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['configure','start','stop','check']);p.add_argument('--node');p.add_argument('--no-open',action='store_true');args=p.parse_args()
    try:
        if args.action=='configure':configure(args.node)
        elif args.action=='start':start(args.no_open)
        elif args.action=='check':check()
        else:
            live=owned_processes()
            path=PRIVATE/'processes.json'
            if path.exists():path.write_text(json.dumps({name:p.pid for name,p in live.items()}),encoding='utf-8')
            run([sys.executable,PHASE/'manage.py','stop'])
            _,alive=psutil.wait_procs(list(live.values()),timeout=10)
            if alive:raise RuntimeError('Some services are still stopping. Wait before running Start.cmd.')
            print('External Neo4j and its data are retained; only project services were stopped.')
    except Exception as exc:
        # Avoid propagating third-party diagnostics which may embed credentials.
        print('FAILED: '+(str(exc) if isinstance(exc,(RuntimeError,ValueError)) else type(exc).__name__))
        return 1
    return 0

if __name__=='__main__':sys.exit(main())
