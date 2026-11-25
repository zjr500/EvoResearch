import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {migrateKnowledge} from '../src/knowledge/database.js';
import {migrateDatabase} from '../src/infrastructure/migrations.js';
import {migrateOperations} from '../src/infrastructure/operation-migration.js';
import {OperationService} from '../src/infrastructure/operations.js';
import {Operations} from '../src/knowledge/operations.js';
import {openDatabase} from '../src/infrastructure/database.js';
import {AppError} from '../src/infrastructure/errors.js';
import {authenticatedHandler,objectBody,success,failure,resourceId} from '../src/infrastructure/http.js';
function memory(t:any){const db=new Database(':memory:');migrateDatabase(db);t.after(()=>db.close());return db;}

test('shared migration preserves legacy IDs, timestamps, results and client-key replay',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());migrateKnowledge(db);
 db.exec(`INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,request_digest,status,result_json,created_at,updated_at) VALUES(73,2,'past','summary','digest','成功','{"document_id":9}','2026-01-01','2026-01-02')`);
 migrateDatabase(db);migrateDatabase(db);
 const row=db.prepare('SELECT * FROM operation_records WHERE id=73').get() as any;
 assert.equal(row.created_at,'2026-01-01');assert.equal(row.updated_at,'2026-01-02');
 assert.equal((new Operations(db).get(2,73).result as any).document_id,9);
 assert.equal((db.prepare('SELECT result_json FROM knowledge_operations WHERE id=73').get() as any).result_json,'{"document_id":9}');
 assert.throws(()=>new OperationService(db).get(1,73),/not found/);
});

test('unknown shared table and legacy ID conflicts roll back without deleting data',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());migrateKnowledge(db);
 db.exec("CREATE TABLE operation_records(id INTEGER,custom TEXT); INSERT INTO operation_records VALUES(1,'keep')");
 const before=db.serialize();assert.throws(()=>migrateDatabase(db),/reconciliation/);assert.deepEqual(db.serialize(),before);
 const other=memory(t);other.exec("INSERT INTO operation_records(id,idempotency_key,operation_type,status,request_digest) VALUES(1,'x','job','成功','x'); INSERT INTO operation_payloads(operation_id,owner_id,scope,client_key) VALUES(1,1,'experiments','x'); INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,status,request_digest) VALUES(1,1,'y','import','成功','y')");
 const saved=other.serialize();assert.throws(()=>migrateOperations(other),/collision/);assert.deepEqual(other.serialize(),saved);
});

test('shared idempotency deduplicates pending and completed work, isolates owners and scopes',async t=>{
 const db=memory(t),a=new OperationService(db),b=new OperationService(db),other=new OperationService(db,'experiments');let calls=0;
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const work=async()=>{calls++;await gate;return {value:3};};
 const first=a.submit(1,'key','summary',{a:1,b:2},work,'42');
 const replay=b.submit(1,'key','summary',{b:2,a:1},work,'42');assert.equal(first.operation_id,replay.operation_id);
 assert.throws(()=>b.submit(1,'key','summary',{a:2},work),e=>e instanceof AppError&&e.code===4020);
 const owner=b.submit(2,'key','summary',{},work),scope=other.submit(1,'key','job',{},work);assert.notEqual(owner.operation_id,first.operation_id);assert.notEqual(scope.operation_id,first.operation_id);
 new Operations(db); // A second facade must not mark live work interrupted.
 assert.equal(a.get(1,Number(first.operation_id)).status,'受理');
 release();await Promise.all([a.drain(),b.drain(),other.drain()]);assert.equal(calls,3);
 assert.equal(a.submit(1,'key','summary',{a:1,b:2},work).status,'成功');assert.equal(calls,3);
 assert.equal((db.prepare('SELECT target_id FROM operation_records WHERE id=?').get(first.operation_id) as any).target_id,'42');
 assert.throws(()=>other.get(1,Number(first.operation_id)),/not found/);
});

test('failed jobs are replayed without rerun or exposing unexpected errors',async t=>{
 const db=memory(t),ops=new OperationService(db);let calls=0;
 const work=async()=>{calls++;throw new Error('private-provider-detail');};
 const first=ops.submit(1,'failure','summary',{},work);await ops.drain();
 const again=ops.submit(1,'failure','summary',{},work);assert.equal(again.operation_id,first.operation_id);assert.equal(again.status,'失败');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(again),/private-provider-detail/);
 assert.equal((db.prepare('SELECT status FROM knowledge_operations WHERE id=?').get(first.operation_id) as any).status,'失败');
});

test('explicit recovery preserves IDs, fails interrupted local work, never replays it',t=>{
 const db=memory(t);
 db.exec("INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,status,request_digest) VALUES(99,1,'old','summary','执行中','old')");
 const ops=new Operations(db);assert.equal(ops.get(1,99).status,'失败');assert.equal((db.prepare('SELECT status FROM knowledge_operations WHERE id=99').get() as any).status,'失败');
 assert.throws(()=>ops.submit(1,'old','summary',{},async()=>{throw new Error('must not run');}),/conflict/);
});

test('two processes atomically claim one shared idempotency key',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'evo-claim-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'shared.sqlite');
 let store=openDatabase({databasePath:path});store.db.exec('CREATE TABLE side_effects(value INTEGER); INSERT INTO side_effects VALUES(0)');store.close();
 const source=`import {openDatabase} from './src/infrastructure/database.ts'; import {OperationService} from './src/infrastructure/operations.ts'; const store=openDatabase({databasePath:process.argv[1]}); const ops=new OperationService(store.db,'experiments'); ops.submit(1,'same','train',{value:1},async()=>{store.db.exec('UPDATE side_effects SET value=value+1'); await new Promise(r=>setTimeout(r,100));return {ok:true};});await ops.drain();store.close();`;
 function child(){return new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source,path],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let errors='';p.stderr.on('data',x=>errors+=x);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(errors)));});}
 await Promise.all([child(),child()]);store=openDatabase({databasePath:path});try{assert.equal((store.db.prepare('SELECT value FROM side_effects').get() as any).value,1);assert.equal((store.db.prepare('SELECT count(*) n FROM operation_records').get() as any).n,1);}finally{store.close();}
});

test('shared JSON validation and errors keep the legacy response envelope',async()=>{
 for(const body of ['{','null','[]','{"owner_id":2}','{"user_id":2}'])await assert.rejects(objectBody(new Request('http://localhost',{method:'POST',body})),AppError);
 assert.deepEqual(await objectBody(new Request('http://localhost',{method:'POST',body:'{"title":"valid"}'})),{title:'valid'});
 assert.throws(()=>resourceId('9007199254740992'),AppError);assert.throws(()=>resourceId('0'),AppError);
 assert.deepEqual(await failure(new Error('secret-detail')).json(),{code:5000,message:'Internal operation error',data:null});
 assert.equal(failure(new AppError(4004,'Not found')).status,404);
});

test('HTTP bridge uses DSH admission, rejects non-owner and limits input before invoking business code',async t=>{
 let mode='reject',calls=0;const connection={admit(){return mode==='reject'?{rejection:401 as const}:mode==='forbidden'?{rejection:403 as const}:{peer:{principal:{kind:mode}}};}};
 const server=createServer(authenticatedHandler(connection,async(req,owner)=>{calls++;assert.equal(owner,1);return success(await objectBody(req));},64));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>((r,e)=>server.close(x=>x?e(x):r())));
 const url='http://127.0.0.1:'+(server.address() as any).port+'/papers';
 for(const [kind,status] of [['reject',401],['forbidden',403],['agent',403]] as const){mode=kind;const r=await fetch(url,{method:'POST',body:'{}'});assert.equal(r.status,status);assert.equal((await r.json() as any).code,4001);}
 assert.equal(calls,0);mode='owner';
 const spoof=await fetch(url,{method:'POST',body:'{"owner_id":2}'});assert.equal(spoof.status,400);
 const large=await fetch(url,{method:'POST',body:'x'.repeat(65)});assert.equal(large.status,413);assert.equal((await large.json() as any).code,4001);
 const ok=await fetch(url,{method:'POST',body:'{"title":"ok"}'});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{code:0,message:'ok',data:{title:'ok'}});
});


test('new shared scopes include target in the idempotency fingerprint',async t=>{
 const db=memory(t),ops=new OperationService(db,'experiments');let calls=0;
 ops.submit(1,'target','train',{},async()=>{calls++;return {};},'1');
 assert.throws(()=>ops.submit(1,'target','train',{},async()=>{calls++;return {};},'2'),/conflict/);
 await ops.drain();assert.equal(calls,1);
});

test('restart replay retains a failed claim and never schedules the side effect again',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'evo-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'shared.sqlite');
 const store=openDatabase({databasePath:path});store.close();
 const source=`import {openDatabase} from './src/infrastructure/database.ts';import {OperationService} from './src/infrastructure/operations.ts';const s=openDatabase({databasePath:process.argv[1]});new OperationService(s.db,'experiments').submit(1,'crash','train',{},async()=>{throw new Error('must not execute');});process.exit(0);`;
 await new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source,path],{cwd:process.cwd(),stdio:'ignore'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('child failed')));});
 const reopened=openDatabase({databasePath:path});try{
 const ops=new OperationService(reopened.db,'experiments');ops.recoverInterrupted();let called=false;
 const result=ops.submit(1,'crash','train',{},async()=>{called=true;return {};});await ops.drain();assert.equal(result.status,'失败');assert.equal(result.operation_id,1);assert.equal(called,false);
 }finally{reopened.close();}
});
