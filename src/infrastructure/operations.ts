import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {AppError,ownerId} from './errors.js';
import {migrateOperations,scopedKey} from './operation-migration.js';
// Keep the deployed knowledge request digest byte-compatible.
function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v);}
const active=new Map<string|Database.Database,Set<number>>();
export class OperationService {
 private pending=new Set<Promise<void>>();
 private persistenceErrors:unknown[]=[];
 private active:Set<number>;
 constructor(private db:Database.Database,private scope='knowledge') {
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(scope))throw new AppError(4001,'Invalid operation scope');
  migrateOperations(db);
  const identity=db.name && db.name!==':memory:'?resolve(db.name):db;
  this.active=active.get(identity)??new Set();active.set(identity,this.active);
 }
 // Explicit startup recovery: no automatic replay of potentially paid/side-effecting work.
 recoverInterrupted() {
  const rows=this.db.prepare(`SELECT r.id FROM operation_records r JOIN operation_payloads p ON p.operation_id=r.id WHERE p.scope=? AND r.status IN ('受理','执行中')`).all(this.scope) as {id:number}[];
  for(const {id} of rows)if(!this.active.has(id))this.finish(id,'失败',null,5000,'Interrupted by host restart; retry with a new key');
 }
 get(owner:number,id:number) {
  const row=this.db.prepare(`SELECT r.id AS operation_id,r.operation_type,r.status,p.result_json,p.error_code,p.error_message FROM operation_records r JOIN operation_payloads p ON p.operation_id=r.id WHERE r.id=? AND p.owner_id=? AND p.scope=?`).get(id,ownerId(owner),this.scope) as Record<string,unknown>|undefined;
  if(!row)throw new AppError(4004,'Operation not found');
  const {result_json,...publicRow}=row;return {...publicRow,result:result_json?JSON.parse(result_json as string):null};
 }
 private mirror(id:number) {
  if(this.scope!=='knowledge')return;
  // Legacy table stays readable with original identifiers; one shared writer owns both stores.
  this.db.prepare(`INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,request_digest,status,result_json,error_code,error_message,created_at,updated_at)
   SELECT r.id,p.owner_id,p.client_key,r.operation_type,r.request_digest,r.status,p.result_json,p.error_code,p.error_message,r.created_at,r.updated_at FROM operation_records r JOIN operation_payloads p ON p.operation_id=r.id WHERE r.id=?
   ON CONFLICT(id) DO UPDATE SET status=excluded.status,result_json=excluded.result_json,error_code=excluded.error_code,error_message=excluded.error_message,updated_at=excluded.updated_at`).run(id);
 }
 private finish(id:number,status:string,result:unknown,code:number|null=null,message:string|null=null) {
  this.db.transaction(()=>{
   this.db.prepare('UPDATE operation_records SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id);
   this.db.prepare('UPDATE operation_payloads SET result_json=?,error_code=?,error_message=? WHERE operation_id=?').run(JSON.stringify(result),code,message,id);
   this.mirror(id);
  }).immediate();
 }
 submit(owner:number,key:unknown,type:string,input:unknown,work:()=>Promise<unknown>,targetId?:string) {
  ownerId(owner);
  if(typeof key!=='string'||!key.trim()||key.length>128)throw new AppError(4001,'idempotency_key required');
  if(!type||type.length>32)throw new AppError(4001,'Invalid operation type');
  if(targetId!==undefined && (typeof targetId!=='string'||targetId.length>64))throw new AppError(4001,'Invalid operation target');
  const digest=createHash('sha256').update(canonical(this.scope==='knowledge'?{type,input}:{type,input,targetId:targetId??null})).digest('hex');
  const claim=this.db.transaction(()=>{
   const old=this.db.prepare(`SELECT r.id,r.request_digest FROM operation_records r JOIN operation_payloads p ON p.operation_id=r.id WHERE p.owner_id=? AND p.scope=? AND p.client_key=?`).get(owner,this.scope,key) as {id:number;request_digest:string}|undefined;
   if(old){if(old.request_digest!==digest)throw new AppError(4020,'Idempotency conflict');return {id:old.id,fresh:false};}
   const id=Number(this.db.prepare(`INSERT INTO operation_records(idempotency_key,operation_type,request_digest,status) VALUES(?,?,?,'受理')`).run(scopedKey(owner,this.scope,key),type,digest).lastInsertRowid);
   this.db.prepare('UPDATE operation_records SET result_ref=?,target_id=? WHERE id=?').run('operation-payload:'+id,targetId??null,id);
   this.db.prepare('INSERT INTO operation_payloads(operation_id,owner_id,scope,client_key) VALUES(?,?,?,?)').run(id,owner,this.scope,key);
   this.mirror(id);return {id,fresh:true};
  }).immediate();
  if(!claim.fresh)return this.get(owner,claim.id);
  const {id}=claim;this.active.add(id);
  const job=Promise.resolve().then(async()=>{
   try {
    this.db.transaction(()=>{this.db.prepare("UPDATE operation_records SET status='执行中',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);this.mirror(id);}).immediate();
    const result=await work();this.finish(id,'成功',result);
   }catch(e){const known=e instanceof AppError;this.finish(id,'失败',known?e.data:null,known?e.code:5000,known?e.message:'Operation failed (parser/model/storage); no success result created');}
  }).finally(()=>{this.pending.delete(job);this.active.delete(id);});
  // A persistence failure is surfaced by drain; it never triggers another execution.
  job.catch(error=>this.persistenceErrors.push(error));this.pending.add(job);
  return this.get(owner,id);
 }
 async drain(){await Promise.all(this.pending);if(this.persistenceErrors.length)throw this.persistenceErrors[0];}
}
