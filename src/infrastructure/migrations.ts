import type Database from 'better-sqlite3';
import { migrateKnowledge } from '../knowledge/database.js';

/** Adopt the already deployed knowledge migration without replaying its SQL. */
export function migrateDatabase(db: Database.Database) {
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    const hasLegacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_migrations'").get();
    if (hasLegacy && db.prepare('SELECT 1 FROM knowledge_migrations WHERE version > 2').get())
      throw new Error('Knowledge schema is newer than this plugin; refusing migration');
    migrateKnowledge(db);
    db.exec(`CREATE TABLE IF NOT EXISTS evoresearch_migrations (
      module TEXT NOT NULL, version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(module, version)
    )`);
    if (db.prepare("SELECT 1 FROM evoresearch_migrations WHERE module <> 'knowledge' OR version <> 2").get())
      throw new Error('Database contains unrecognized migrations; refusing downgrade');
    db.prepare("INSERT OR IGNORE INTO evoresearch_migrations(module,version) VALUES('knowledge',2)").run();
  })();
}
