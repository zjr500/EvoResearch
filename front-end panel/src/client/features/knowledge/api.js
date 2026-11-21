import { arrayField } from '../../shared/api.js'

export const knowledgeApi = {
  async list(api, params, signal) { return arrayField(await api.request('kb/entries', { params, signal }), 'entries') },
  detail(api, id, signal) { return api.request(`kb/entries/${encodeURIComponent(id)}`, { signal }) },
  update(api, id, body, key, signal) { return api.request(`kb/entries/${encodeURIComponent(id)}`, { method: 'PUT', body, key, signal }) },
  remove(api, id, key, signal) { return api.request(`kb/entries/${encodeURIComponent(id)}`, { method: 'DELETE', key, signal }) },
}
