import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { apply, inject } from '../../plugins/dsh/tools.mjs'

test('register tools and call authenticated HTTP start/status/stop', async () => {
  process.env.EVORESEARCH_TOKEN = 'unit-test-only-token-123456789'
  const calls = []
  const rid = `run_${'a'.repeat(32)}`
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    calls.push({ path: req.url, method: req.method, token: req.headers.authorization, body })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url === '/api/templates' ? [{ id: 'diabetes-ridge-v1' }] : { run_id: rid, status: 'queued' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const tools = new Map()
    apply({ tools: { register: definition => tools.set(definition.name, definition) } },
      { baseUrl: `http://127.0.0.1:${server.address().port}` })
    assert.deepEqual(inject, ['tools'])
    assert.equal(tools.size, 4)
    const context = { signal: new AbortController().signal }
    for (const [name, tool] of tools) {
      const result = await tool.execute(name === 'evo_start_experiment' ? { task: {} } : name === 'evo_list_templates' ? {} : { run_id: rid }, context)
      if (name === 'evo_list_templates') assert.equal(result.templates[0].id, 'diabetes-ridge-v1')
      else assert.equal(result.run_id, rid)
      assert.equal(tool.output.render({}, result)[0].type, 'text')
    }
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'GET', 'POST'])
    assert.equal(calls[0].token, `Bearer ${process.env.EVORESEARCH_TOKEN}`)
    assert.equal(calls[3].path, `/api/experiments/${rid}/stop`)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(tools.get('evo_get_experiment_status').execute({ run_id: rid }, { signal: controller.signal }))
    assert.throws(() => tools.get('evo_get_experiment_status').execute({ run_id: '../../health' }, context))
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('reject insecure connection and missing credentials', () => {
  assert.throws(() => apply({}, { baseUrl: 'http://example.com' }), /HTTPS/)
  const old = process.env.EVORESEARCH_TOKEN
  delete process.env.EVORESEARCH_TOKEN
  assert.throws(() => apply({}), /TOKEN/)
  process.env.EVORESEARCH_TOKEN = old
})
