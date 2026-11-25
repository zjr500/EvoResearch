import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { apiBase, createApi, taskPath } from '../src/client/shared/api.js'
import { mergeEvents, loadHistory } from '../src/client/shared/events.js'
import { chartLines } from '../src/client/features/metrics/chart.js'

test('API prefix stays on the DSH origin and preserves a proxy mount', () => {
  assert.equal(apiBase('', 'http://localhost:3080/ui/'), 'http://localhost:3080/ui/evoresearch/api/')
  assert.throws(() => apiBase('https://other.example/', 'http://localhost:3080/'))
  assert.throws(() => apiBase('/api?token=secret', 'http://localhost:3080/'))
  assert.equal(taskPath('12'), 'experiments/12')
  assert.throws(() => taskPath('../12'))
})

test('write transport retains DELETE JSON, credentials and caller retry key', async () => {
  const calls = []
  const api = createApi('http://localhost/evoresearch/api/', async (url, options) => {
    calls.push({ url, options })
    return Response.json({ code: 0, message: 'ok', data: null })
  })
  await api.request('kb/entries/1', { method: 'DELETE', key: 'same-request' })
  await api.request('kb/entries/1', { method: 'DELETE', key: 'same-request' })
  assert.equal(calls[0].options.method, 'DELETE')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.body, calls[1].options.body)
  assert.deepEqual(JSON.parse(calls[0].options.body), { idempotency_key: 'same-request' })
  await assert.rejects(() => api.request('kb/entries/1', { method: 'PUT' }), /幂等键/)
})

test('missing upstream and failed authentication remain visible errors', async () => {
  const missing = createApi('http://localhost/api/', async () => new Response('<html>404</html>', { status: 404 }))
  await assert.rejects(() => missing.request('kb/entries'), /接口尚未接入/)
  const unauthorized = createApi('http://localhost/api/', async () => new Response('', { status: 401 }))
  await assert.rejects(() => unauthorized.request('experiments'), /登录已失效/)
})

test('event replay sorts duplicate delivery and refuses another task', async () => {
  const event = (seq) => ({ taskId: 1, seq, type: 'log', payload: {} })
  assert.deepEqual(mergeEvents([event(3)], [event(1), event(3)], 1).map((item) => item.seq), [1, 3])
  assert.throws(() => mergeEvents([], [{ ...event(1), taskId: 2 }], 1))
  let page = 0
  const api = { request: async (_path, { params }) => {
    assert.equal(params.cursor, page === 0 ? undefined : 'next')
    return ++page === 1 ? { events: [event(1)], next_cursor: 'next' } : { events: [event(3)], next_cursor: null }
  } }
  assert.deepEqual((await loadHistory(api, 1)).map((item) => item.seq), [1, 3])
  await assert.rejects(() => loadHistory({ request: async () => ({ events: [], next_cursor: 'loop' }) }, 1), /游标重复/)
})

test('metric lines keep different seeds apart and require a common axis', () => {
  const series = [{ runId: 1, points: [{ epoch: 2, value: 4, seed: 1 }, { epoch: 1, value: 3, seed: 1 }, { epoch: 1, value: 5, seed: 2 }] }]
  const lines = chartLines(series)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0].points.map((point) => point.x), [1, 2])
  assert.equal(lines[0].axis, 'epoch')
  assert.deepEqual(chartLines([{ runId: 1, points: [{ epoch: 1, value: 2 }, { global_step: 1, value: 2 }] }]), [])
})

test('built DSH client registers the right-sidebar workbench tab type and body', async () => {
  let bundle
  const code = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  runInNewContext(code, { window: { __ModuleLoader__: { load(value) { bundle = value } } } })
  const requested = []
  const plugin = bundle.factory((name) => { requested.push(name); return {} })
  assert.ok(requested.every((name) => ['react', 'react/jsx-runtime'].includes(name)))
  const tabTypes = []
  const seatRegistrations = []
  const ctx = {
    sidebarRightTabs: { register(definition) { tabTypes.push(definition); return () => {} } },
    slots: {
      inject(name, register) { assert.equal(name, 'sidebar.right.pane.tab'); return register() },
      register(options, component) { seatRegistrations.push({ options, component }); return () => {} },
    },
    effect(run) { return run() },
  }
  plugin.apply(ctx)
  assert.equal(tabTypes.length, 1)
  assert.equal(tabTypes[0].kind, 'evoresearch.workbench')
  assert.equal(tabTypes[0].keepMounted, true)
  assert.ok(Array.isArray(tabTypes[0].guide) && tabTypes[0].guide.length === 1)
  assert.equal(seatRegistrations.length, 1)
  assert.equal(seatRegistrations[0].options.key, tabTypes[0].id)
  assert.equal(typeof seatRegistrations[0].component, 'function')
  // 旧的六入口整页面板（main + sidebar.panellist）不得再注册。
  assert.ok(!seatRegistrations.some(({ options }) => options.name === 'main'))
})
