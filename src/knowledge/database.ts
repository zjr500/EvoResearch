
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

export function migrateKnowledge(db: Database.Database) {
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS knowledge_migrations(version INTEGER PRIMARY KEY)');

 db.transaction(() => {
  if (!db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=2').get()) {
   if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_entries'").get())
    throw new Error('Existing kb_entries requires explicit schema reconciliation');

   db.exec(readFileSync(new URL('../../migrations/knowledge/001_papers.sql', import.meta.url),'utf8'));
   db.exec(readFileSync(new URL('../../migrations/knowledge/002_knowledge.sql', import.meta.url),'utf8'));

   db.prepare('INSERT INTO knowledge_migrations VALUES(2)').run();
  }

  if (!db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=3').get()) {
   db.exec(readFileSync(new URL('../../migrations/knowledge/003_pending_summary.sql', import.meta.url),'utf8'));

   db.prepare('INSERT INTO knowledge_migrations VALUES(3)').run();
  }
  if (!db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=4').get()) {
   db.exec(readFileSync(new URL('../../migrations/knowledge/004_uc01.sql', import.meta.url),'utf8'));
   db.prepare('INSERT INTO knowledge_migrations VALUES(4)').run();
  }
  if (!db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=5').get()) {
   db.exec(readFileSync(new URL('../../migrations/knowledge/005_public_services.sql', import.meta.url),'utf8'));
   db.prepare('INSERT INTO knowledge_migrations VALUES(5)').run();
  }
  if (!db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=6').get()) {
   db.exec(readFileSync(new URL('../../migrations/knowledge/006_sync_consistency.sql', import.meta.url),'utf8'));
   db.prepare('INSERT INTO knowledge_migrations VALUES(6)').run();
  }
 })();
}
