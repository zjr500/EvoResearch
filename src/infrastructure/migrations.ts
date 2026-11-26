import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrateOperations} from './operation-migration.js';
import type Database from 'better-sqlite3';
import { migrateKnowledge } from '../knowledge/database.js';

/** Built-in modules whose migrations are managed by dedicated code paths. */
const BUILTIN_MODULES = new Set(['knowledge', 'operations', 'local-execution']);

/**
 * Member modules register migrations by adding SQL files to
 * `migrations/modules/<module>/NNN_name.sql` — no shared file is edited.
 * Versions come from the numeric filename prefix and must be dense from 1.
 */
export function migrateModuleDirectories(db: Database.Database, rootDir?: string) {
  const dirPath = rootDir ?? fileURLToPath(new URL('../../migrations/modules', import.meta.url));
  if (!existsSync(dirPath)) return;
  const known = (module: string) => BUILTIN_MODULES.has(module) || existsSync(join(dirPath, module));
  const records = db.prepare('SELECT module, version FROM evoresearch_migrations').all() as { module: string; version: number }[];
  const builtinVersions: Record<string, number[]> = { knowledge: [2, 3, 4, 5], operations: [1], 'local-execution': [1] };
  for (const row of records) {
    if (BUILTIN_MODULES.has(row.module)) {
      if (!builtinVersions[row.module].includes(row.version)) throw new Error(`Database contains unrecognized migrations; refusing downgrade (${row.module} v${row.version})`);
    } else if (!known(row.module)) {
      throw new Error(`Database contains unrecognized migrations; refusing downgrade (${row.module})`);
    }
  }
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const module = entry.name;
    if (BUILTIN_MODULES.has(module)) throw new Error(`Module migration directory conflicts with built-in module: ${module}`);
    const files = readdirSync(join(dirPath, module)).filter((f) => /^\d+_[A-Za-z0-9_-]*\.sql$/.test(f))
      .sort((a, b) => parseInt(a) - parseInt(b));
    files.forEach((file, index) => {
      if (parseInt(file) !== index + 1) throw new Error(`Migration versions for module ${module} must be dense from 1: ${file}`);
    });
    const applied = db.prepare('SELECT version FROM evoresearch_migrations WHERE module=? ORDER BY version').all(module) as { version: number }[];
    if (applied.some((row, index) => row.version !== index + 1)) throw new Error(`Module ${module} has non-dense applied migrations`);
    if (applied.length > files.length) throw new Error(`Module ${module} migrations were removed; refusing downgrade`);
    for (let version = applied.length + 1; version <= files.length; version++) {
      db.exec(readFileSync(join(dirPath, module, files[version - 1]), 'utf8'));
      db.prepare('INSERT INTO evoresearch_migrations(module,version) VALUES(?,?)').run(module, version);
    }
  }
}

/** Adopt the already deployed knowledge migration without replaying its SQL. */
export function migrateDatabase(db: Database.Database) {
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    const hasLegacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_migrations'").get();
    if (hasLegacy && db.prepare('SELECT 1 FROM knowledge_migrations WHERE version > 5').get())
      throw new Error('Knowledge schema is newer than this plugin; refusing migration');
    migrateKnowledge(db);
    db.exec(`CREATE TABLE IF NOT EXISTS evoresearch_migrations (
      module TEXT NOT NULL, version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(module, version)
    )`);
    db.prepare("INSERT OR IGNORE INTO evoresearch_migrations(module,version) VALUES('knowledge',2)").run();
    db.prepare("INSERT OR IGNORE INTO evoresearch_migrations(module,version) VALUES('knowledge',3)").run();
    db.prepare("INSERT OR IGNORE INTO evoresearch_migrations(module,version) VALUES('knowledge',4)").run();
    db.prepare("INSERT OR IGNORE INTO evoresearch_migrations(module,version) VALUES('knowledge',5)").run();
    migrateOperations(db);
    if(!db.prepare("SELECT 1 FROM evoresearch_migrations WHERE module='local-execution' AND version=1").get()) {
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_executions'").get())throw new Error('Existing local executions require explicit reconciliation');
      db.exec(readFileSync(new URL('../../migrations/shared/002_local_executions.sql',import.meta.url),'utf8'));
      db.prepare("INSERT INTO evoresearch_migrations(module,version) VALUES('local-execution',1)").run();
    }
    migrateModuleDirectories(db);
  }).immediate();
}
