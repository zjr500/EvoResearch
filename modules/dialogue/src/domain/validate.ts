import type { SearchHit, SearchRequest, SearchResponse, SourceType } from './types.js'

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} 必须是对象`)
  }
  return value as Record<string, unknown>
}
function requiredText(value: unknown, name: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${name} 必须是非空字符串（最多 ${max} 字）`)
  }
  return value.trim()
}
function safeUrl(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('source.url 不是字符串')
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅接受 HTTP(S) 来源')
    }
    return parsed.toString()
  } catch {
    throw new Error('source.url 不是有效的 HTTP(S) 链接')
  }
}
export function validateRequest(query: string, topK = 5): SearchRequest {
  const normalized = requiredText(query, 'query', 500)
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 10) {
    throw new Error('topK 必须为 1~10 的整数')
  }
  return { query: normalized, topK }
}
export function parseSearchResponse(input: unknown): SearchResponse {
  const obj = record(input, '检索响应')
  const query = requiredText(obj.query, 'query', 500)
  if (!Array.isArray(obj.items) || obj.items.length > 500) {
    throw new Error('items 必须是数组，数量不可超过 500')
  }
  if (!Number.isSafeInteger(obj.total) || (obj.total as number) < obj.items.length) {
    throw new Error('total 必须是非负整数且不能小于 items.length')
  }
  const items: SearchHit[] = obj.items.map((raw: unknown, i: number) => {
    const hit = record(raw, `items[${i}]`)
    const src = record(hit.source, `items[${i}].source`)
    if (typeof hit.score !== 'number' || !Number.isFinite(hit.score) || hit.score < 0 || hit.score > 1) {
      throw new Error(`items[${i}].score 必须在 0~1 之间`)
    }
    const type = src.type
    if (type !== 'paper' && type !== 'internal' && type !== 'web') {
      throw new Error(`items[${i}].source.type 非法`)
    }
    const page = src.page
    if (page != null && (!Number.isSafeInteger(page) || (page as number) < 1)) {
      throw new Error(`items[${i}].source.page 必须为正整数`)
    }
    return {
      id: requiredText(hit.id, 'id', 128),
      title: requiredText(hit.title, 'title', 300),
      snippet: requiredText(hit.snippet, 'snippet', 4000),
      score: hit.score,
      source: {
        type: type as SourceType,
        title: requiredText(src.title, 'source.title', 300),
        url: safeUrl(src.url),
        ...(page != null ? { page: page as number } : {}),
      },
    }
  })
  return { query, total: obj.total as number, items }
}
