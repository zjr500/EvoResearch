import { MockSearchAdapter } from '../dist/src/adapters/mock-search.js'
import { SearchService } from '../dist/src/services/search-service.js'
import { renderCitedAnswer, renderSearchCandidates } from '../dist/src/services/citation-service.js'

const service = new SearchService(new MockSearchAdapter(), 'mock')
const query = process.argv.slice(2).join(' ') || 'RAG如何减少幻觉？'
const result = await service.search(query, 5)
console.log('[第4周 F12] 离线演示，未接入真实知识库/DSH')
console.log('\n=== 工具 1：kb_search_sources ===')
console.log(renderSearchCandidates(result))
if (result.items.length) {
  const ids = result.items.slice(0, 2).map((item) => item.id)
  console.log('\n=== 工具 2：kb_cite_sources ===')
  console.log(renderCitedAnswer(await service.select(query, ids)))
} else {
  console.log('\n当前问题没有检索依据，跳过引用工具。')
}
