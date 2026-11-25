import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {migrateKnowledge} from '../src/knowledge/database.js';
import {Operations} from '../src/knowledge/operations.js';
import {knowledgeApi} from '../src/knowledge/api.js';

test('upgrade populated legacy database, preserve IDs and verify disk persistence',()=>{
 const folder=mkdtempSync(join(tmpdir(),'evo-upgrade-')),path=join(folder,'test.sqlite');
 let db=new Database(path);
 try {
  db.exec(readFileSync('migrations/knowledge/001_papers.sql','utf8'));
  db.prepare("INSERT INTO papers(paper_id,title,file_path,uploader_id,content_hash) VALUES(42,'Legacy','fixture.pdf',1,?)").run('a'.repeat(64));
  migrateKnowledge(db);migrateKnowledge(db);
  assert.equal((db.prepare('SELECT title FROM papers WHERE paper_id=42').get() as any).title,'Legacy');
  db.prepare("INSERT INTO papers(title,file_path,uploader_id,content_hash) VALUES('Second owner','fixture.pdf',2,?)").run('a'.repeat(64));
  db.close();db=new Database(path);migrateKnowledge(db);
  assert.equal((db.prepare('SELECT count(*) n FROM papers').get() as any).n,2);
 } finally {db.close();rmSync(folder,{recursive:true,force:true});}
});
test('entry edits enforce whitelist and ownership; failed operations remain replayable',async()=>{
 const db=new Database(':memory:');
 try {
  migrateKnowledge(db);
  db.prepare("INSERT INTO kb_entries(type,title,content,source_type,source_id,owner_id) VALUES('paper_summary','Old','{}','paper',1,1)").run();
  const ops=new Operations(db),api=knowledgeApi(db,ops,tmpdir(),{async generate(){throw new Error('unused');}});
  const call=async(owner:number,body:unknown)=> (await api(new Request('http://localhost/kb/entries/1',{method:'PUT',body:JSON.stringify(body)}),owner)).json() as Promise<any>;
  assert.equal((await call(2,{idempotency_key:'edit',title:'Other'})).code,4004);
  assert.equal((await call(1,{idempotency_key:'edit',content:{method:'forged'}})).code,4001);
  const accepted=await call(1,{idempotency_key:'edit',title:'New',user_note:'Note'});await ops.drain();
  assert.equal(ops.get(1,accepted.data.operation_id).status,'成功');
  assert.equal((db.prepare('SELECT title FROM kb_entries').get() as any).title,'New');
  assert.equal((await call(1,{idempotency_key:'edit',title:'Changed'})).code,4020);
  const fail=ops.submit(1,'fail','summary',{},async()=>{throw new Error('credential should not leak');});await ops.drain();
  const result=ops.get(1,Number(fail.operation_id));assert.equal(result.status,'失败');assert.doesNotMatch(JSON.stringify(result),/credential should not leak/);
  assert.throws(()=>ops.get(2,Number(fail.operation_id)),/not found/);
  assert.equal(ops.submit(1,'fail','summary',{},async()=>({fake:true})).status,'失败');
 }finally{db.close();}
});
