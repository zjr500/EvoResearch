import rawMock from './kb-search.mock.json' with { type: 'json' }
import { parseSearchResponse } from '../dist/src/domain/validate.js'

/** 模拟数据搜索用轻量词匹配；不是实际的向量搜索，也不假装是语义检索。 */
function queryTerms(input) {
  const words = [...(input.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [])]
  const blocks = input.match(/[\p{Script=Han}]{2,}/gu) ?? []
  for (const block of blocks) {
    for (let i = 0; i < block.length - 1; i += 1) words.push(block.slice(i, i + 2))
  }
  return [...new Set(words)].filter((v) => v.length > 1)
}

/** 仅供自动化测试使用的模拟检索适配器；正式运行由统一知识服务提供真实检索。 */
export class MockSearchAdapter {
  async search({ query, topK }) {
    const mock = parseSearchResponse(rawMock)
    const terms = queryTerms(query)
    const matched = mock.items.flatMap((item) => {
      const content = `${item.title} ${item.snippet} ${item.source.title}`.toLowerCase()
      const count = terms.filter((term) => content.includes(term.toLowerCase())).length
      if (count === 0) return []
      const score = Math.min(1, Number((0.8 * count / Math.max(1, terms.length) + 0.2 * item.score).toFixed(3)))
      return [{ ...item, score }]
    })
    matched.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    return { query, total: matched.length, items: matched.slice(0, topK) }
  }
}
