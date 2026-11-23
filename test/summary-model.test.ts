import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { dshSummaryModel,resolveSummarySelection,type DshLlm } from '../src/knowledge/summary-model.js';
import { migrateKnowledge } from '../src/knowledge/database.js';
import { summarizePaper,KnowledgeError } from '../src/knowledge/paper-service.js';
const json=JSON.stringify({method:'Comparison',datasets:'Test data',conclusions:'Test conclusion'});
const signal=()=>new AbortController().signal;

test('F2 inherits DSH default selection including provider-owned reasoning effort',async()=>{
 let reads=0;let captured:any;
 const model=dshSummaryModel({async *stream(options){captured=options;yield {type:'text-delta',text:json};}},'','',{
  currentSelection(){reads++;return {provider:'configured',model:'default-model',reasoningEffort:'medium'};}
 });
 await model.generate('paper',signal());
 assert.equal(reads,1);assert.equal(captured.provider,'configured');assert.equal(captured.model,'default-model');assert.equal(captured.reasoningEffort,'medium');
});
test('F2 complete override never reads default or inherits another model effort',async()=>{
 let captured:any;
 await dshSummaryModel({async *stream(o){captured=o;yield {type:'text-delta',text:json};}},'override','chosen',{currentSelection(){throw new Error('must not read default');}}).generate('paper',signal());
 assert.equal(captured.provider,'override');assert.equal(captured.model,'chosen');assert.equal('reasoningEffort' in captured,false);
});
test('F2 partial overrides and missing default fail before any stream call',async()=>{
 let calls=0;const llm:DshLlm={async *stream(){calls++;yield {type:'text-delta',text:json};}};
 for(const [p,m] of [['p',''],['','m'],['p','  ']]) await assert.rejects(dshSummaryModel(llm,p,m).generate('paper',signal()),/Set both/);
 await assert.rejects(dshSummaryModel(llm).generate('paper',signal()),/default model service/);
 await assert.rejects(dshSummaryModel(llm,'','',{currentSelection:()=>({provider:'',model:''})}).generate('paper',signal()),/incomplete/);
 assert.equal(calls,0);
 assert.throws(()=>resolveSummarySelection('','',{currentSelection:()=>({provider:'p',model:'m',reasoningEffort:''})}),/reasoningEffort/);
});
test('F2 snapshots each task once while subsequent tasks follow changed DSH defaults',async()=>{
 let selected={provider:'first',model:'model-a',reasoningEffort:'low'};
 let reads=0;const captured:any[]=[];
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const model=dshSummaryModel({async *stream(o){captured.push(o);await gate;yield {type:'text-delta',text:json};}},'','',{currentSelection(){reads++;return selected;}});
 const first=model.generate('first paper',signal());
 selected.provider='second';selected.model='model-b';selected.reasoningEffort='high';
 const second=model.generate('second paper',signal());release();await Promise.all([first,second]);
 assert.equal(reads,2);assert.deepEqual(captured.map(o=>[o.provider,o.model,o.reasoningEffort]),[['first','model-a','low'],['second','model-b','high']]);
});
test('F2 unavailable DSH model propagates failure without fallback or database success',async()=>{
 const db=new Database(':memory:');let calls=0;
 try {
  migrateKnowledge(db);
  db.prepare("INSERT INTO papers(title,file_path,uploader_id,content_hash,status,full_text) VALUES('Test','unused',1,?,'已入库','paper text')").run('d'.repeat(64));
  const unavailable=Object.assign(new Error('Model unavailable'),{code:'NO_ADAPTER'});
  const model=dshSummaryModel({async *stream(){calls++;throw unavailable;}},'','',{currentSelection:()=>({provider:'unavailable',model:'missing'})});
  await assert.rejects(summarizePaper(db,1,1,model),e=>e===unavailable);
  assert.equal(calls,1);assert.equal((db.prepare('SELECT count(*) n FROM kb_entries').get() as {n:number}).n,0);
  await assert.rejects(summarizePaper(db,1,1,dshSummaryModel({async *stream(){throw new Error('must not call');}},'only-provider','')),e=>e instanceof KnowledgeError && e.code===4009 && /Set both/.test(e.message));
 } finally {db.close();}
});
