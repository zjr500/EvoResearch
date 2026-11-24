import { arrayField } from '../../shared/api.js'

export const knowledgeGraphApi = {
  async graph(api, entryId, { depth, min_weight } = {}, signal) {
    const data = await api.request(`graph/${encodeURIComponent(entryId)}`, { params: { depth, min_weight }, signal })
    return arrayField(arrayField(data, 'nodes'), 'edges')
  },
  node(api, nodeId, signal) { return api.request(`graph/nodes/${encodeURIComponent(nodeId)}`, { signal }) },
}
