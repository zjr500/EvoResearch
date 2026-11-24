/** 本周临时字段模型；等待接口契约 v1.0 §1.4 后统一映射。 */
export type SourceType = 'paper' | 'internal' | 'web'
export interface KbSource {
  type: SourceType
  title: string
  url: string | null
  page?: number
}
export interface SearchHit {
  id: string
  title: string
  snippet: string
  score: number
  source: KbSource
}
export interface SearchRequest { query: string; topK: number }
export interface SearchResponse { query: string; total: number; items: SearchHit[] }
export interface SearchAdapter {
  search(request: SearchRequest): Promise<SearchResponse>
}
export interface RankedResult {
  query: string
  items: SearchHit[]
  mode: 'mock' | 'http'
}
