import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createDebugApi } from '../src/client/debug/enabled.js'
import { knowledgeApi } from '../src/client/features/knowledge/api.js'
import { alertsApi } from '../src/client/features/alerts/api.js'
import { experimentSetupApi } from '../src/client/features/experiment-setup/api.js'
import { knowledgeGraphApi } from '../src/client/features/knowledge-graph/api.js'
import { loadHistory } from '../src/client/shared/events.js'

const base = 'https://dsh.example/ui/evoresearch/api/'

test('debug pagination and writes stay inside one instance and reset with a fresh instance', async () => {
  const api = createDebugApi(base)
  const first = await knowledgeApi.list(api, { limit: 1 })
  assert.equal(first.entries[0].document_id, 101)
  assert.equal(first.nextCursor, '1')
  const second = await knowledgeApi.list(api, { cursor: first.nextCursor, limit: 1 })
  assert.equal(second.entries[0].document_id, 102)
  assert.equal(second.nextCursor, null)
  await knowledgeApi.update(api, 101, { title: '调试编辑', user_note: '仅本地' }, 'example-edit')
  assert.equal((await knowledgeApi.detail(api, 101)).user_note, '仅本地')
  await knowledgeApi.remove(api, 102, 'example-remove')
  await knowledgeApi.remove(api, 102, 'example-remove')
  assert.equal((await knowledgeApi.list(api)).entries.length, 1)
  assert.equal((await knowledgeApi.list(createDebugApi(base))).entries.length, 2)
  await assert.rejects(() => knowledgeApi.detail(api, 102), /本地调试数据/)
})

test('simulated stop emits after replay and waits for termination confirmation', async () => {
  const api = createDebugApi(base)
  const history = await loadHistory(api, 21)
  const source = api.openEvents('experiments/21/events/stream', { since: history.at(-1).seq })
  try {
    const messages = []
    const connected = new Promise((resolve) => { source.onopen = resolve })
    const capture = (message) => messages.push([Number(message.lastEventId), JSON.parse(message.data).payload.status])
    source.addEventListener('run_status', capture)
    source.addEventListener('finish', capture)
    await connected
    await alertsApi.stop(api, 21, 'example-stop')
    assert.equal((await alertsApi.task(api, 21)).status, '终止确认中')
    await delay(840)
    assert.equal((await alertsApi.task(api, 21)).status, '已终止')
    assert.deepEqual(messages, [[6, '终止确认中'], [7, '已终止']])
  } finally { source.close() }
})

test('reserved page adapters separate experiment writes, graph lookup and graph node details', async () => {
  const calls = []
  const api = { async request(path, options) { calls.push([path, options]); return { nodes: [], edges: [] } } }
  await experimentSetupApi.confirm(api, 21, 'confirm')
  await experimentSetupApi.start(api, 21, 'start')
  await knowledgeGraphApi.graph(api, 101, { depth: 2, min_weight: 0.5 })
  await knowledgeGraphApi.node(api, 901)
  assert.deepEqual(calls.map(([path]) => path), ['experiments/21/confirm', 'experiments/21/start', 'graph/101', 'graph/nodes/901'])
  assert.deepEqual(calls.slice(0, 2).map(([, options]) => [options.method, options.key]), [['POST', 'confirm'], ['POST', 'start']])
  assert.deepEqual(calls[2][1].params, { depth: 2, min_weight: 0.5 })
})
