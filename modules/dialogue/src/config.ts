import { MockSearchAdapter } from './adapters/mock-search.js'
import { HttpSearchAdapter } from './adapters/http-search.js'
import type { SearchAdapter } from './domain/types.js'

export interface CitationConfig {
  mode: 'mock' | 'http'
  baseUrl: string
  timeoutMs: number
}
export const DEFAULT_CONFIG: CitationConfig = {
  mode: 'mock',
  baseUrl: 'http://127.0.0.1:3000',
  timeoutMs: 5000,
}
export function createAdapter(config: CitationConfig): SearchAdapter {
  if (config.mode === 'mock') return new MockSearchAdapter()
  if (config.mode === 'http') return new HttpSearchAdapter(config.baseUrl, config.timeoutMs)
  throw new Error('检索模式不支持，仅允许 mock / http')
}
