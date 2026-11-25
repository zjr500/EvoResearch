import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {migrateDatabase} from '../src/infrastructure/migrations.js';
import {OperationService} from '../src/infrastructure/operations.js';
import {operationApi} from '../src/infrastructure/operation-api.js';
import {PurposeModels} from '../src/infrastructure/models.js';
import {LocalExecution,type LocalServices} from '../src/infrastructure/local-execution.js';
import {AppError} from '../src/infrastructure/errors.js';
import {resolve} from 'node:path';
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

function fakeNative() {
 let spawned=0,terminated=0,finish!:(v:any)=>void,job:any,spec:any;
 const done=new Promise<any>(r=>finish=r);
 const handle={collected:{stdout:{readFrom:(n:number)=>({text:'tick',nextOffset:n+4,lossy:false})}},done,terminate(){if(terminated)return;terminated++;finish({exitCode:null,signal:'SIGTERM'});},waitForExit:async()=>true};
 const native:any={fs:{resolve:async(p:string)=>p,processPath:(p:string)=>p},sandbox:{confine:async(argv:string[],policy:any)=>({argv,enforcement:'partial'})},subprocess:{resolveExecutable:async(p:string)=>p,spawn(s:any){spawned++;spec=s;return handle;}},jobs:{attachController:()=>()=>{},start(s:any){job=s.run({id:'bash-test'});return 'bash-test';},get:()=>({status:'running'}),readAt:()=>({chunks:[{text:'tick'}],next:4,lossy:false}),kill(){job.cancel();return 'requested';}}};
 return {handle,native:native as LocalServices,finish:(x:any)=>finish(x),spawned:()=>spawned,terminated:()=>terminated,spec:()=>spec};
}
async function running(local:LocalExecution,op:any){for(let i=0;i<100;i++){const row=local.lookup(1,op.operation_id);if(row?.job_id)return row;await new Promise(r=>setTimeout(r,1));}throw new Error('not started');}
const input=()=>({python:'python',cwd:resolve('.'),script:resolve('test.py'),args:['one']});

test('local adapter uses native confinement/jobs, deduplicates launch, stops and persists identity',async t=>{
 const db=database(t),fake=fakeNative(),local=new LocalExecution(db,fake.native);t.after(()=>local.dispose());
 const op=local.startPython(1,'launch',input());assert.equal(local.startPython(1,'launch',input()).operation_id,op.operation_id);
 const row=await running(local,op);assert.equal(fake.spawned(),1);assert.equal(row.enforcement,'partial');assert.deepEqual(fake.spec().argv,['python','-u',resolve('test.py'),'one']);
 assert.throws(()=>local.status(2,row.execution_id),AppError);assert.throws(()=>local.output(2,row.execution_id),AppError);
 assert.deepEqual(await local.stop(1,row.execution_id),{terminationConfirmed:true});await local.drain();
 assert.equal(local.status(1,row.execution_id).status,'killed');assert.equal(local.status(1,row.execution_id).termination_confirmed,1);
 assert.equal(local.lookup(1,op.operation_id).execution_id,row.execution_id);assert.equal(fake.terminated(),1);
});

test('sandbox refusal fails closed without starting a Python process',async t=>{
 const db=database(t),fake=fakeNative();fake.native.sandbox.confine=async()=>{throw new Error('SANDBOX_UNAVAILABLE');};
 const local=new LocalExecution(db,fake.native);t.after(()=>local.dispose());const op=local.startPython(1,'refuse',input());await local.drain();
 assert.equal(fake.spawned(),0);assert.equal(new OperationService(db,'local-execution').get(1,Number(op.operation_id)).status,'失败');assert.equal(local.lookup(1,op.operation_id).status,'failed');
});

test('nonzero exit is recorded as failure',async t=>{
 const db=database(t),fake=fakeNative();const local=new LocalExecution(db,fake.native);t.after(()=>local.dispose());const op=local.startPython(1,'bad',input());const row=await running(local,op);fake.finish({exitCode:7,signal:null});await local.drain();assert.equal(local.status(1,row.execution_id).status,'failed');assert.equal(new OperationService(db,'local-execution').get(1,Number(op.operation_id)).status,'失败');
});

test('restart keeps execution ID but does not invent native handle recovery',t=>{
 const db=database(t);db.exec("INSERT INTO operation_records(id,idempotency_key,operation_type,status,request_digest) VALUES(1,'x','local-python','执行中','x'); INSERT INTO operation_payloads(operation_id,owner_id,scope,client_key) VALUES(1,1,'local-execution','x'); INSERT INTO local_executions(execution_id,operation_id,owner_id,status,job_id) VALUES('stable',1,1,'running','lost')");
 const fake=fakeNative();fake.native.jobs.get=()=>{throw new Error('Unknown native job');};const local=new LocalExecution(db,fake.native);t.after(()=>local.dispose());assert.equal(local.status(1,'stable').status,'unknown');assert.equal(local.status(1,'stable').job,null);assert.equal(local.status(1,'stable').termination_confirmed,0);assert.equal(fake.spawned(),0);
});


test('unconfirmed native range remains unknown and never reports successful termination',async t=>{
 const db=database(t),fake=fakeNative();fake.handle.waitForExit=async()=>false;
 const local=new LocalExecution(db,fake.native);const op=local.startPython(1,'unconfirmed',input());const row=await running(local,op);fake.finish({exitCode:0,signal:null});await local.drain();
 assert.equal(local.status(1,row.execution_id).status,'unknown');assert.equal(local.status(1,row.execution_id).termination_confirmed,0);
 assert.equal(new OperationService(db,'local-execution').get(1,Number(op.operation_id)).status,'失败');
 assert.deepEqual(await local.stop(1,row.execution_id),{terminationConfirmed:false});
 await assert.rejects(local.dispose(),/unconfirmed/);
});
