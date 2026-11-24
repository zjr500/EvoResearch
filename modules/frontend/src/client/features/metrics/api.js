import { arrayField, taskPath } from '../../shared/api.js'

export const metricsApi = {
  async series(api, id, params, signal) { return arrayField(await api.request(`${taskPath(id)}/metrics`, { params, signal }), 'series') },
  async candidates(api, id, cursor, signal) { return arrayField(await api.request(`${taskPath(id)}/candidates`, { signal, params: { cursor, limit: 20 } }), 'candidates') },
  certification(api, id, signal) { return api.request(`${taskPath(id)}/certification`, { signal }) },
}
