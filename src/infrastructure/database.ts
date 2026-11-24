import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrateDatabase } from './migrations.js';

export interface DatabaseOptions { databasePath?: string; baseDirectory?: string }
export function databasePaths(options: DatabaseOptions = {}) {
  const base = resolve(options.baseDirectory ?? process.cwd());
  const databasePath = resolve(base, options.databasePath ?? process.env.EVORESEARCH_DB_PATH ?? 'data/evoresearch.sqlite');
  return { databasePath, papersPath: resolve(dirname(databasePath), 'papers') };
}
/** One connection per plugin runtime; modules borrow it and never close it. */
export interface SharedDatabase { databasePath: string; papersPath: string; db: Database.Database; close(): void }
export function openDatabase(options: DatabaseOptions = {}): SharedDatabase {
  const paths = databasePaths(options);
  mkdirSync(dirname(paths.databasePath), { recursive: true });
  const db = new Database(paths.databasePath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrateDatabase(db);
  } catch (error) { db.close(); throw error; }
  let closed = false;
  return { ...paths, db, close() { if (!closed) { db.close(); closed = true; } } };
}
