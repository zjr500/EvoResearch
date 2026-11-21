import { createApi } from '../shared/api.js'
import { makeFixtures } from './fixtures.js'

const ok = (data) => Response.json({ code: 0, message: 'ok', data })
const error = (code, message, status) => Response.json({ code, message, data: null }, { status })
const unavailable = () => error(4004, '没有对应的本地调试数据。', 404)

function paginate(items, params, field, cursorField = 'next_cursor') {
  const offset = Math.max(0, Number(params.get('cursor')) || 0)
  const limit = Math.max(1, Math.min(100, Number(params.get('limit')) || 20))
  return { [field]: items.slice(offset, offset + limit), [cursorField]: offset + limit < items.length ? String(offset + limit) : null }
}

export function createDebugApi(base) {
  const fixtures = makeFixtures()
  const { entries, tasks, runs, events, series, candidates } = fixtures
  const basePath = new URL(base).pathname
  const cachedWrites = new Map()
  const listeners = new Set()
  let ruleId = 42
  let stopAt = 0
  function addEvent(type, step, payload) {
    const item = { taskId: 21, seq: events.at(-1).seq + 1, type, runId: 212, step, split: null, payload }
    events.push(item)
    for (const listener of listeners) listener(item)
  }
  function finishStop() {
    if (!stopAt || Date.now() < stopAt) return
    stopAt = 0
    tasks[0].status = '已终止'
    runs[1].status = '已终止'
    addEvent('finish', '已确认停止', { status: '已终止' })
  }
  function resolve(path, params, method, body) {
    finishStop()
    if (path === 'kb/entries' && method === 'GET') {
      const type = params.get('type')
      const keyword = params.get('keyword')?.toLowerCase()
      const matches = entries.filter((entry) => (!type || entry.type === type) && (!keyword || entry.title.toLowerCase().includes(keyword)))
      return ok(paginate(matches.map(({ document_id, type, title, source_type, source_id, created_at }) => ({ document_id, type, title, source_type, source_id, created_at })), params, 'entries', 'nextCursor'))
    }
    const entryId = path.match(/^kb\/entries\/(\d+)$/)?.[1]
    if (entryId) {
      const index = entries.findIndex((entry) => String(entry.document_id) === entryId)
      if (index < 0) return unavailable()
      if (method === 'GET') return ok(entries[index])
      if (method === 'PUT') {
        for (const field of ['title', 'user_note']) if (Object.hasOwn(body, field)) entries[index][field] = body[field]
        return ok(entries[index])
      }
      if (method === 'DELETE') { entries.splice(index, 1); return ok(null) }
    }
    if (path === 'experiments' && method === 'GET') {
      const status = params.get('status')
      return ok(paginate(tasks.filter((task) => !status || task.status === status), params, 'tasks'))
    }
    const taskMatch = path.match(/^experiments\/(\d+)(?:\/(.+))?$/)
    if (!taskMatch) return unavailable()
    const [, taskId, resource] = taskMatch
    const task = tasks.find((item) => String(item.taskId) === taskId)
    if (!task) return unavailable()
    const activeSample = task.taskId === 21
    if (method === 'GET') {
      if (!resource) return ok({ ...task, hypothesis: task.title, model_plan: '对照试验', dataset: '本地样例', split_rule: {}, train_config: {}, target_metric: 'loss', optimization_direction: 'minimize', threshold: 0.4, threshold_suggestion: null, multi_seed: false, seed_count: 1, host_id: null, rounds: { total: activeSample ? 2 : 0, running: task.status === '运行中' ? 1 : 0, debug: 0, success: activeSample ? 1 : 0, dropped: 0 } })
      if (resource === 'runs') return ok({ runs: activeSample ? runs : [] })
      if (resource === 'events') return ok(paginate(activeSample ? events.filter((item) => item.seq > Number(params.get('afterSeq')) && (!params.has('type') || item.type === params.get('type')) && (!params.has('runId') || String(item.runId) === params.get('runId'))) : [], params, 'events'))
      if (resource === 'metrics') return ok({ series: activeSample ? series.filter((item) => ['runId', 'split', 'name'].every((key) => !params.has(key) || params.get(key) === String(item[key]))) : [] })
      if (resource === 'candidates') return ok(paginate(activeSample ? candidates : [], params, 'candidates'))
      if (resource === 'certification') {
        const items = activeSample ? candidates.map(({ candidate_id, cert_status, test_metric }) => ({ candidate_id, cert_status, test_metric })) : []
        return ok({ total: items.length, certified: 0, failed: 0, pending: items.length, items })
      }
      if (resource === 'alert-rules') return ok({ rules: activeSample ? fixtures.rules : [] })
    }
    if (method === 'PUT' && resource === 'alert-rules' && activeSample) {
      fixtures.rules = body.rules.map((rule) => ({ ...rule, rule_id: rule.rule_id ?? ruleId++ }))
      return ok({ rules: fixtures.rules })
    }
    if (method === 'POST' && resource === 'stop') {
      if (!activeSample || task.status !== '运行中') return error(4009, '当前样例任务不能终止。', 409)
      task.status = '终止确认中'
      stopAt = Date.now() + 800
      addEvent('run_status', '请求停止', { status: task.status })
      return ok({ taskId: task.taskId, status: task.status })
    }
    return unavailable()
  }
  async function transport(url, { method, signal, body }) {
    signal?.throwIfAborted()
    const target = new URL(url)
    const path = target.pathname.slice(basePath.length)
    const parsed = body ? JSON.parse(body) : {}
    if (method === 'GET') return resolve(path, target.searchParams, method, parsed)
    const key = JSON.stringify([method, path, parsed.idempotency_key])
    if (cachedWrites.has(key)) return cachedWrites.get(key).clone()
    const response = resolve(path, target.searchParams, method, parsed)
    if (response.ok) cachedWrites.set(key, response.clone())
    return response
  }
  function eventTransport(url) {
    const source = new EventTarget()
    const target = new URL(url)
    const activeSample = target.pathname.slice(basePath.length) === 'experiments/21/events/stream'
    let since = Number(target.searchParams.get('since'))
    function send(item) {
      if (item.seq <= since) return
      since = item.seq
      source.dispatchEvent(new MessageEvent(item.type, { data: JSON.stringify(item), lastEventId: String(item.seq) }))
    }
    const timer = setTimeout(() => {
      source.onopen?.()
      if (activeSample) {
        finishStop()
        events.forEach(send)
        listeners.add(send)
      }
    }, 50)
    source.close = () => { clearTimeout(timer); listeners.delete(send) }
    source.debug = true
    return source
  }
  return createApi(base, transport, eventTransport)
}
