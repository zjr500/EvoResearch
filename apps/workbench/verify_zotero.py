"""Read-only live Zotero/PDF/Graphiti acceptance evidence (no private text export)."""
import argparse,json,os,time,hashlib
from dataclasses import asdict
from pathlib import Path
from manage import environment,PRIVATE,ROOT
from zotero import fetch_page
from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter
from evoresearch.graphiti_adapter import GraphitiAdapter

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--project',default='zotero-live-papers');parser.add_argument('--wait',type=int,default=0)
    args=parser.parse_args()
    os.environ.update(environment(json.loads((PRIVATE/'config.json').read_text(encoding='utf-8'))))
    a=AutoResearchAdapter(Settings.from_env());deadline=time.monotonic()+args.wait;previous=None
    while True:
        with a.store.connect() as con:
            rows=[dict(r) for r in con.execute('SELECT record_id,status,episode_id,last_error,attempts,body FROM evo_knowledge WHERE project_id=?',(args.project,))]
            jobs=[dict(r) for r in con.execute('SELECT job_id,item_key,status,error,manifest FROM wb_pdf_jobs WHERE project_id=?',(args.project,))]
        counts={s:sum(r['status']==s for r in rows) for s in sorted({r['status'] for r in rows})}
        if counts!=previous:print(json.dumps({'knowledge':counts}),flush=True);previous=counts
        if rows and all(r['status']=='retrievable' for r in rows):break
        if time.monotonic()>=deadline:break
        time.sleep(15)
    backend=GraphitiAdapter.from_env(a.store)
    try:
        queries=['Closed-loop Auto Research held-out certification molecular property prediction',
                 'MapLight CatBoost ECFP Avalon ErG RDKit molecular representations',
                 'AeroWF geometric spectral temporal dual stream weather forecasting']
        retrieval=[]
        for query in queries:
            hits=backend.retrieve_joint(query,args.project,20)
            # Store source IDs/URIs; facts remain private in the local runtime.
            retrieval.append({'query':query,'hits':[{'record_id':x.source_id,'source_type':x.source_type,'uri':asdict(x).get('uri',asdict(x).get('source_uri'))} for x in hits]})
        confirmed=backend.verify_retrievable(args.project,[r['record_id'] for r in rows if r['status']=='retrievable'])
    finally:backend.close()
    items=fetch_page()['items']
    pdf_ids={r['record_id'] for r in rows if json.loads(r['body'])['source_ref'].split(':')[2].startswith('pdf-')}
    result={'date':'2026-10-26','project_id':args.project,
            'zotero_items':[{'key':x['key'],'title':x['data'].get('title'),'version':x['data'].get('version'),
                             'doi':x['data'].get('DOI'),'uri':x['data'].get('url'),'author_count':len(x['data'].get('creators',[])),
                             'abstract_characters':len(x['data'].get('abstractNote','')),
                             'abstract_sha256':hashlib.sha256(x['data'].get('abstractNote','').encode()).hexdigest(),
                             'children':x.get('meta',{}).get('numChildren',0)} for x in items],
            'pdf_jobs':[{**j,'manifest':json.loads(j['manifest']) if j['manifest'] else None} for j in jobs],
            'knowledge_counts':counts,'live_visibility_verified':confirmed,
            'records':[{k:v for k,v in r.items() if k!='body'} for r in rows],
            'retrieval':retrieval,'fulltext_returned_in_search':any(h['record_id'] in pdf_ids for q in retrieval for h in q['hits']),
            'pdf_download_provenance':{'zotero_attachment':'download was HTTP 404 at initial test','official_fallback':'https://arxiv.org/pdf/2606.22731','uploaded_through_api':True},
            'limitations':['AeroWF requires its own abstract/PDF; unrelated hits are not proof of AeroWF ingestion.',
                           'Text-layer PDF extraction; no OCR or structural formula/table/image understanding.',
                           'Browser interaction remains pending user acceptance.']}
    target=ROOT/'.audit-data/zotero-paper-acceptance.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(target),'fulltext_returned_in_search':result['fulltext_returned_in_search'],'all_knowledge_retrievable':all(r['status']=='retrievable' for r in rows)}),flush=True)

if __name__=='__main__':main()
