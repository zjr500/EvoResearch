import { parseSearchResponse } from '../domain/validate.js'
import type { SearchAdapter, SearchRequest, SearchResponse } from '../domain/types.js'

export class HttpSearchAdapter implements SearchAdapter {
  private readonly url: string
  constructor(baseUrl: string, private readonly timeoutMs = 5000, private readonly fetcher: typeof fetch = fetch) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('timeoutMs 超出范围')
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('仅接受 HTTP(S) 知识库地址')
    // 这里暂按会议安排中的 POST /kb/search；请求体及响应体字段需按 v1.0 修订。
    this.url = new URL('kb/search', base).toString()
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const resp = await this.fetcher(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: request.query, top_k: request.topK }),
        signal: controller.signal,
      })
      if (!resp.ok) throw new Error(`POST /kb/search 请求失败：HTTP ${resp.status}`)
      const raw: unknown = await resp.json()
      const parsed = parseSearchResponse(raw)
      if (parsed.query !== request.query) throw new Error('检索响应 query 与请求不一致')
      return parsed
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`知识库检索超时（${this.timeoutMs}ms）`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
