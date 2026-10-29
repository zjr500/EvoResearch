// Integration probe against the published DSH registry, not a mock context.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import * as plugin from '../../plugins/dsh/tools.mjs'

const runtime = resolve(process.argv[2])
const load = name => import(pathToFileURL(resolve(runtime, 'node_modules/@deepseek-ai', name, 'lib/index.js')))
const { Context } = await load('cordis')
const { default: SystemPrompt } = await load('dsh-system-prompt')
const { default: ToolRuntime, assertSupportedJsonSchema } = await load('dsh-tools')
const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const handle = await ctx.plugin(plugin, { baseUrl: process.env.EVORESEARCH_URL })
  const schemas = ctx.tools.schemas()
  for (const schema of schemas) assertSupportedJsonSchema(schema.parameters)
  assert.equal(schemas.filter(s => s.name.startsWith('evo_')).length, 4)
  const call = async (name, args) => {
    const result = await ctx.tools.execute({ callId: name + Date.now(), name, arguments: args,
      signal: AbortSignal.timeout(20000) })
    assert.equal(result.isError, false, JSON.stringify(result))
    return result.value
  }
  const body = JSON.parse(await readFile(new URL('../../examples/start.json', import.meta.url)))
  const catalog = await call('evo_list_templates', {})
  assert.equal(catalog.templates.length, 4)
  body.task = { ...body.task, template_id: 'diabetes-ridge-v1', task_id: 'regression-e2e',
    metric_key: 'rmse', metric_direction: 'minimize' }
  const receipt = await call('evo_start_experiment', body)
  assert.equal((await call('evo_start_experiment', body)).run_id, receipt.run_id)
  let snapshot
  const deadline = Date.now() + 120000
  do {
    snapshot = await call('evo_get_experiment_status', { run_id: receipt.run_id })
    if (!['queued', 'running'].includes(snapshot.status)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)
  assert.equal(snapshot.status, 'completed', JSON.stringify(snapshot))
  assert.equal(snapshot.trials.length, 2)
  const stopped = await call('evo_start_experiment', { task: { ...body.task, template_id: 'etth1-ridge-v1',
    metric_key: 'mse', task_id: 'stop-check' } })
  assert.equal((await call('evo_stop_experiment', { run_id: stopped.run_id })).accepted, true)
  const stopDeadline = Date.now() + 15000
  let final
  do {
    final = await call('evo_get_experiment_status', { run_id: stopped.run_id })
    if (final.status === 'stopped') break
    await new Promise(resolve => setTimeout(resolve, 300))
  } while (Date.now() < stopDeadline)
  assert.equal(final.status, 'stopped')
  await handle.dispose()
  assert.equal(ctx.tools.schemas().filter(s => s.name.startsWith('evo_')).length, 0)
  console.log(JSON.stringify({ registry: 'DSH 0.2.1-rc.3', registration: true,
    run_id: receipt.run_id, status: snapshot.status, trials: snapshot.trials,
    stop: final.status, unload: true }))
} finally {
  await ctx.fiber.dispose()
}
