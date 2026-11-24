import type Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function scopedKey(owner:number,scope:string,key:string) {
 return createHash('sha256').update(JSON.stringify([owner,scope,key])).digest('hex');
}
export function migrateOperations(db:Database.Database) {
 db.transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS evoresearch_migrations(module TEXT NOT NULL,version INTEGER NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(module,version))`);
  const version=db.prepare("SELECT version FROM evoresearch_migrations WHERE module='operations'").all() as {version:number}[];
  if(version.some(x=>x.version!==1))throw new Error('Unknown operation migration version');
  if(!version.length){
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('operation_records','operation_payloads')").get())throw new Error('Existing operation schema requires explicit reconciliation');
   db.exec(readFileSync(new URL('../../migrations/shared/001_operations.sql',import.meta.url),'utf8'));
   db.prepare("INSERT INTO evoresearch_migrations(module,version) VALUES('operations',1)").run();
  }
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_operations'").get())return;
  // Preserve legacy IDs, timestamps, digest algorithm and exact saved results. Never overwrite collisions.
  const rows=db.prepare('SELECT * FROM knowledge_operations').all() as any[];
  for(const r of rows){
   const old=db.prepare(`SELECT r.id,r.request_digest,p.owner_id,p.scope,p.client_key FROM operation_records r JOIN operation_payloads p ON p.operation_id=r.id WHERE r.id=?`).get(r.id) as any;
   if(old){
    if(old.scope!=='knowledge'||old.owner_id!==r.owner_id||old.client_key!==r.idempotency_key||old.request_digest!==r.request_digest)throw new Error('Legacy operation ID collision; migration rolled back');
    continue;
   }
   db.prepare(`INSERT INTO operation_records(id,idempotency_key,operation_type,status,request_digest,result_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).run(r.id,scopedKey(r.owner_id,'knowledge',r.idempotency_key),r.operation_type,r.status,r.request_digest,'operation-payload:'+r.id,r.created_at,r.updated_at);
   db.prepare(`INSERT INTO operation_payloads VALUES(?,?,?,?,?,?,?)`).run(r.id,r.owner_id,'knowledge',r.idempotency_key,r.result_json,r.error_code,r.error_message);
  }
 }).immediate();
}
