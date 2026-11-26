import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/infrastructure/database.js';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { migrateKnowledge } from '../src/knowledge/database.js';
import { installRuntime } from '../src/runtime.js';
function temporary(t: any) {
 const dir=mkdtempSync(join(tmpdir(),'evo-infrastructure-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;
}
test('shared database repeats and reopens without losing paper, entry or operation',t=>{
 const dir=temporary(t), options={databasePath:'shared.sqlite',baseDirectory:dir};
 let store=openDatabase(options);
 assert.equal(store.databasePath,join(dir,'shared.sqlite'));
 assert.equal(store.db.pragma('foreign_keys',{simple:true}),1);
 store.db.prepare("INSERT INTO papers(paper_id,title,file_path,uploader_id,content_hash) VALUES(7,'kept','fixture',1,?)").run('a'.repeat(64));
 store.db.exec(`INSERT INTO kb_entries(entry_id,type,title,content,source_type,source_id,owner_id) VALUES(8,'paper_summary','kept','{}','paper',7,1);
 INSERT INTO knowledge_operations(id,owner_id,idempotency_key,operation_type,request_digest,status,result_json) VALUES(9,1,'key','fixture','digest','成功','{}')`);
 migrateDatabase(store.db);store.close();store.close();store=openDatabase(options);
 try {
  assert.equal((store.db.prepare('SELECT title FROM papers WHERE paper_id=7').get() as any).title,'kept');
  assert.equal((store.db.prepare('SELECT source_id FROM kb_entries WHERE entry_id=8').get() as any).source_id,7);
  assert.equal((store.db.prepare('SELECT status FROM knowledge_operations WHERE id=9').get() as any).status,'成功');
  assert.equal((store.db.prepare('SELECT count(*) n FROM evoresearch_migrations').get() as any).n,7);
 } finally {store.close();}
});
test('adopts deployed knowledge v2 and preserves unrelated member tables',()=>{
 const db=new Database(':memory:');try {
 migrateKnowledge(db);db.exec("CREATE TABLE member_data(value TEXT); INSERT INTO member_data VALUES('kept')");
 migrateDatabase(db);migrateDatabase(db);
 assert.equal((db.prepare('SELECT value FROM member_data').get() as any).value,'kept');
 assert.equal((db.prepare('SELECT version FROM knowledge_migrations').get() as any).version,2);
 }finally{db.close();}
});
test('legacy papers upgrade preserves IDs and permits per-owner duplicate hash',()=>{
 const db=new Database(':memory:');try {
 db.exec(readFileSync(new URL('../migrations/knowledge/001_papers.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO papers(paper_id,title,file_path,uploader_id,content_hash) VALUES(42,'legacy','fixture',1,?)").run('b'.repeat(64));
 migrateDatabase(db);
 assert.equal((db.prepare('SELECT title FROM papers WHERE paper_id=42').get() as any).title,'legacy');
 db.prepare("INSERT INTO papers(file_path,uploader_id,content_hash) VALUES('fixture',2,?)").run('b'.repeat(64));
 }finally{db.close();}
});
test('unknown or future schemas fail without rewriting existing data',()=>{
 for (const schema of ["CREATE TABLE kb_entries(value TEXT); INSERT INTO kb_entries VALUES('kept')",'CREATE TABLE knowledge_migrations(version INTEGER); INSERT INTO knowledge_migrations VALUES(99)']) {
 const db=new Database(':memory:');try {
 db.exec(schema); const before=db.serialize();assert.throws(()=>migrateDatabase(db));
 assert.deepEqual(db.serialize(),before);
 }finally{db.close();}
 }
});
test('composition releases routes and database without loading SSH',async t=>{
 const dir=temporary(t), prior=process.env.EVORESEARCH_DB_PATH;process.env.EVORESEARCH_DB_PATH=join(dir,'runtime.sqlite');
 const routes:any[]=[], cleanup:Array<()=>Promise<void>>=[];
 const scope:any={provide(){return ()=>{};},inject(){},connection:{},llm:{},get(){},webServer:{register(route:any){routes.push(route);return ()=>{routes.splice(routes.indexOf(route),1);};}},effect(fn:any){cleanup.push(fn());}};
 try {
 installRuntime({inject(names:string[],fn:any){assert.deepEqual(names,['connection','webServer','llm']);fn(scope);}} as any);
 assert.deepEqual(routes.map(x=>x.path),['/operations','/papers','/kb','/models']);
 await cleanup[0]();assert.equal(routes.length,0);
 const store=openDatabase({databasePath:join(dir,'runtime.sqlite')});store.close();
 }finally{if(prior===undefined)delete process.env.EVORESEARCH_DB_PATH;else process.env.EVORESEARCH_DB_PATH=prior;}
});
