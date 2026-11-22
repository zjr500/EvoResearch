import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { KnowledgeError, ownerId } from './paper-service.js';
function canonical(v:unknown):string { if(Array.isArray(v)) return '['+v.map(canonical).join(',')+']'; if(v&&typeof v==='object') return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}'; return JSON.stringify(v); }
export class Operations {
 private pending=new Set<Promise<void>>();
 constructor(private db:Database.Database) {
  db.prepare("UPDATE knowledge_operations SET status='失败',error_code=5000,error_message='Interrupted by host restart; retry with a new key',updated_at=CURRENT_TIMESTAMP WHERE status IN ('受理','执行中')").run();
 }
 get(owner:number,id:number) {
  const row=this.db.prepare('SELECT id AS operation_id,operation_type,status,result_json,error_code,error_message FROM knowledge_operations WHERE id=? AND owner_id=?').get(id,ownerId(owner)) as Record<string,unknown>|undefined;
  if(!row) throw new KnowledgeError(4004,'Operation not found');
  const {result_json,...publicRow}=row; return {...publicRow,result:result_json?JSON.parse(result_json as string):null};
 }
 submit(owner:number,key:unknown,type:string,input:unknown,work:()=>Promise<unknown>) {
  ownerId(owner);
  if(typeof key!=='string'||!key.trim()||key.length>128) throw new KnowledgeError(4001,'idempotency_key required');
  const digest=createHash('sha256').update(canonical({type,input})).digest('hex');
  const old=this.db.prepare('SELECT id,request_digest FROM knowledge_operations WHERE owner_id=? AND idempotency_key=?').get(owner,key) as {id:number;request_digest:string}|undefined;
  if(old) {if(old.request_digest!==digest) throw new KnowledgeError(4020,'Idempotency conflict'); return this.get(owner,old.id);}
  const id=Number(this.db.prepare("INSERT INTO knowledge_operations(owner_id,idempotency_key,operation_type,request_digest,status) VALUES(?,?,?,?,'受理')").run(owner,key,type,digest).lastInsertRowid);
  const job=Promise.resolve().then(async()=>{
   this.db.prepare("UPDATE knowledge_operations SET status='执行中',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
   try { const result=await work(); this.db.prepare("UPDATE knowledge_operations SET status='成功',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(result),id); }
   catch(e) { const known=e instanceof KnowledgeError; this.db.prepare("UPDATE knowledge_operations SET status='失败',error_code=?,error_message=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(known?e.code:5000,known?e.message:'Operation failed (parser/model/storage); no success result created',JSON.stringify(known?e.data:null),id); }
  }).finally(()=>this.pending.delete(job)); this.pending.add(job);
  return this.get(owner,id);
 }
 async drain() { await Promise.all(this.pending); }
}
