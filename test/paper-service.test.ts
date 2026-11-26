import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateKnowledge } from '../src/knowledge/database.js';
import { Operations } from '../src/knowledge/operations.js';
import { knowledgeApi } from '../src/knowledge/api.js';
import { dshSummaryModel } from '../src/knowledge/summary-model.js';
import {
 importPaper,
 confirmPaper,
 summarizePaper,
 entryFor,
 paperFor,
 KnowledgeError,
 updatePendingPaper
} from '../src/knowledge/paper-service.js';

import {pdf} from './fixtures/pdf.js';
const mock={async generate(){return {method:'Controlled comparison',datasets:'Synthetic data',conclusions:'Method A improves accuracy'};}};
async function setup(run:(db:Database.Database,dir:string)=>Promise<void>) {const db=new Database(':memory:');const dir=await mkdtemp(join(tmpdir(),'evo-f1-'));try{migrateKnowledge(db);await run(db,dir);}finally{db.close();await rm(dir,{recursive:true,force:true});}}
test('real PDF metadata extraction, confirmation, same-owner dedup and different-owner isolation',()=>setup(async(db,dir)=>{
 const input={filePath:'sample.pdf',buffer:pdf(),storageDir:dir,uploaderId:1};
 const first=await importPaper(db,input);assert.equal(first.paper.title,'A Study');assert.equal(first.paper.authors,'Alice Smith');assert.equal(first.paper.year,2024);assert.match(first.paper.abstract!,/two methods/);
 assert.equal((await importPaper(db,input)).duplicated,true);
 const second=await importPaper(db,{...input,uploaderId:2});assert.notEqual(second.paper.paper_id,first.paper.paper_id);
 assert.throws(()=>paperFor(db,2,first.paper.paper_id),/not found/);
 assert.throws(
 ()=>confirmPaper(db,1,first.paper.paper_id,{}),
 /Generate paper summary first/
);

await summarizePaper(db,1,first.paper.paper_id,mock);

assert.equal(
 (db.prepare('SELECT count(*) n FROM kb_entries').get() as any).n,
 0
);

assert.equal(
 confirmPaper(db,1,first.paper.paper_id,{title:'Confirmed'}).status,
 '已入库'
);

assert.equal(
 (db.prepare('SELECT count(*) n FROM kb_entries').get() as any).n,
 1
);
}));
test('invalid PDF creates no Paper; corrupted PDF preserves a repairable Paper',()=>setup(async(db,dir)=>{
 await assert.rejects(importPaper(db,{filePath:'x',buffer:Buffer.from('not pdf'),uploaderId:1,storageDir:dir}),e=>e instanceof KnowledgeError && (e.data as any).paperId===null);
 assert.equal((db.prepare('SELECT count(*) n FROM papers').get() as any).n,0);
 let id=0;await assert.rejects(importPaper(db,{filePath:'x',buffer:Buffer.from('%PDF-1.4\nbroken'),uploaderId:1,storageDir:dir}),e=>{id=(e as KnowledgeError).data?((e as KnowledgeError).data as any).paperId:0;return id>0;});
 assert.equal(paperFor(db,1,id).status,'待补全');
 updatePendingPaper(db,1,id,{
 title:'Manually completed',
 abstract:'Supplied by user'
});

await summarizePaper(db,1,id,mock);

confirmPaper(db,1,id,{});
 assert.equal(paperFor(db,1,id).status,'已入库');
}));
test('missing metadata stays null and can be completed',()=>setup(async(db,dir)=>{
 const {paper}=await importPaper(db,{filePath:'x',buffer:pdf(['Some unlabelled text']),uploaderId:1,storageDir:dir});
 assert.equal(paper.title,null);assert.equal(paper.year,null);assert.throws(()=>confirmPaper(db,1,paper.paper_id,{}),/Title/);
 updatePendingPaper(db,1,paper.paper_id,{
 title:'User title',
 authors:'User author',
 year:2020
});

await summarizePaper(db,1,paper.paper_id,mock);

assert.equal(
 confirmPaper(db,1,paper.paper_id,{}).year,
 2020
);
}));
test('summary model success saves linked structured entry; failure and invalid output do not create fake success',()=>setup(async(db,dir)=>{
 const {paper}=await importPaper(db,{filePath:'x',buffer:pdf(),uploaderId:1,storageDir:dir});
 assert.throws(()=>confirmPaper(db,1,paper.paper_id,{}),/Generate paper summary first/);
 await assert.rejects(summarizePaper(db,1,paper.paper_id,{async generate(){throw new Error('provider unavailable');}}));
 await assert.rejects(summarizePaper(db,1,paper.paper_id,{async generate(){return {method:'only one field'};}}));
 assert.equal((db.prepare('SELECT count(*) n FROM kb_entries').get() as any).n,0);
 await summarizePaper(db,1,paper.paper_id,mock);
 const before=paperFor(db,1,paper.paper_id).pending_summary;
 await assert.rejects(summarizePaper(db,1,paper.paper_id,{async generate(){throw new Error('failed refresh');}}));
 assert.equal(paperFor(db,1,paper.paper_id).pending_summary,before);
 confirmPaper(db,1,paper.paper_id,{});const entry=entryFor(db,1,1);
 assert.equal(entry.source_id,paper.paper_id);assert.equal(entry.type,'paper_summary');assert.equal(entry.content.datasets,'Synthetic data');
 assert.throws(()=>entryFor(db,2,Number(entry.document_id)),/not found/);
}));
test('legacy migration preserves data, removes global uniqueness and is repeatable',()=>setup(async(db)=>{
 migrateKnowledge(db);assert.equal((db.prepare('SELECT count(*) n FROM knowledge_migrations').get() as any).n,4);
 db.prepare("INSERT INTO papers(title,file_path,uploader_id,content_hash) VALUES('legacy','x',1,?)").run('a'.repeat(64));
 db.prepare("INSERT INTO papers(title,file_path,uploader_id,content_hash) VALUES('other','x',2,?)").run('a'.repeat(64));
 assert.equal((db.prepare('SELECT count(*) n FROM papers').get() as any).n,2);
}));
test('REST async import/confirm/summary/query, ownership rejection, idempotency conflict and restart recovery',()=>setup(async(db,dir)=>{
 const ops=new Operations(db),api=knowledgeApi(db,ops,dir,mock);
 const call=async(method:string,path:string,body?:unknown,owner=1)=>{const r=await api(new Request('http://localhost'+path,{method,body:body?JSON.stringify(body):undefined}),owner);return r.json() as Promise<any>;};
 const body={idempotency_key:'upload',pdf_base64:pdf().toString('base64')};
 const accepted=await call('POST','/papers',body);assert.equal(accepted.code,0);await ops.drain();
 const done=await call('GET',`/kb/operations/${accepted.data.operation_id}`);assert.equal(done.data.status,'成功');const id=done.data.result.paper.paper_id;
 assert.equal((await call('POST','/papers',body)).data.operation_id,accepted.data.operation_id);
 assert.equal((await call('POST','/papers',{...body,pdf_base64:pdf(['Other']).toString('base64')})).code,4020);
 assert.equal((await call('POST','/papers',{...body,owner_id:2})).code,4001);
 assert.equal((await call('GET',`/papers/${id}`,undefined,2)).code,4004);

 const sum=await call('POST',`/papers/${id}/summary`,{idempotency_key:'summary'});await ops.drain();
 assert.equal((await call('GET',`/kb/operations/${sum.data.operation_id}`)).data.status,'成功');
 assert.equal((await call('GET','/kb/entries')).data.entries.length,0);
 await call('PUT',`/papers/${id}`,{idempotency_key:'confirm',expected_revision:paperFor(db,1,id).revision});await ops.drain();
 assert.equal((await call('GET','/kb/entries')).data.entries.length,1);
 assert.equal((await call('GET','/kb/entries',undefined,2)).data.entries.length,0);
 db.prepare("INSERT INTO knowledge_operations(owner_id,idempotency_key,operation_type,request_digest,status) VALUES(1,'interrupted','summary','x','执行中')").run();
 new Operations(db);assert.equal((db.prepare("SELECT status FROM knowledge_operations WHERE idempotency_key='interrupted'").get() as any).status,'失败');
}));
test('real DSH model adapter consumes stream, forwards provider/model and rejects malformed model output (mock transport)',async()=>{
 let options:any;const model=dshSummaryModel({async *stream(o){options=o;yield {type:'text-delta',text:JSON.stringify(await mock.generate())};}},'provider','model');
 const result=await model.generate('paper text',new AbortController().signal);assert.equal((result as any).method,'Controlled comparison');assert.equal(options.provider,'provider');assert.equal(options.messages[0].content[0].text,'paper text');
 await assert.rejects(dshSummaryModel({async *stream(){yield {type:'text-delta',text:'not JSON'};}},'p','m').generate('x',new AbortController().signal));
});

test('concurrent same-owner imports resolve to one stored PDF and paper',()=>setup(async(db,dir)=>{
 const input={filePath:'concurrent.pdf',buffer:pdf(),storageDir:dir,uploaderId:1};
 const results=await Promise.all(Array.from({length:8},()=>importPaper(db,input)));
 assert.equal(new Set(results.map(r=>r.paper.paper_id)).size,1);
 assert.equal(results.filter(r=>!r.duplicated).length,1);
 assert.equal((db.prepare('SELECT count(*) n FROM papers').get() as {n:number}).n,1);
 assert.equal(paperFor(db,1,results[0].paper.paper_id).title,'A Study');
}));
