"""Zotero API v3 / CSL JSON -> immutable abstract source snapshots."""
import hashlib,json,os,re
from pathlib import Path
import httpx
from evoresearch.papers import PaperInput,enqueue

def initialize(store):
    with store.connect() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS wb_zotero_items (
          project_id TEXT NOT NULL,item_key TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,
          record_id TEXT,reason TEXT,PRIMARY KEY(project_id,item_key))''')

def citation(data):
    uri=data.get('url') or data.get('URL') or ''
    if uri.startswith('http://arxiv.org/'):uri='https://'+uri[7:]
    if not uri.startswith('https://') and data.get('DOI'):uri='https://doi.org/'+data['DOI']
    return uri


def convert(project_id,item):
    data=item.get('data',item)
    text=data.get('abstractNote') or data.get('abstract') or ''
    if len(text.strip())<50:raise ValueError('摘要不足 50 字符，未入库')
    title=data.get('title','')
    authors=data.get('creators') or data.get('author') or []
    authors='; '.join(x.get('name') or x.get('literal') or ' '.join(filter(None,[x.get('firstName',x.get('given','')),x.get('lastName',x.get('family',''))])) for x in authors)
    uri=citation(data)
    raw=json.dumps(item,sort_keys=True,ensure_ascii=False).encode()
    digest=hashlib.sha256(raw).hexdigest()
    key=str(data.get('key') or data.get('id') or digest[:24])
    key=hashlib.sha256(key.encode()).hexdigest()[:24]
    return PaperInput(project_id=project_id,paper_id='zotero-'+key,version=str(data.get('version') or digest[:16]),
                      title=title,authors=authors or 'Unknown',uri=uri,section='Zotero abstract (metadata snapshot)',
                      text=text,document_sha256=digest)


def import_items(store,project_id,items):
    initialize(store)
    results=[]
    for i,item in enumerate(items):
        data=item.get('data',item)
        item_key=str(data.get('key') or data.get('id') or hashlib.sha256(json.dumps(item,sort_keys=True).encode()).hexdigest()[:24])
        try:
            receipt=enqueue(store,convert(project_id,item))
            result={'index':i,'status':'queued',**receipt}
        except (ValueError,TypeError,KeyError,AttributeError) as exc:
            # Do not return third-party contents or credential-bearing errors.
            result={'index':i,'status':'skipped','reason':'摘要不足 50 字符，元数据已保存' if len(data.get('abstractNote') or data.get('abstract') or '')<50 else '来源字段无效或版本冲突，元数据已保存'}
        with store.connect() as con:
            con.execute('INSERT OR REPLACE INTO wb_zotero_items VALUES(?,?,?,?,?,?)',
                        (project_id,item_key,json.dumps(item,ensure_ascii=False),result['status'],result.get('record_id'),result.get('reason')))
        results.append(result|{'item_key':item_key})
    return results

def library_config():
    kind=os.getenv('ZOTERO_LIBRARY_TYPE','users');library=os.getenv('ZOTERO_LIBRARY_ID','')
    if kind not in ('users','groups') or not library.isdigit():raise ValueError('Zotero library is not configured')
    headers={'Zotero-API-Version':'3'}
    keyfile=os.getenv('ZOTERO_API_KEY_FILE')
    if keyfile:headers['Zotero-API-Key']=Path(keyfile).read_text(encoding='utf-8-sig').strip()
    return f'https://api.zotero.org/{kind}/{library}',headers

def children(item_key):
    if not re.fullmatch('[A-Z0-9]{8}',item_key):raise ValueError('Invalid Zotero key')
    base,headers=library_config()
    with httpx.Client(timeout=30,follow_redirects=False) as client:
        response=client.get(f'{base}/items/{item_key}/children',headers=headers)
        if response.status_code!=200:raise ValueError(f'Zotero HTTP {response.status_code}')
        return response.json()

def download_pdf(attachment,destination,client_factory=httpx.Client):
    from urllib.parse import urlparse
    data=attachment['data'];key=data['key']
    if not re.fullmatch('[A-Z0-9]{8}',key) or data.get('contentType')!='application/pdf':raise ValueError('Not a PDF attachment')
    base,headers=library_config();url=f'{base}/items/{key}/file';limit=50*1024*1024
    # Only the fixed API origin receives credentials. A signed storage URL gets a fresh unauthenticated client.
    for attempt in range(3):
        with client_factory(timeout=60,follow_redirects=False) as client:
            with client.stream('GET',url,headers=headers) as response:
                if response.status_code in (301,302,303,307,308):
                    target=response.headers.get('location','');parsed=urlparse(target)
                    host=parsed.hostname or ''
                    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not (host=='files.zotero.net' or host.endswith('.zotero.org') or host.endswith('.s3.amazonaws.com') or host.startswith('zotero.') and host.endswith('.amazonaws.com')):
                        raise ValueError('Untrusted attachment redirect')
                    url=target;headers={};continue
                if response.status_code!=200:raise ValueError(f'Attachment HTTP {response.status_code}')
                if int(response.headers.get('content-length','0'))>limit:raise ValueError('PDF exceeds 50 MB')
                content=bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content)>limit:raise ValueError('PDF exceeds 50 MB')
        if not content.startswith(b'%PDF-'):raise ValueError('Attachment is not a PDF')
        if data.get('md5') and hashlib.md5(content).hexdigest()!=data['md5']:raise ValueError('Attachment hash changed; resync Zotero')
        Path(destination).write_bytes(content)
        return hashlib.sha256(content).hexdigest()
    raise ValueError('Too many attachment redirects')


def fetch_page(start=0,client=None):
    kind=os.getenv('ZOTERO_LIBRARY_TYPE','users');library=os.getenv('ZOTERO_LIBRARY_ID','')
    if kind not in ('users','groups') or not library.isdigit():raise ValueError('Zotero library is not configured')
    headers={'Zotero-API-Version':'3'}
    keyfile=os.getenv('ZOTERO_API_KEY_FILE')
    if keyfile:headers['Zotero-API-Key']=Path(keyfile).read_text(encoding='utf-8-sig').strip()
    own=client is None
    client=client or httpx.Client(timeout=30,follow_redirects=False)
    try:
        response=client.get(f'https://api.zotero.org/{kind}/{library}/items/top',
                            params={'format':'json','start':start,'limit':100},headers=headers)
        if response.status_code!=200:raise ValueError(f'Zotero HTTP {response.status_code}')
        items=response.json()
        if not isinstance(items,list):raise ValueError('Invalid Zotero response')
        total=int(response.headers.get('Total-Results',len(items)+start))
        return {'items':items,'next_start':start+len(items) if items and start+len(items)<total else None,'total':total}
    finally:
        if own:client.close()
