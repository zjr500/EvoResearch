import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateDatabase} from '../src/infrastructure/migrations.js';
import {importPaper,paperFor,paperView,confirmPaper,updatePendingPaper,summarizePaper,listEntries,entryFor} from '../src/knowledge/paper-service.js';
import {Operations} from '../src/knowledge/operations.js';
import {knowledgeApi} from '../src/knowledge/api.js';
import {KnowledgeModels} from '../src/knowledge/model-configuration.js';
import {PurposeModels} from '../src/infrastructure/models.js';
import {pdf} from './fixtures/pdf.js';
const summary={method:'Controlled comparison',datasets:'Synthetic fixtures',conclusions:'Measured improvement'};
function setup(t:any){const dir=mkdtempSync(join(tmpdir(),'uc01-'));const db=new Database(':memory:');migrateDatabase(db);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {db,dir};}
async function paper(db:Database.Database,dir:string,owner=1,label='Test'){return (await importPaper(db,{filePath:'fixture.pdf',buffer:pdf(['Title: '+label,'Abstract','Original abstract.','Keywords: test']),storageDir:dir,uploaderId:owner})).paper.paper_id;}
const model={async generate(){return summary;}};
function apiFor(db:Database.Database,dir:string,m=model,models?:KnowledgeModels){
 const ops=new Operations(db),api=knowledgeApi(db,ops,dir,m,models);
 const call=async(method:string,path:string,body?:unknown,owner=1)=>{const res=await api(new Request('http://localhost'+path,{method,body:body===undefined?undefined:JSON.stringify(body)}),owner);return {http:res.status,...await res.json() as any};};
 const done=async(r:any)=>{assert.equal(r.http,202);await ops.drain();return ops.get(1,r.data.operation_id) as any;};
 return {ops,call,done};
}
test('UC01 original abstract differs from AI draft; no draft enters KB; edit and confirm preserve distinctions',async t=>{
 const {db,dir}=setup(t),id=await paper(db,dir);
 assert.throws(()=>confirmPaper(db,1,id,{}),/Generate/);
 await summarizePaper(db,1,id,model);
 assert.deepEqual(listEntries(db,1,new URLSearchParams()).entries,[]);
 const p=paperView(db,1,id);assert.match(p.abstract!,/Original/);assert.deepEqual(p.summary,summary);assert.equal(p.document_id,null);
 updatePendingPaper(db,1,id,{title:'Corrected',authors:'Author',year:2023,pending_summary:{...summary,conclusions:'User reviewed'},expected_revision:p.revision});
 const rev=paperFor(db,1,id).revision;
 confirmPaper(db,1,id,{expected_revision:rev});
 const saved=paperView(db,1,id);assert.equal(saved.status,'已入库');assert.equal(saved.pending_summary,null);assert.equal(saved.summary.conclusions,'User reviewed');
 assert.equal(entryFor(db,1,saved.document_id!).title,'Corrected');assert.match(saved.abstract!,/Original/);
 const event=db.prepare('SELECT * FROM knowledge_sync_events').get() as any;assert.equal(event.document_id,saved.document_id);assert.equal(event.index_status,'pending');assert.equal(event.graph_status,'pending');
 confirmPaper(db,1,id,{});assert.equal((db.prepare('SELECT count(*) n FROM kb_entries').get() as any).n,1);
 assert.throws(()=>confirmPaper(db,1,id,{expected_revision:rev}),/revision/);
});
test('UC01 regeneration replaces draft only on success, preserves it on transport/invalid output/cancellation failure',async t=>{
 const {db,dir}=setup(t),id=await paper(db,dir);await summarizePaper(db,1,id,model);
 const old=paperFor(db,1,id).pending_summary;
 for(const bad of [{async generate(){throw Error('SYNTHETIC_PRIVATE_DETAIL');}},{async generate(){return {method:'incomplete'};}}]){
  await assert.rejects(summarizePaper(db,1,id,bad));assert.equal(paperFor(db,1,id).pending_summary,old);assert.equal(paperFor(db,1,id).summary_status,'failed');
 }
 const ac=new AbortController();ac.abort();await assert.rejects(summarizePaper(db,1,id,model,ac.signal));assert.equal(paperFor(db,1,id).pending_summary,old);
 await summarizePaper(db,1,id,{async generate(){return {...summary,method:'New method'};}});assert.equal(paperView(db,1,id).summary.method,'New method');assert.equal(paperFor(db,1,id).summary_error,null);
 assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,0);
});
test('UC01 concurrent model work is fenced; edits including authors invalidate an in-flight summary',async t=>{
 const {db,dir}=setup(t),id=await paper(db,dir);await summarizePaper(db,1,id,model);let calls=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const slow={async generate(){calls++;await gate;return {...summary,conclusions:'Stale output'};}};
 const active=summarizePaper(db,1,id,slow);
 await assert.rejects(summarizePaper(db,1,id,slow),/already running/);assert.equal(calls,1);
 assert.throws(()=>confirmPaper(db,1,id,{}),/running/);
 const rev=paperFor(db,1,id).revision;updatePendingPaper(db,1,id,{authors:'Concurrent edit',expected_revision:rev});
 assert.throws(()=>updatePendingPaper(db,1,id,{title:'Lost update',expected_revision:rev}),/revision/);
 release();await assert.rejects(active,/changed/);assert.equal(paperView(db,1,id).summary.conclusions,summary.conclusions);assert.equal(paperFor(db,1,id).authors,'Concurrent edit');
});
test('UC01 confirmation atomically commits paper, KB entry and durable handoff; storage failure rolls all back',async t=>{
 const {db,dir}=setup(t),id=await paper(db,dir);await summarizePaper(db,1,id,model);
 const before=paperFor(db,1,id);
 db.exec("CREATE TRIGGER reject_sync BEFORE INSERT ON knowledge_sync_events BEGIN SELECT RAISE(ABORT,'simulated disk constraint'); END");
 assert.throws(()=>confirmPaper(db,1,id,{}),/simulated/);assert.deepEqual(paperFor(db,1,id),before);assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,0);
 db.exec('DROP TRIGGER reject_sync');confirmPaper(db,1,id,{});assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,1);
});
test('UC01 multiple independent uploads, parsing/model partial failures, concurrent duplicates, batch confirmation and replay',async t=>{
 const {db,dir}=setup(t);let calls=0;const a=apiFor(db,dir,{async generate(){calls++;return summary;}});
 const body={idempotency_key:'one',pdf_base64:pdf().toString('base64')};
 const accepted=await Promise.all([a.call('POST','/papers',body),a.call('POST','/papers',{...body,idempotency_key:'duplicate'}),a.call('POST','/papers',{idempotency_key:'bad',pdf_base64:Buffer.from('%PDF-broken').toString('base64')}),a.call('POST','/papers',{idempotency_key:'invalid',pdf_base64:Buffer.from('not pdf').toString('base64')})]);
 await a.ops.drain();const results=accepted.map(x=>a.ops.get(1,x.data.operation_id) as any);
 assert.deepEqual(results.map(r=>r.status),['成功','成功','失败','失败']);assert.equal(calls,1);
 const id=results[0].result.paper.paper_id;assert.equal(results[1].result.paper.paper_id,id);
 assert.equal((await a.call('POST','/papers',body)).data.operation_id,accepted[0].data.operation_id);assert.equal(calls,1);
 const broken=results[2].result.paperId;assert.equal(paperFor(db,1,broken).status,'待补全');
 const other=await paper(db,dir,2);await summarizePaper(db,2,other,model);
 const batch={idempotency_key:'batch',paper_ids:[id,broken,other,999],expected_revisions:{[id]:paperFor(db,1,id).revision,[broken]:paperFor(db,1,broken).revision,[other]:1,999:0}};
 const request=await a.call('POST','/papers/confirm',batch);const done=await a.done(request);assert.deepEqual(done.result.items.map((r:any)=>r.code),[0,4001,4004,4004]);
 assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,1);assert.equal(listEntries(db,2,new URLSearchParams()).entries.length,0);
 assert.equal((await a.call('POST','/papers/confirm',batch)).data.operation_id,request.data.operation_id);
 assert.equal((await a.call('POST','/papers/confirm',{...batch,paper_ids:[id,id]})).code,4001);
 assert.equal((await a.call('GET','/papers/'+id,undefined,2)).code,4004);
});
test('UC01 PATCH follows async operation protocol, validates revisions, sanitizes errors and never exposes source path',async t=>{
 const {db,dir}=setup(t),id=await paper(db,dir);await summarizePaper(db,1,id,model);const a=apiFor(db,dir);
 const input={idempotency_key:'edit',expected_revision:paperFor(db,1,id).revision,title:'Reviewed',summary:{...summary,datasets:'Edited'}};
 const accepted=await a.call('PATCH','/papers/'+id,input);const result=await a.done(accepted);assert.equal(result.status,'成功');assert.equal(result.result.summary.datasets,'Edited');assert.equal('file_path' in result.result,false);assert.equal('summary_run' in result.result,false);
 assert.equal((await a.call('PATCH','/papers/'+id,input)).data.operation_id,accepted.data.operation_id);
 const conflict=await a.done(await a.call('PATCH','/papers/'+id,{...input,idempotency_key:'stale'}));assert.equal(conflict.error_code,4009);
 assert.equal((await a.call('PATCH','/papers/'+id,{idempotency_key:'missing',title:'X'})).code,4001);
 const forbidden=await a.call('PATCH','/papers/'+id,{...input,idempotency_key:'owner',owner_id:2});assert.equal(forbidden.code,4001);
 const failing=apiFor(db,dir,{async generate(){throw Error('SYNTHETIC_PRIVATE_DETAIL');}});
 const fail=await failing.done(await failing.call('POST','/papers/'+id+'/summary',{idempotency_key:'fail'}));assert.equal(fail.status,'失败');assert.doesNotMatch(JSON.stringify(fail),/SYNTHETIC_PRIVATE_DETAIL/);assert.equal(paperView(db,1,id).summary.datasets,'Edited');
});
test('UC01 catalog configuration validates before replacing, isolates owners and snapshots DSH model/effort without a paid validation call',async t=>{
 const {db,dir}=setup(t);let streams=0;const seen:any[]=[];let selected={provider:'p',model:'m',reasoningEffort:'low'};
 const llm={listProviders:()=>[{id:'p',name:'Provider'}],listConfigurableProviders:()=>[{provider:'p',displayName:'Provider',settingsNs:'native-settings'}],async listModels(p:string){if(p!=='p')throw Error('SYNTHETIC_PRIVATE_DETAIL');return [{id:'m'},{id:'n'}];},async *stream(o:any){streams++;seen.push(o);yield {type:'text-delta',text:JSON.stringify(summary)};}};
 const models=new KnowledgeModels(db,new PurposeModels(llm,{currentSelection:()=>selected},{}),llm);
 await models.configure(1,{mode:'dsh-default'},0);assert.equal(streams,0);
 const previous=models.view(1);await assert.rejects(models.configure(1,{mode:'selected',provider:'bad',model:'m'},1),/unavailable/);assert.deepEqual(models.view(1),previous);
 await assert.rejects(models.configure(1,{mode:'selected',provider:'p',model:'m',apiKey:'SYNTHETIC_PRIVATE_DETAIL'},1),/Unsupported/);assert.deepEqual(models.view(1),previous);
 assert.equal(models.view(2).revision,0);
 const snap=await models.snapshot(1);selected={provider:'p',model:'n',reasoningEffort:'high'};await snap.generate('text',new AbortController().signal);assert.equal(seen[0].model,'m');assert.equal(seen[0].reasoningEffort,'low');
 const a=apiFor(db,dir,model,models);const rejected=await a.done(await a.call('PUT','/models/summary',{idempotency_key:'bad-model',model_choice:{mode:'selected',provider:'bad',model:'x'},expected_revision:1}));assert.equal(rejected.status,'失败');assert.doesNotMatch(JSON.stringify(rejected),/SYNTHETIC_PRIVATE_DETAIL/);assert.deepEqual(models.view(1),previous);
 const catalog=await a.call('GET','/models?purpose=summary');assert.equal(catalog.data.providers[0].id,'p');
});
test('UC01 true v2 upgrade preserves confirmed summaries, legacy IDs and old operations; unindexed confirmed paper becomes repairable',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'uc01-legacy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'old.sqlite');let db=new Database(path);
 try{
  db.exec(readFileSync('migrations/knowledge/001_papers.sql','utf8'));db.exec(readFileSync('migrations/knowledge/002_knowledge.sql','utf8'));db.exec('CREATE TABLE knowledge_migrations(version INTEGER PRIMARY KEY); INSERT INTO knowledge_migrations VALUES(2)');
  for(const id of [7,8])db.prepare("INSERT INTO papers(paper_id,title,file_path,uploader_id,content_hash,status,full_text) VALUES(?,'Legacy','original.pdf',1,?,'已入库','Original text')").run(id,String(id).repeat(64));
  db.prepare("INSERT INTO kb_entries(entry_id,type,title,content,source_type,source_id,owner_id) VALUES(15,'paper_summary','Legacy',?,'paper',7,1)").run(JSON.stringify(summary));
  db.exec("INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,request_digest,status,result_json) VALUES(21,1,'historic','paper-summary','digest','成功','{\"document_id\":15}')");
  migrateDatabase(db);migrateDatabase(db);db.close();db=new Database(path);migrateDatabase(db);
  assert.equal(paperFor(db,1,7).status,'已入库');assert.deepEqual(entryFor(db,1,15).content,summary);assert.equal(paperFor(db,1,8).status,'待确认');assert.equal((db.prepare('SELECT legacy_status FROM papers WHERE paper_id=8').get() as any).legacy_status,'已入库');
  assert.equal((new Operations(db).get(1,21).result as any).document_id,15);
  await summarizePaper(db,1,8,model);confirmPaper(db,1,8,{});assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,2);assert.equal(paperFor(db,1,8).file_path,'original.pdf');
 }finally{db.close();}
});

test('UC01 failing model on one upload retains repairable paper and does not prevent another upload from succeeding',async t=>{
 const {db,dir}=setup(t);let calls=0;const a=apiFor(db,dir,{async generate(){calls++;if(calls===1)throw Error('SYNTHETIC_PRIVATE_DETAIL');return summary;}});
 const first=await a.done(await a.call('POST','/papers',{idempotency_key:'first',pdf_base64:pdf(['Title: First','Abstract','Content']).toString('base64')}));
 assert.equal(first.status,'失败');assert.doesNotMatch(JSON.stringify(first),/SYNTHETIC_PRIVATE_DETAIL/);const id=first.result.paper.paper_id;assert.equal(paperFor(db,1,id).summary_status,'failed');assert.equal(paperView(db,1,id).document_id,null);
 const second=await a.done(await a.call('POST','/papers',{idempotency_key:'second',pdf_base64:pdf(['Title: Second','Abstract','Content']).toString('base64')}));assert.equal(second.status,'成功');
 const retry=await a.done(await a.call('POST','/papers/'+id+'/summary',{idempotency_key:'explicit-retry'}));assert.equal(retry.status,'成功');assert.equal(calls,3);assert.equal(listEntries(db,1,new URLSearchParams()).entries.length,0);
});
test('UC01 manual original abstract change requires a new summary, and duplicate malformed PDF remains a failure',async t=>{
 const {db,dir}=setup(t),a=apiFor(db,dir);
 const body={idempotency_key:'broken1',pdf_base64:Buffer.from('%PDF-invalid').toString('base64')};
 const first=await a.done(await a.call('POST','/papers',body));const id=first.result.paperId;
 const again=await a.done(await a.call('POST','/papers',{...body,idempotency_key:'broken2'}));assert.equal(again.status,'失败');assert.equal(again.result.paper.paper_id,id);
 updatePendingPaper(db,1,id,{title:'Manual',abstract:'Original supplied text'});await summarizePaper(db,1,id,model);
 assert.throws(()=>confirmPaper(db,1,id,{abstract:'Changed original'}),/regenerate/);
 updatePendingPaper(db,1,id,{abstract:'Changed original'});assert.equal(paperFor(db,1,id).pending_summary,null);assert.throws(()=>confirmPaper(db,1,id,{}),/Generate/);
 await summarizePaper(db,1,id,model);confirmPaper(db,1,id,{});assert.equal(paperFor(db,1,id).status,'已入库');
});
test('UC01 v3 upgrade preserves existing AI drafts and published entries, exposes owner-isolated durable events',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 for(const file of ['001_papers.sql','002_knowledge.sql','003_pending_summary.sql'])db.exec(readFileSync('migrations/knowledge/'+file,'utf8'));
 db.exec('CREATE TABLE knowledge_migrations(version INTEGER PRIMARY KEY); INSERT INTO knowledge_migrations VALUES(2),(3)');
 db.prepare("INSERT INTO papers(paper_id,title,file_path,uploader_id,content_hash,pending_summary) VALUES(1,'Draft','kept.pdf',1,?,?)").run('f'.repeat(64),JSON.stringify(summary));
 migrateDatabase(db);migrateDatabase(db);assert.deepEqual(paperView(db,1,1).summary,summary);assert.equal(paperFor(db,1,1).summary_status,'ready');
 const {knowledgePublications}=await import('../src/knowledge/publication.js');assert.deepEqual(knowledgePublications(db,1),[]);
 confirmPaper(db,1,1,{});const events=knowledgePublications(db,1) as any[];assert.equal(events.length,1);assert.equal(events[0].index_status,'pending');assert.deepEqual(knowledgePublications(db,2),[]);assert.deepEqual(knowledgePublications(db,1,events[0].event_id),[]);
});
