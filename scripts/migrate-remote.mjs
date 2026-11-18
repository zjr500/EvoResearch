import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const dbPath = resolve(process.env.EVORESEARCH_DB_PATH ?? './data/evoresearch.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })
const migration = fileURLToPath(new URL('../migrations/experiments/001_remote_hosts.sql', import.meta.url))
const db = new Database(dbPath)
try {
  db.exec(readFileSync(migration, 'utf8'))
  console.log('remote_hosts migration applied')
} finally {
  db.close()
}
