"""Durable PDF parsing jobs; Graphiti projection remains a separate worker."""
import hashlib,json,os,subprocess,sys,time,uuid
from pathlib import Path
from evoresearch.papers import PaperInput,enqueue
from zotero import citation,download_pdf,initialize as init_zotero

MAX_BYTES=50*1024*1024

def initialize(store):
    init_zotero(store)
    with store.connect() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS wb_pdf_jobs(
          job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,item_key TEXT NOT NULL,
          source TEXT NOT NULL,status TEXT NOT NULL,manifest TEXT,error TEXT,created REAL NOT NULL,updated REAL NOT NULL)''')

def source_item(store,pid,key):
    initialize(store)
    with store.connect() as con:row=con.execute('SELECT body FROM wb_zotero_items WHERE project_id=? AND item_key=?',(pid,key)).fetchone()
    if not row:raise KeyError('Zotero item not imported into this project')
    return json.loads(row[0])

def queue(store,pid,key,source):
    item=source_item(store,pid,key)
    encoded=json.dumps({'item':item,**source},sort_keys=True,ensure_ascii=False)
    jid=hashlib.sha256((pid+':'+key+':'+encoded).encode()).hexdigest()[:32]
    now=time.time()
    with store.connect() as con:
        con.execute('INSERT OR IGNORE INTO wb_pdf_jobs VALUES(?,?,?,?,?,NULL,NULL,?,?)',(jid,pid,key,encoded,'queued',now,now))
        status=con.execute('SELECT status FROM wb_pdf_jobs WHERE job_id=?',(jid,)).fetchone()[0]
    return {'job_id':jid,'status':status}

def parse_document(path):
    from pypdf import PdfReader
    path=Path(path)
    if path.stat().st_size>MAX_BYTES or not path.read_bytes().startswith(b'%PDF-'):raise ValueError('invalid_or_oversized_pdf')
    reader=PdfReader(path)
    if reader.is_encrypted:raise ValueError('encrypted_pdf_not_supported')
    if len(reader.pages)>200:raise ValueError('pdf_exceeds_200_pages')
    pages=[];total=0
    for index,page in enumerate(reader.pages):
        text=page.extract_text(extraction_mode='layout') or ''
        total+=len(text)
        if total>1_500_000:raise ValueError('pdf_text_limit')
        pages.append({'page':index+1,'text':text,'characters':len(text),'needs_ocr':len(text.strip())<50})
    if not any(not p['needs_ocr'] for p in pages):raise ValueError('no_text_layer_requires_ocr')
    chunks=[];parts=[];page_ids=[];length=0
    def flush():
        nonlocal parts,page_ids,length
        if parts:
            text='\n\n'.join(parts)
            chunks.append({'pages':sorted(set(page_ids)),'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()})
        parts=[];page_ids=[];length=0
    for page in pages:
        text=page['text'].strip()
        if not text:continue
        for start in range(0,len(text),10000):
            part=f"[PDF page {page['page']}]\n"+text[start:start+10000]
            if length+len(part)>12000:flush()
            parts.append(part);page_ids.append(page['page']);length+=len(part)+2
    flush()
    return {'parser':'pypdf-6.12.0-layout-v1','document_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'pages':pages,'chunks':chunks,'page_count':len(pages),'characters':total,
            'warnings':['OCR required on pages: '+','.join(str(p['page']) for p in pages if p['needs_ocr'])] if any(p['needs_ocr'] for p in pages) else []}

def process(store,row):
    source=json.loads(row['source']);folder=store.home/'pdf-jobs'/row['job_id'];folder.mkdir(parents=True,exist_ok=True)
    pdf=folder/'source.pdf'
    if source['kind']=='zotero':
        digest=download_pdf(source['attachment'],pdf)
    else:
        blob=store.home/'pdf-blobs'/source['sha256']
        data=blob.read_bytes()
        if hashlib.sha256(data).hexdigest()!=source['sha256']:raise ValueError('pdf_digest_mismatch')
        pdf.write_bytes(data)
    manifest=folder/'manifest.json'
    result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'parse',str(pdf),str(manifest)],
                   timeout=120,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if result.returncode:
        error_path=manifest.with_suffix('.error.json')
        category=json.loads(error_path.read_text())['error'] if error_path.exists() else 'parser_failed'
        raise ValueError('PDF parse: '+category)
    parsed=json.loads(manifest.read_text(encoding='utf-8'))
    item=source['item']['data'] if 'data' in source['item'] else source['item']
    title=item.get('title','');authors=item.get('creators') or item.get('author') or []
    names='; '.join(x.get('name') or x.get('literal') or ' '.join(filter(None,[x.get('firstName',x.get('given','')),x.get('lastName',x.get('family',''))])) for x in authors) or 'Unknown'
    uri=citation(item)
    records=[]
    # Each chunk has a stable ID and file hash; crash/replay reuses committed chunks.
    for i,chunk in enumerate(parsed['chunks']):
        if len(chunk['text'])<50:continue
        pages=','.join(map(str,chunk['pages']))
        paper=PaperInput(project_id=row['project_id'],paper_id=f"pdf-{parsed['document_sha256'][:24]}-{i:04d}",
            version='pypdf-layout-v1',title=title,authors=names[:500],uri=uri.split('#')[0]+f"#page={chunk['pages'][0]}",
            section=f"PDF full-text chunk {i+1}; pages {pages}; Zotero item {row['item_key']}",text=chunk['text'],document_sha256=parsed['document_sha256'])
        records.append(enqueue(store,paper)|{'pages':chunk['pages'],'text_sha256':chunk['sha256']})
    parsed['records']=records;parsed['source_kind']=source['kind'];parsed['item_key']=row['item_key']
    manifest.write_text(json.dumps(parsed,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'document_sha256':parsed['document_sha256'],'parser':parsed['parser'],'page_count':parsed['page_count'],
            'characters':parsed['characters'],'records':records,'warnings':parsed['warnings'],'source_kind':source['kind']}

def worker(once=False):
    from autoresearch.config import Settings
    from autoresearch.store import Store
    from autoresearch.worker import WorkerLock
    store=Store(Settings.from_env().home);initialize(store)
    with WorkerLock(store.home/'pdf-worker.lock'):
        with store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='queued' WHERE status='parsing'")
        while True:
            with store.connect() as con:rows=list(con.execute("SELECT * FROM wb_pdf_jobs WHERE status='queued' ORDER BY created"))
            for row in rows:
                with store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='parsing',updated=? WHERE job_id=?",(time.time(),row['job_id']))
                try:
                    manifest=process(store,row)
                    with store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='parsed',manifest=?,error=NULL,updated=? WHERE job_id=?",(json.dumps(manifest),time.time(),row['job_id']))
                except Exception as exc:
                    # Never store HTTP URLs, headers, or parser contents in error logs.
                    error=str(exc) if isinstance(exc,ValueError) and str(exc).startswith(('Attachment HTTP','Untrusted','PDF','Attachment hash','Too many')) else type(exc).__name__
                    with store.connect() as con:con.execute("UPDATE wb_pdf_jobs SET status='failed',error=?,updated=? WHERE job_id=?",(error,time.time(),row['job_id']))
            if once:return
            time.sleep(3)

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='parse':
        try:Path(sys.argv[3]).write_text(json.dumps(parse_document(sys.argv[2]),ensure_ascii=False),encoding='utf-8')
        except Exception as exc:
            safe={'invalid_or_oversized_pdf','encrypted_pdf_not_supported','pdf_exceeds_200_pages','pdf_text_limit','no_text_layer_requires_ocr'}
            category=str(exc) if str(exc) in safe else type(exc).__name__
            Path(sys.argv[3]).with_suffix('.error.json').write_text(json.dumps({'error':category}))
            sys.exit(1)
    else:worker('--once' in sys.argv)
