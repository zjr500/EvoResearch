import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export function migrateKnowledge(db: Database.Database) {
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS knowledge_migrations(version INTEGER PRIMARY KEY)');
 db.transaction(() => {
  if (db.prepare('SELECT 1 FROM knowledge_migrations WHERE version=2').get()) return;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_entries'").get()) throw new Error('Existing kb_entries requires explicit schema reconciliation');
  db.exec(readFileSync(new URL('../../migrations/knowledge/001_papers.sql', import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../../migrations/knowledge/002_knowledge.sql', import.meta.url),'utf8'));
  db.prepare('INSERT INTO knowledge_migrations VALUES(2)').run();
 })();
}
