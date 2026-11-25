import { validateRequest } from '../domain/validate.js'
import type { RankedResult, SearchAdapter, SearchHit } from '../domain/types.js'

export class SearchService {
  constructor(readonly adapter: SearchAdapter, readonly mode: 'mock' | 'http') {}

  async search(query: string, topK = 5): Promise<RankedResult> {
    const request = validateRequest(query, topK)
    const result = await this.adapter.search(request)
    // 上游返回乱序、重复 id 时按分数去重，避免引用对应不上。
    const seen = new Set<string>()
    const items: SearchHit[] = [...result.items]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      }).slice(0, topK)
    return { query: request.query, items, mode: this.mode }
  }

  async select(query: string, ids: string[]): Promise<RankedResult> {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error('ids 需要是 1~5 个有效条目 ID')
    }
    const cleanIds = [...new Set(ids)]
    const results = await this.search(query, 10)
    const byId = new Map(results.items.map((item) => [item.id, item] as const))
    const selected = cleanIds.map((id) => {
      const hit = byId.get(id)
      if (!hit) throw new Error(`条目 ${id} 不在当前问题的检索结果中，拒绝伪造引用`)
      return hit
    })
    return { ...results, items: selected }
  }
}
