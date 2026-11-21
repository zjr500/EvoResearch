import { arrayField, taskPath } from '../../shared/api.js'

export const alertsApi = {
  // Proposed read endpoint. See evo/personal docs/新增接口设计.md.
  async rules(api, id, signal) { return arrayField(await api.request(`${taskPath(id)}/alert-rules`, { signal }), 'rules') },
  save(api, id, rules, key, signal) { return api.request(`${taskPath(id)}/alert-rules`, { method: 'PUT', body: { rules }, key, signal }) },
  stop(api, id, key, signal) { return api.request(`${taskPath(id)}/stop`, { method: 'POST', key, signal }) },
  task(api, id, signal) { return api.request(taskPath(id), { signal }) },
}
