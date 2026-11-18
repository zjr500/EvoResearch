import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

test('SQLite writes and reads, and sqlite-vec loads', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO smoke (value) VALUES (?)').run('ok')
    assert.equal(db.prepare('SELECT value FROM smoke WHERE id = 1').get().value, 'ok')
    sqliteVec.load(db)
    assert.match(db.prepare('SELECT vec_version() AS version').get().version, /^v0\.1\.9/)
  } finally {
    db.close()
  }
})
