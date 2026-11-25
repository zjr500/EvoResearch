import Database from 'better-sqlite3';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateModuleDirectories} from '../src/infrastructure/migrations.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'evo-mig-'));
  mkdirSync(join(root, 'graph'), { recursive: true });
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE evoresearch_migrations(module TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(module, version))`);
  return { root, db };
}

test('module migrations apply from directories without touching shared files', () => {
  const { root, db } = setup();
  writeFileSync(join(root, 'graph', '001_nodes.sql'), 'CREATE TABLE graph_nodes(id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  writeFileSync(join(root, 'graph', '002_edges.sql'), 'CREATE TABLE graph_edges(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL)');
  migrateModuleDirectories(db, root);
  assert.deepEqual(db.prepare("SELECT version FROM evoresearch_migrations WHERE module='graph' ORDER BY version").all().map((r: any) => r.version), [1, 2]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='graph_edges'").get());
  // Repeated runs are safe and do not replay.
  migrateModuleDirectories(db, root);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM evoresearch_migrations WHERE module='graph'").get().n, 2);
  db.close();
});

test('module migrations apply only the pending suffix', () => {
  const { root, db } = setup();
  writeFileSync(join(root, 'graph', '001_nodes.sql'), 'CREATE TABLE graph_nodes(id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  migrateModuleDirectories(db, root);
  db.prepare("INSERT INTO graph_nodes(name) VALUES('kept')").run();
  writeFileSync(join(root, 'graph', '002_edges.sql'), 'CREATE TABLE graph_edges(id INTEGER PRIMARY KEY)');
  migrateModuleDirectories(db, root);
  assert.equal(db.prepare('SELECT name FROM graph_nodes').get().name, 'kept');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='graph_edges'").get());
  db.close();
});

test('removing an applied module migration refuses downgrade', () => {
  const { root, db } = setup();
  writeFileSync(join(root, 'graph', '001_nodes.sql'), 'CREATE TABLE graph_nodes(id INTEGER PRIMARY KEY)');
  writeFileSync(join(root, 'graph', '002_edges.sql'), 'CREATE TABLE graph_edges(id INTEGER PRIMARY KEY)');
  migrateModuleDirectories(db, root);
  rmSync(join(root, 'graph', '002_edges.sql'));
  assert.throws(() => migrateModuleDirectories(db, root), /refusing downgrade/);
  db.close();
});

test('non-dense version prefixes are rejected before applying anything', () => {
  const { root, db } = setup();
  writeFileSync(join(root, 'graph', '002_edges.sql'), 'CREATE TABLE graph_edges(id INTEGER PRIMARY KEY)');
  assert.throws(() => migrateModuleDirectories(db, root), /dense from 1/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM evoresearch_migrations WHERE module='graph'").get().n, 0);
  db.close();
});

test('built-in migration records survive module directory scans', () => {
  const { root, db } = setup();
  writeFileSync(join(root, 'graph', '001_nodes.sql'), 'CREATE TABLE graph_nodes(id INTEGER PRIMARY KEY, name TEXT)');
  db.prepare("INSERT INTO evoresearch_migrations(module,version) VALUES('knowledge',2)").run();
  migrateModuleDirectories(db, root);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evoresearch_migrations').get().n, 2);
  db.close();
});

test('orphan records without a module directory are refused', () => {
  const { root, db } = setup();
  db.prepare("INSERT INTO evoresearch_migrations(module,version) VALUES('ghost',1)").run();
  assert.throws(() => migrateModuleDirectories(db, root), /unrecognized migrations/);
  db.close();
});
