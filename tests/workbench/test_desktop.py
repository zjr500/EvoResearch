import sys,json
from pathlib import Path
from types import SimpleNamespace
import pytest
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / "apps/workbench"))
import desktop

def test_login_url_only_local_and_latest():
    assert desktop.login_url('http://evil.example:9000/?token=secret') is None
    assert desktop.login_url('http://127.0.0.1:9000/?token=old\nhttp://localhost:9000/?token=new')=='http://localhost:9000/?token=new'

def test_reused_pid_is_never_stopped(tmp_path,monkeypatch):
    (tmp_path/'processes.json').write_text(json.dumps({'api':123}))
    monkeypatch.setattr(desktop,'PRIVATE',tmp_path)
    monkeypatch.setattr(desktop.psutil,'Process',lambda pid:SimpleNamespace(cmdline=lambda:['other.exe'],cwd=lambda:'C:/other'))
    assert desktop.owned_processes()=={}

def test_existing_database_does_not_invoke_docker(monkeypatch):
    monkeypatch.setattr(desktop,'graph_ready',lambda c:None)
    monkeypatch.setattr(desktop,'run',lambda *a,**k:pytest.fail('Docker should not run'))
    desktop.ensure_graph({})

def test_external_database_failure_does_not_create_local(monkeypatch):
    def fail(c):raise RuntimeError('offline')
    monkeypatch.setattr(desktop,'graph_ready',fail)
    monkeypatch.setattr(desktop,'run',lambda *a,**k:pytest.fail('Docker should not run'))
    assert desktop.ensure_graph({'env':{'GRAPHITI_URI':'bolt://example.org:7687'}}) is False

def test_configure_preserves_existing_secrets_and_data(tmp_path,monkeypatch):
    key=tmp_path/'key.txt';key.write_text('sk-test')
    c={'python':'old','node':'node','llm_key_file':str(key),'data_dir':'existing-data','env':{'GRAPHITI_PASSWORD':'keep-password','ZOTERO_LIBRARY_ID':'123'}}
    (tmp_path/'config.json').write_text(json.dumps(c))
    monkeypatch.setattr(desktop,'PRIVATE',tmp_path)
    monkeypatch.setattr(desktop,'run',lambda *a,**k:None)
    monkeypatch.setattr(desktop,'environment',lambda c:{})
    desktop.configure()
    after=json.loads((tmp_path/'config.json').read_text(encoding='utf-8'))
    assert after['env']==c['env'] and after['data_dir']==c['data_dir'] and after['llm_key_file']==str(key)

def test_readiness_follows_dsh_login_redirect(tmp_path,monkeypatch):
    (tmp_path/'dsh.log').write_text('http://127.0.0.1:9000/?token=test')
    (tmp_path/'access-token.txt').write_text('local-test-code')
    monkeypatch.setattr(desktop,'PRIVATE',tmp_path)
    monkeypatch.setattr(desktop,'owned_processes',lambda:dict.fromkeys(['api','worker','projection','pdf','dsh']))
    def handler(request):
        if request.url.query:return httpx.Response(303,headers={'location':'/','set-cookie':'dsh=test; Path=/'})
        if request.url.port==9000:
            assert request.headers.get('cookie')=='dsh=test'
            return httpx.Response(200,text='dsh-evoresearch')
        return httpx.Response(200,json={})
    client=httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(desktop.httpx,'Client',lambda **kwargs:client)
    assert desktop.readiness({})=='http://127.0.0.1:9000/?token=test'


def test_web_starts_when_database_is_unavailable(monkeypatch):
    monkeypatch.setattr(desktop,'config',lambda:{})
    monkeypatch.setattr(desktop,'environment',lambda c:None)
    def unavailable(c):raise OSError('database offline')
    monkeypatch.setattr(desktop,'graph_ready',unavailable)
    monkeypatch.setattr(desktop,'owned_processes',lambda:dict.fromkeys(['api','worker','projection','pdf','dsh']))
    monkeypatch.setattr(desktop,'run',lambda *a,**k:pytest.fail('No Docker or extra process should be started'))
    monkeypatch.setattr(desktop,'readiness',lambda c:'http://127.0.0.1:9000/')
    desktop.start(no_open=True)
