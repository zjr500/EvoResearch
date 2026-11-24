export function apiBase(value, documentBase) {
  const base = new URL(value || 'evoresearch/api/', documentBase)
  if (base.origin !== new URL(documentBase).origin || !['http:', 'https:'].includes(base.protocol)) throw new Error('请使用当前 DSH 下的同源接口地址。')
  if (base.search || base.hash || base.username || base.password) throw new Error('接口前缀不能包含查询参数、片段或凭据。')
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return base.href
}

export function createApi(base, transport = fetch, eventTransport = (url) => new EventSource(url, { withCredentials: true })) {
  return {
    url(path, params = {}) {
      const url = new URL(path, base)
      for (const [key, value] of Object.entries(params)) {
        if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value))
      }
      return url.href
    },
    openEvents(path, params) { return eventTransport(this.url(path, params)) },
    async request(path, { signal, method = 'GET', body, key, params } = {}) {
      const headers = { Accept: 'application/json' }
      let payload
      if (method !== 'GET') {
        if (!key) throw new Error('写入请求缺少幂等键。')
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify({ ...body, idempotency_key: key })
      }
      const response = await transport(this.url(path, params), { method, signal, headers, body: payload, credentials: 'same-origin' })
      if (response.status === 401) throw new Error('登录已失效，请从 DSH 启动链接重新打开。')
      if (response.status === 403) throw new Error('当前身份没有访问权限。')
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`接口尚未接入或响应格式错误（HTTP ${response.status}）。`)
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || `接口调用失败（HTTP ${response.status}）。`)
      if (!Object.hasOwn(result, 'data')) throw new Error('接口响应缺少 data，请核对契约。')
      return result.data
    },
  }
}

export function arrayField(data, field) {
  if (!data || !Array.isArray(data[field])) throw new Error(`接口响应缺少 ${field} 数组，请核对契约。`)
  return data
}

export function taskPath(id) {
  if (!/^[1-9]\d*$/.test(String(id))) throw new Error('请选择有效的任务编号。')
  return `experiments/${id}`
}
