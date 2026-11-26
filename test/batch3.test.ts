import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {migrateDatabase} from '../src/infrastructure/migrations.js';
import {OperationService} from '../src/infrastructure/operations.js';
import {operationApi} from '../src/infrastructure/operation-api.js';
import {PurposeModels} from '../src/infrastructure/models.js';
const signal=new AbortController().signal;
const request={system:'test',messages:[] as any,signal,maxTokens:10};
function database(t:any){const db=new Database(':memory:');migrateDatabase(db);t.after(()=>db.close());return db;}

test('public operation query spans modules but never owners and retains old knowledge projection',async t=>{
 const db=database(t),knowledge=new OperationService(db),experiments=new OperationService(db,'experiments');
 const a=knowledge.submit(1,'a','summary',{},async()=>({document_id:1})),b=experiments.submit(1,'b','train',{},async()=>({run:2})),c=experiments.submit(2,'c','train',{},async()=>({run:3}));
 await Promise.all([knowledge.drain(),experiments.drain()]);const api=operationApi(knowledge);
 for(const op of [a,b]){const res=await api(new Request('http://local/operations/'+op.operation_id),1);assert.equal(res.status,200);const data=(await res.json() as any).data;assert.deepEqual(Object.keys(data).sort(),['operation_id','operation_type','status','result_ref','error','updated_at'].sort());assert.equal(data.status,'成功');}
 assert.equal((await api(new Request('http://local/operations/'+c.operation_id),1)).status,404);
 assert.equal((await api(new Request('http://local/operations/9007199254740992'),1)).status,400);
 assert.equal((await api(new Request('http://local/operations/1',{method:'POST'}),1)).status,404);
 assert.deepEqual(knowledge.get(1,Number(a.operation_id)).result,{document_id:1});
});

test('purpose models independently inherit, override and snapshot while keeping DSH streaming',async()=>{
 let selected={provider:'default',model:'a',reasoningEffort:'high'},reads=0;const calls:any[]=[];
 const service=new PurposeModels({async *stream(o){calls.push(o);yield {type:'text-delta',text:'ok'};}},{currentSelection(){reads++;return selected;}},{EVORESEARCH_EXPERIMENT_PROVIDER:'other',EVORESEARCH_EXPERIMENT_MODEL:'b'});
 const a=service.stream('summary',request),b=service.stream('experiment',request);selected.model='changed';
 for await(const _ of a){}for await(const _ of b){}
 assert.equal(reads,1);assert.deepEqual(calls.map(x=>[x.provider,x.model,x.reasoningEffort]),[['default','a','high'],['other','b',undefined]]);
 assert.equal(service.selection('experiment',{mode:'dsh-default'}).model,'changed');
 assert.deepEqual(service.selection('summary',{mode:'selected',provider:'p',model:'m',reasoningEffort:'low'}),{provider:'p',model:'m',reasoningEffort:'low'});
 assert.throws(()=>new PurposeModels({stream(){throw new Error('never');}},undefined,{EVORESEARCH_EXPERIMENT_PROVIDER:'p'}).selection('experiment'),/Set both/);
 assert.throws(()=>service.selection('summary',{mode:'selected',provider:'p',model:''}),/incomplete/);
 const bad=new PurposeModels({async *stream(){throw new Error('DSH model unavailable');}},{currentSelection:()=>({provider:'p',model:'m'})});
 await assert.rejects(async()=>{for await(const _ of bad.stream('summary',request)){}},/unavailable/);
});

test('model directory exposes names and native settings references, never arbitrary provider fields',async()=>{
 const native:any={stream(){throw new Error('No paid calls');},listProviders:()=>[{id:'p',name:'Provider',credential:'not-exported'}],listConfigurableProviders:()=>[{provider:'new',displayName:'New',settingsNs:'llm-new',secret:'not-exported'}],listModels:async()=>[{id:'m',name:'Model',extra:'not-exported'}]};
 const svc=new PurposeModels(native);assert.deepEqual(svc.directory(),{providers:[{id:'p',name:'Provider'}],configurable:[{provider:'new',displayName:'New',settingsNs:'llm-new'}]});assert.deepEqual(await svc.models('p'),[{id:'m',name:'Model'}]);
});
