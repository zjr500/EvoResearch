import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { HostService } from '../dist/f7/host-service.js'

const successReport = JSON.parse(readFileSync(new URL('../fixtures/f7_success.mock.json', import.meta.url), 'utf8'))
const failureReport = JSON.parse(readFileSync(new URL('../fixtures/f7_failure.mock.json', import.meta.url), 'utf8'))

function database() {
  const db = new Database(':memory:')
  db.exec(readFileSync(new URL('../migrations/experiments/001_remote_hosts.sql', import.meta.url), 'utf8'))
  // Shared infrastructure belongs to the team; this fixture mirrors its frozen schema.
  db.exec(`CREATE TABLE operation_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE,
    operation_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  return db
}

async function settled(service, operationId) {
  for (let n = 0; n < 30; n++) {
    const op = service.getOperation(operationId)
    if (op?.status === '成功' || op?.status === '失败') return op
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('host check did not settle')
}

test('F7 mock success: alias registration persists structured self-check and is idempotent', async () => {
  const db = database()
  let calls = 0
  const service = new HostService(db, { async check(host_alias) {
    calls++
    return { ...successReport, host_alias }
  } })
  try {
    const accepted = service.registerHost('gpu-test', 'request-1')
    assert.equal(accepted.status, '自检中')
    assert.equal((await settled(service, accepted.operation_id)).status, '成功')
    assert.deepEqual(service.getHost(accepted.host_id)?.status, '就绪')
    assert.equal(service.getHost(accepted.host_id)?.framework, 'torch 2.5.0')
    assert.equal(service.registerHost('gpu-test', 'request-1').operation_id, accepted.operation_id)
    assert.equal(calls, 1)
    assert.throws(() => service.registerHost('other-gpu', 'request-1'), /4020/)
  } finally { db.close() }
})

test('F7 mock failure: unreachable host returns a redacted error and stays unavailable', async () => {
  const db = database()
  const service = new HostService(db, { async check(host_alias) {
    return { ...failureReport, host_alias }
  } })
  try {
    const accepted = service.registerHost('offline-gpu', 'request-2')
    const operation = await settled(service, accepted.operation_id)
    assert.equal(operation.status, '失败')
    assert.equal(operation.error, '远程主机不可达或连接超时')
    assert.equal(service.getHost(accepted.host_id)?.status, '不可用')
    assert.equal(service.getHost(accepted.host_id)?.error_code, 'HOST_UNREACHABLE')
  } finally { db.close() }
})
