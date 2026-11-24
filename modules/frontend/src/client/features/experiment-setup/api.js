import { taskPath } from '../../shared/api.js'

export const experimentSetupApi = {
  create(api, definition, key, signal) { return api.request('experiments', { method: 'POST', body: definition, key, signal }) },
  detail(api, taskId, signal) { return api.request(taskPath(taskId), { signal }) },
  update(api, taskId, definition, key, signal) { return api.request(taskPath(taskId), { method: 'PUT', body: definition, key, signal }) },
  confirm(api, taskId, key, signal) { return api.request(`${taskPath(taskId)}/confirm`, { method: 'POST', key, signal }) },
  start(api, taskId, key, signal) { return api.request(`${taskPath(taskId)}/start`, { method: 'POST', key, signal }) },
}
