import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / "apps/workbench"))
import httpx,pytest
from fastapi.testclient import TestClient
from autoresearch.config import Settings
from server import create_app
from zotero import fetch_page,convert

TOKEN='test-workbench-token-1234567890'
@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(Settings(tmp_path,runner='local_trusted'),TOKEN))

def auth(client):
    r=client.post('/workbench/login',json={'token':TOKEN},headers={'origin':'http://127.0.0.1:9000'})
    assert r.status_code==200

def test_cookie_origin_and_project(client):
    assert client.get('/api/wb/projects').status_code==401
    assert client.post('/workbench/login',json={'token':TOKEN},headers={'origin':'https://evil.example'}).status_code==403
    auth(client)
    body={'project_id':'demo','name':'研究','description':''}
    assert client.post('/api/wb/projects',json=body).status_code==403
    assert client.post('/api/wb/projects',json=body,headers={'origin':'http://127.0.0.1:9000'}).status_code==201
    assert client.get('/api/wb/projects').json()[0]['name']=='研究'
    assert client.get('/api/wb/projects/unknown/runs').status_code==404
    assert client.get('/api/wb/projects/demo/runs').json()==[]

def test_cors(client):
    response=client.options('/api/wb/projects',headers={'origin':'http://127.0.0.1:9000','access-control-request-method':'POST','access-control-request-headers':'content-type'})
    assert response.status_code==200
    assert response.headers['access-control-allow-origin']=='http://127.0.0.1:9000'
    assert client.options('/api/wb/projects',headers={'origin':'https://evil.example','access-control-request-method':'POST'}).status_code==400

def item():return {'id':'paper1','title':'Actual source title','author':[{'family':'Author'}],'URL':'https://example.org/paper','abstract':'Grounded source text '*10}

def test_zotero_import_idempotent(client):
    client.headers['authorization']='Bearer '+TOKEN
    client.post('/api/wb/projects',json={'project_id':'demo','name':'Demo'})
    data={'items':[item(),{'title':'Missing abstract'}]}
    first=client.post('/api/wb/projects/demo/zotero/import',json=data).json()
    second=client.post('/api/wb/projects/demo/zotero/import',json=data).json()
    assert first==second and first['results'][1]['status']=='skipped'
    assert len(client.get('/api/wb/projects/demo/papers').json())==1
    assert len(client.get('/api/wb/projects/demo/knowledge').json())==1

def test_zotero_no_redirect_and_pagination(monkeypatch):
    monkeypatch.setenv('ZOTERO_LIBRARY_ID','123')
    requests=[]
    def handle(req):
        requests.append(req)
        assert req.headers['Zotero-API-Version']=='3'
        return httpx.Response(200,json=[item()],headers={'Total-Results':'2'})
    with httpx.Client(transport=httpx.MockTransport(handle),follow_redirects=False) as client:
        assert fetch_page(0,client)['next_start']==1
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(302,headers={'location':'https://evil.example'})),follow_redirects=False) as client:
        with pytest.raises(ValueError,match='302'):fetch_page(0,client)

def test_zotero_version_changes():
    a=convert('demo',item());b=item();b['abstract']+=' changed'
    assert convert('demo',b).version!=a.version

def test_retry_no_cross_project(client):
    client.headers['authorization']='Bearer '+TOKEN
    client.post('/api/wb/projects',json={'project_id':'a','name':'A'})
    client.post('/api/wb/projects',json={'project_id':'b','name':'B'})
    result=client.post('/api/wb/projects/a/zotero/import',json={'items':[item()]}).json()
    rid=result['results'][0]['record_id']
    assert client.post(f'/api/wb/projects/b/knowledge/{rid}/retry').status_code==404
    assert client.post(f'/api/wb/projects/a/knowledge/{rid}/retry').status_code==409


def test_knowledge_offline_status_is_cached_and_does_not_block_api(client,monkeypatch):
    from neo4j import GraphDatabase
    calls=[]
    def unavailable(*args,**kwargs):
        calls.append(1)
        raise RuntimeError('credential-secret-must-not-leak')
    monkeypatch.setattr(GraphDatabase,'driver',unavailable)
    for _ in range(2):
        response=client.get('/workbench/status')
        assert response.json()=={'api':'ready','knowledge_database':'unavailable'}
        assert 'credential' not in response.text
    assert len(calls)==1
    assert client.get('/health').status_code==200
    auth(client)
    assert client.get('/api/wb/projects').status_code==200
