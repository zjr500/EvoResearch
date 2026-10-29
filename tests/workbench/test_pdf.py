import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / "apps/workbench"))
import pytest,httpx
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
from pdf_ingestion import parse_document,queue,initialize
from zotero import download_pdf,import_items,convert
from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter

def make_pdf(path,text='This scientific source has sufficient text for a full page provenance and chunking test.'):
    writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    stream=DecodedStreamObject();stream.set_data(f'BT /F1 12 Tf 20 700 Td ({text}) Tj ET'.encode())
    page[NameObject('/Contents')]=writer._add_object(stream)
    with path.open('wb') as f:writer.write(f)

def test_pdf_pages_and_hash(tmp_path):
    path=tmp_path/'sample.pdf';make_pdf(path);d=parse_document(path)
    assert d['page_count']==1 and d['chunks'][0]['pages']==[1]
    assert 'scientific source' in d['chunks'][0]['text']
    assert d['document_sha256']==hashlib.sha256(path.read_bytes()).hexdigest()

def test_blank_pdf_requires_ocr(tmp_path):
    path=tmp_path/'blank.pdf';make_pdf(path,'')
    with pytest.raises(ValueError,match='requires_ocr'):parse_document(path)

def test_non_pdf_rejected(tmp_path):
    path=tmp_path/'fake.pdf';path.write_bytes(b'<html>no</html>')
    with pytest.raises(ValueError,match='invalid'):parse_document(path)

def test_download_redirect_strips_key(tmp_path,monkeypatch):
    monkeypatch.setenv('ZOTERO_LIBRARY_ID','123');keyfile=tmp_path/'key';keyfile.write_text('private-key');monkeypatch.setenv('ZOTERO_API_KEY_FILE',str(keyfile))
    seen=[]
    def respond(request):
        seen.append(request)
        if request.url.host=='api.zotero.org':return httpx.Response(302,headers={'location':'https://zotero.s3.amazonaws.com/file?signature=opaque'})
        assert 'zotero-api-key' not in request.headers
        return httpx.Response(200,content=b'%PDF-test')
    factory=lambda **kwargs:httpx.Client(transport=httpx.MockTransport(respond),**kwargs)
    download_pdf({'data':{'key':'ABCDEFGH','contentType':'application/pdf'}},tmp_path/'result.pdf',factory)
    assert len(seen)==2 and seen[0].headers['zotero-api-key']=='private-key'

def test_download_rejects_untrusted_redirect(tmp_path,monkeypatch):
    monkeypatch.setenv('ZOTERO_LIBRARY_ID','123')
    seen=[]
    def respond(request):seen.append(request);return httpx.Response(302,headers={'location':'https://evil.example/file'})
    with pytest.raises(ValueError,match='Untrusted'):
        download_pdf({'data':{'key':'ABCDEFGH','contentType':'application/pdf'}},tmp_path/'result.pdf',lambda **kw:httpx.Client(transport=httpx.MockTransport(respond),**kw))
    assert len(seen)==1

def test_metadata_without_abstract_and_pdf_idempotence(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'));initialize(a.store)
    item={'data':{'key':'ABCDEFGH','title':'AeroWF metadata','url':'https://example.org/paper'}}
    result=import_items(a.store,'project',[item]);assert result[0]['status']=='skipped'
    source={'kind':'uploaded_pdf','sha256':'a'*64}
    assert queue(a.store,'project','ABCDEFGH',source)==queue(a.store,'project','ABCDEFGH',source)
    with pytest.raises(KeyError):queue(a.store,'other','ABCDEFGH',source)

def test_http_arxiv_normalization():
    item={'title':'Closed loop','url':'http://arxiv.org/abs/2606.22731','abstract':'source '*20}
    assert convert('project',item).uri=='https://arxiv.org/abs/2606.22731'

def test_pdf_replay_does_not_report_false_queue(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'));initialize(a.store)
    import_items(a.store,'p',[{'data':{'key':'ABCDEFGH','title':'No abstract yet'}}])
    source={'kind':'uploaded_pdf','sha256':'b'*64};receipt=queue(a.store,'p','ABCDEFGH',source)
    with a.store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='failed' WHERE job_id=?",(receipt['job_id'],))
    assert queue(a.store,'p','ABCDEFGH',source)['status']=='failed'

def test_api_upload_parse_and_page_isolation(tmp_path):
    from server import create_app
    from fastapi.testclient import TestClient
    from pdf_ingestion import process
    token='pdf-test-token-123456789012345'
    app=create_app(Settings(tmp_path/'state',runner='local_trusted'),token)
    with TestClient(app,headers={'Authorization':'Bearer '+token}) as client:
        for pid in ('one','two'):assert client.post('/api/wb/projects',json={'project_id':pid,'name':pid}).status_code==201
        item={'data':{'key':'ABCDEFGH','title':'Scientific test paper','url':'https://example.org/paper'}}
        client.post('/api/wb/projects/one/zotero/import',json={'items':[item]})
        path=tmp_path/'test.pdf';make_pdf(path)
        url='/api/wb/projects/one/zotero/ABCDEFGH/pdf-upload'
        assert client.post(url,content=b'bad',headers={'Content-Type':'application/pdf'}).status_code==422
        response=client.post(url,content=path.read_bytes(),headers={'Content-Type':'application/pdf'});assert response.status_code==200
        jid=response.json()['job_id']
        assert client.post(url,content=path.read_bytes(),headers={'Content-Type':'application/pdf'}).json()['job_id']==jid
        store=app.state.adapter.store
        with store.connect() as con:row=con.execute('SELECT * FROM wb_pdf_jobs WHERE job_id=?',(jid,)).fetchone()
        manifest=process(store,row)
        with store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='parsed',manifest=? WHERE job_id=?",(json.dumps(manifest),jid))
        result=client.get(f'/api/wb/projects/one/pdf-jobs/{jid}/pages').json()
        assert 'scientific source' in result['text'] and result['page']==1
        assert client.get(f'/api/wb/projects/two/pdf-jobs/{jid}/pages').status_code==404
        assert client.get(f'/api/wb/projects/one/pdf-jobs/{jid}/pages?page=2').status_code==404
        jobs=client.get('/api/wb/projects/one/pdf-jobs').json()
        assert jobs[0]['status']=='parsed' and jobs[0]['ingestion_status']=='pending'
