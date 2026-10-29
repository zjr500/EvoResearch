"""Local DSH-mounted workbench, reusing the phase 5 service and workers."""
from dataclasses import asdict
import hashlib,hmac,json,os,time
from pathlib import Path
from fastapi import HTTPException,Request,Query
from fastapi.responses import FileResponse,JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel,Field,ConfigDict
from evoresearch.api import create_app as phase5_app
from evoresearch.papers import initialize as papers_initialize
from evoresearch.graphiti_adapter import project_group
from zotero import import_items,fetch_page,children
import pdf_ingestion

ROOT=Path(__file__).resolve().parent

class Project(BaseModel):
    model_config=ConfigDict(extra='forbid')
    project_id:str=Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    name:str=Field(min_length=1,max_length=120)
    description:str=Field(default='',max_length=2000)

class ImportInput(BaseModel):
    items:list[dict]=Field(max_length=500)


def create_app(settings=None,token=None):
    token=token or os.getenv('EVORESEARCH_TOKEN','')
    app=phase5_app(settings,token);a=app.state.adapter;store=a.store
    papers_initialize(store)
    pdf_ingestion.initialize(store)
    with store.connect() as con:
        con.execute('CREATE TABLE IF NOT EXISTS wb_projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,created REAL NOT NULL)')
        con.execute("INSERT OR IGNORE INTO wb_projects SELECT project_id,project_id,'既有科研项目',? FROM (SELECT project_id FROM evo_tasks UNION SELECT project_id FROM evo_papers)",(time.time(),))
    origin=os.getenv('WORKBENCH_ORIGIN','http://127.0.0.1:8091')
    browser_origins={origin,'http://127.0.0.1:9000'}
    def signature(value):return hmac.new(token.encode(),value.encode(),hashlib.sha256).hexdigest()
    def cookie_valid(value):
        try:
            expiry,sig=value.split('.')
            return int(expiry)>time.time() and hmac.compare_digest(signature(expiry),sig)
        except (ValueError,AttributeError):return False
    @app.middleware('http')
    async def browser_auth(req,call_next):
        if req.url.path.startswith('/api/'):
            bearer=req.headers.get('authorization','')
            if not hmac.compare_digest(bearer.encode(),('Bearer '+token).encode()):
                if not cookie_valid(req.cookies.get('evo_session','')):
                    return JSONResponse({'detail':'请使用本机访问码登录工作台'},401)
                if req.method not in ('GET','HEAD') and req.headers.get('origin') not in browser_origins:
                    return JSONResponse({'detail':'来源校验失败，请刷新工作台'},403)
                req.scope['headers']=[(k,v) for k,v in req.scope['headers'] if k!=b'authorization']+[(b'authorization',('Bearer '+token).encode())]
            body_limit=pdf_ingestion.MAX_BYTES if req.url.path.endswith('/pdf-upload') else 2_000_000
            if int(req.headers.get('content-length','0'))>body_limit:
                return JSONResponse({'detail':'请求超过 2 MB 限制'},413)
        response=await call_next(req)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Cache-Control']='no-store'
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors http://127.0.0.1:9000 http://localhost:9000 'self'"
        return response

    # A bounded, cached probe keeps knowledge availability separate from API health.
    import threading
    status_lock=threading.Lock()
    status_cache={'checked':0.0,'knowledge_database':'checking'}
    @app.get('/workbench/status')
    def service_status():
        if time.monotonic()-status_cache['checked']>15:
            with status_lock:
                if time.monotonic()-status_cache['checked']>15:
                    try:
                        from neo4j import GraphDatabase
                        with GraphDatabase.driver(os.getenv('GRAPHITI_URI','bolt://127.0.0.1:17687'),auth=('neo4j',os.getenv('GRAPHITI_PASSWORD','')),connection_timeout=2,connection_acquisition_timeout=3,max_transaction_retry_time=0) as driver:
                            driver.verify_connectivity()
                            with driver.session() as session:session.run('RETURN apoc.version()').single(strict=True)
                        status_cache['knowledge_database']='ready'
                    except Exception:
                        status_cache['knowledge_database']='unavailable'
                    status_cache['checked']=time.monotonic()
        return {'api':'ready','knowledge_database':status_cache['knowledge_database']}

    @app.post('/workbench/login')
    async def login(req:Request):
        if req.headers.get('origin') not in browser_origins:raise HTTPException(403,'Invalid origin')
        body=await req.json()
        if not hmac.compare_digest(str(body.get('token','')).encode(),token.encode()):raise HTTPException(401,'访问码不正确')
        expiry=str(int(time.time()+8*3600))
        response=JSONResponse({'ok':True})
        response.set_cookie('evo_session',expiry+'.'+signature(expiry),httponly=True,samesite='strict',max_age=8*3600,secure=origin.startswith('https:'))
        return response

    @app.post('/api/wb/logout')
    def logout():
        response=JSONResponse({'ok':True});response.delete_cookie('evo_session');return response

    def project_exists(pid):
        with store.connect() as con:row=con.execute('SELECT 1 FROM wb_projects WHERE project_id=?',(pid,)).fetchone()
        if not row:raise HTTPException(404,'项目不存在')

    @app.get('/api/wb/projects')
    def projects():
        with store.connect() as con:
            return [dict(r) for r in con.execute("SELECT p.*,(SELECT count(*) FROM evo_tasks t WHERE t.project_id=p.project_id) AS experiments,(SELECT count(*) FROM wb_zotero_items z WHERE z.project_id=p.project_id)+(SELECT count(DISTINCT paper_id) FROM evo_papers d WHERE d.project_id=p.project_id AND paper_id NOT LIKE 'zotero-%' AND paper_id NOT LIKE 'pdf-%') AS papers FROM wb_projects p ORDER BY created DESC LIMIT 500")]

    @app.post('/api/wb/projects',status_code=201)
    def create_project(body:Project):
        with store.connect() as con:
            if con.execute('SELECT 1 FROM wb_projects WHERE project_id=?',(body.project_id,)).fetchone():raise HTTPException(409,'项目 ID 已存在')
            con.execute('INSERT INTO wb_projects VALUES(?,?,?,?)',(body.project_id,body.name,body.description,time.time()))
        return body.model_dump()

    @app.get('/api/wb/projects/{pid}/runs')
    def runs(pid:str):
        project_exists(pid)
        with store.connect() as con:rows=list(con.execute('SELECT run_id,task_json FROM evo_tasks WHERE project_id=? ORDER BY rowid DESC LIMIT 100',(pid,)))
        return [a.snapshot(r['run_id'])|{'task':json.loads(r['task_json'])} for r in rows]

    @app.get('/api/wb/projects/{pid}/papers')
    def papers(pid:str):
        project_exists(pid)
        with store.connect() as con:
            return [dict(r)|{'body':json.loads(r['body'])} for r in con.execute('SELECT p.*,k.status,k.last_error FROM evo_papers p JOIN evo_knowledge k USING(record_id) WHERE p.project_id=? ORDER BY p.created DESC LIMIT 500',(pid,))]

    @app.get('/api/wb/projects/{pid}/knowledge')
    def knowledge(pid:str):
        project_exists(pid)
        with store.connect() as con:return [dict(r)|{'body':json.loads(r['body'])} for r in con.execute('SELECT * FROM evo_knowledge WHERE project_id=? ORDER BY updated DESC LIMIT 500',(pid,))]

    @app.post('/api/wb/projects/{pid}/knowledge/{rid}/retry')
    def retry(pid:str,rid:str):
        project_exists(pid)
        with store.connect() as con:
            row=con.execute('SELECT status FROM evo_knowledge WHERE record_id=? AND project_id=?',(rid,pid)).fetchone()
            if not row:raise HTTPException(404,'知识记录不存在')
            if row[0] not in ('retryable_failure','visibility_pending'):raise HTTPException(409,'此状态无需重试或必须先修复来源')
            con.execute('UPDATE evo_knowledge SET next_attempt=0 WHERE record_id=?',(rid,))
        return {'queued':True,'message':'等待独立投影 Worker 重试'}

    @app.get('/api/wb/projects/{pid}/graph')
    def graph(pid:str):
        project_exists(pid)
        from neo4j import GraphDatabase
        try:
            with GraphDatabase.driver(os.getenv('GRAPHITI_URI','bolt://127.0.0.1:17687'),auth=(os.getenv('GRAPHITI_USER','neo4j'),os.environ['GRAPHITI_PASSWORD']),connection_timeout=5) as driver:
                nodes,_,_=driver.execute_query('MATCH (n {group_id:$g}) RETURN n.uuid AS id,n.name AS name,labels(n) AS labels LIMIT 200',g=project_group(pid))
                edges,_,_=driver.execute_query('MATCH (a {group_id:$g})-[r]->(b {group_id:$g}) RETURN a.uuid AS source,b.uuid AS target,r.uuid AS id,type(r) AS type,r.fact AS fact LIMIT 500',g=project_group(pid))
            return {'nodes':[r.data() for r in nodes],'edges':[r.data() for r in edges],'limited':len(nodes)==200 or len(edges)==500}
        except Exception:raise HTTPException(503,'Graphiti 数据库暂不可用，实验状态不受影响') from None

    @app.post('/api/wb/projects/{pid}/zotero/import')
    def zotero_import(pid:str,body:ImportInput):
        project_exists(pid);return {'results':import_items(store,pid,body.items)}

    @app.post('/api/wb/projects/{pid}/zotero/sync')
    def zotero_sync(pid:str,start:int=Query(default=0,ge=0)):
        project_exists(pid)
        try:page=fetch_page(start)
        except Exception:raise HTTPException(503,'Zotero 未配置、访问失败或受速率限制；请检查服务端配置后重试') from None
        return {'results':import_items(store,pid,page['items']),'next_start':page['next_start'],'total':page['total']}

    @app.get('/api/wb/projects/{pid}/zotero/items')
    def zotero_items(pid:str):
        project_exists(pid)
        with store.connect() as con:return [dict(r)|{'body':json.loads(r['body'])} for r in con.execute('SELECT * FROM wb_zotero_items WHERE project_id=?',(pid,))]

    @app.post('/api/wb/projects/{pid}/zotero/{item_key}/pdf')
    def zotero_pdf(pid:str,item_key:str):
        project_exists(pid);pdf_ingestion.source_item(store,pid,item_key)
        try:attachments=children(item_key)
        except Exception:raise HTTPException(503,'Zotero 附件列表暂不可用') from None
        pdfs=[x for x in attachments if x.get('data',{}).get('contentType')=='application/pdf']
        if not pdfs:raise HTTPException(409,'该文献尚无 PDF 附件，请同步附件或上传本机 PDF')
        return {'jobs':[pdf_ingestion.queue(store,pid,item_key,{'kind':'zotero','attachment':x}) for x in pdfs]}

    @app.post('/api/wb/projects/{pid}/zotero/{item_key}/pdf-upload')
    async def pdf_upload(pid:str,item_key:str,request:Request):
        project_exists(pid);pdf_ingestion.source_item(store,pid,item_key)
        if request.headers.get('content-type','').split(';')[0]!='application/pdf':raise HTTPException(415,'需要 application/pdf')
        data=bytearray()
        async for part in request.stream():
            data.extend(part)
            if len(data)>pdf_ingestion.MAX_BYTES:raise HTTPException(413,'PDF 超过 50 MB')
        if not data.startswith(b'%PDF-'):raise HTTPException(422,'不是有效 PDF 文件头')
        digest=hashlib.sha256(data).hexdigest();folder=store.home/'pdf-blobs';folder.mkdir(exist_ok=True)
        target=folder/digest
        if not target.exists():
            import uuid
            tmp=folder/(digest+'.'+uuid.uuid4().hex+'.tmp');tmp.write_bytes(data);tmp.replace(target)
        return pdf_ingestion.queue(store,pid,item_key,{'kind':'uploaded_pdf','sha256':digest})

    @app.get('/api/wb/projects/{pid}/pdf-jobs')
    def pdf_jobs(pid:str):
        project_exists(pid)
        with store.connect() as con:
            rows=[dict(r) for r in con.execute('SELECT job_id,item_key,status,manifest,error,created,updated FROM wb_pdf_jobs WHERE project_id=? ORDER BY created DESC',(pid,))]
            for row in rows:
                row['manifest']=json.loads(row['manifest']) if row['manifest'] else None
                if row['manifest']:
                    statuses=[]
                    for rec in row['manifest']['records']:
                        status=con.execute('SELECT status FROM evo_knowledge WHERE record_id=?',(rec['record_id'],)).fetchone()
                        statuses.append(status[0] if status else 'missing')
                    row['retrievable_chunks']=statuses.count('retrievable');row['total_chunks']=len(statuses)
                    row['ingestion_status']='retrievable' if statuses and all(s=='retrievable' for s in statuses) else 'pending'
        return rows

    @app.post('/api/wb/projects/{pid}/pdf-jobs/{job_id}/retry')
    def retry_pdf(pid:str,job_id:str):
        project_exists(pid)
        with store.connect() as con:
            result=con.execute("UPDATE wb_pdf_jobs SET status='queued',error=NULL,updated=? WHERE project_id=? AND job_id=? AND status='failed'",(time.time(),pid,job_id))
            if result.rowcount!=1:raise HTTPException(409,'任务不存在或不处于失败状态')
        return {'queued':True}

    @app.get('/api/wb/projects/{pid}/pdf-jobs/{job_id}/pages')
    def pdf_pages(pid:str,job_id:str,page:int=Query(default=1,ge=1,le=200)):
        project_exists(pid)
        with store.connect() as con:row=con.execute("SELECT status FROM wb_pdf_jobs WHERE job_id=? AND project_id=?",(job_id,pid)).fetchone()
        if not row or row[0]!='parsed':raise HTTPException(404,'全文尚未解析完成')
        # job_id was looked up before filesystem access; reject path syntax as defense in depth.
        import re
        if not re.fullmatch('[a-f0-9]{32}',job_id):raise HTTPException(404,'任务不存在')
        manifest=json.loads((store.home/'pdf-jobs'/job_id/'manifest.json').read_text(encoding='utf-8'))
        if page>len(manifest['pages']):raise HTTPException(404,'页码不存在')
        return {'document_sha256':manifest['document_sha256'],**manifest['pages'][page-1]}

    @app.get('/api/wb/runs/{rid}/artifact')
    def artifact(rid:str,path:str):
        a.snapshot(rid)
        allowed={r['path'] for r in store.artifacts(rid)}
        root=(store.home/'runs'/rid).resolve();target=(root/path).resolve()
        if path not in allowed or not target.is_relative_to(root) or not target.is_file():raise HTTPException(404,'产物不存在')
        return FileResponse(target,filename=target.name,media_type='application/octet-stream')

    @app.get('/api/wb/config')
    def config():return {'model':os.getenv('AUTORESEARCH_MODEL','未配置'),'provider':a.settings.provider,'runner':a.settings.runner,
                          'zotero_configured':bool(os.getenv('ZOTERO_LIBRARY_ID')),'prior_conclusion':'第五阶段单次增强/无增强配对持平；候选测试集略差于基线，未证明增强收益。'}

    @app.get('/workbench')
    def home():return FileResponse(ROOT/'web/index.html')
    app.mount('/workbench/static',StaticFiles(directory=ROOT/'web'),name='workbench-static')
    app.add_middleware(CORSMiddleware,allow_origins=sorted(browser_origins),allow_credentials=True,
                       allow_methods=['GET','POST'],allow_headers=['Content-Type'])
    return app

if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_app(),host='127.0.0.1',port=8091)
