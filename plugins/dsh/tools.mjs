/** DSH tool extension. The existing Python worker owns long-running experiments. */
export const name = 'evoresearch'
export const inject = ['tools']

const text = { type: 'string' }
const task = {
  type: 'object', additionalProperties: false,
  required: ['task_id', 'project_id', 'template_id', 'objective', 'metric_key',
    'metric_direction', 'budget', 'allowed_edit_paths', 'use_history'],
  properties: {
    task_id: text, project_id: text,
    template_id: { type: 'string', description: 'Choose an available template from evo_list_templates' },
    objective: { type: 'string', description: 'Research objective, 3–2000 characters' },
    metric_key: text,
    metric_direction: { type: 'string', enum: ['maximize', 'minimize'] },
    budget: {
      type: 'object', additionalProperties: false, required: ['max_trials', 'max_seconds'],
      properties: {
        max_trials: { type: 'integer', description: 'Candidate rounds, 2–10 (baseline and confirmation are additional evaluations)' },
        max_seconds: { type: 'integer', description: 'Total execution budget in seconds, 10–3600' },
      },
    },
    allowed_edit_paths: { type: 'array', items: text, description: 'Exact template edit allowlist' },
    use_history: { type: 'boolean', description: 'Retrieve and freeze paper/history knowledge before planning when true.' },
  },
}
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false })
const runArgs = object({ run_id: text }, ['run_id'])

export function apply(ctx, config = {}) {
  const base = new URL(config.baseUrl ?? 'http://127.0.0.1:8091')
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('baseUrl must be an HTTP origin without credentials, path, query or fragment')
  }
  if (base.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error('Non-loopback service connections require HTTPS')
  }
  const token = process.env[config.tokenEnv ?? 'EVORESEARCH_TOKEN']
  if (!token || token.length < 24 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('Configure EVORESEARCH_TOKEN (at least 24 printable ASCII characters)')
  }
  const request = async (path, method, body, signal) => {
    const response = await fetch(new URL(path, base), {
      method, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      // Avoid exposing upstream error bodies or credentials to the model.
      throw new Error(`EvoResearch HTTP ${response.status}; check task fields, service configuration or run_id`)
    }
    return response.json()
  }
  const validRun = args => {
    if (!args || Object.keys(args).length !== 1 || typeof args.run_id !== 'string'
        || !/^run_[a-f0-9]{32}$/.test(args.run_id)) throw new Error('Invalid run_id')
    return encodeURIComponent(args.run_id)
  }
  const definitions = [
    {
      name: 'evo_list_templates',
      description: 'List task families, metrics, allowed edit paths and runner availability before configuring an experiment.',
      parameters: object({}, []), isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        if (!args || Object.keys(args).length) throw new Error('Expected empty arguments')
        return { templates: await request('/api/templates', 'GET', undefined, exec.signal) }
      },
    },
    {
      name: 'evo_start_experiment',
      description: 'Start an explicitly authorized research experiment with budget and template edit scope. Reuse project_id/task_id when retrying. Knowledge retrieval occurs before queueing when use_history=true.',
      parameters: object({ task }, ['task']),
      execute: (args, exec) => {
        if (!args || Object.keys(args).length !== 1 || !args.task || typeof args.task !== 'object') {
          throw new Error('Expected a task object')
        }
        return request('/api/experiments', 'POST', args, exec.signal)
      },
    },
    {
      name: 'evo_get_experiment_status',
      description: 'Get experiment status, progress and result evidence using an experiment run_id.',
      parameters: runArgs, isConcurrencySafe: () => true,
      execute: (args, exec) => request(`/api/experiments/${validRun(args)}`, 'GET', undefined, exec.signal),
    },
    {
      name: 'evo_stop_experiment',
      description: 'Request experiment cancellation. Running experiments stop cooperatively; poll until stopped.',
      parameters: runArgs,
      execute: (args, exec) => request(`/api/experiments/${validRun(args)}/stop`, 'POST', undefined, exec.signal),
    },
  ]
  // ctx.tools.register is already a Cordis lifecycle effect; DSH removes each on unload.
  for (const definition of definitions) {
    ctx.tools.register({
      ...definition, timeoutMs: 125000,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
    })
  }
}
