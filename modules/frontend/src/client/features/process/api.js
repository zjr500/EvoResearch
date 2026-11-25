import { arrayField, taskPath } from '../../shared/api.js'

export const processApi = {
  async runs(api, id, signal) { return arrayField(await api.request(`${taskPath(id)}/runs`, { signal }), 'runs') },
}
