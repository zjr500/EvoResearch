import type { RankedResult, SearchHit } from '../domain/types.js'

const label = (mode: 'mock' | 'http' | 'service') => mode === 'mock' ? '模拟检索结果（非真实知识库）' : '知识库检索结果'
const sourceLine = (hit: SearchHit, index: number) => {
  const location = hit.source.page ? `，第 ${hit.source.page} 页` : ''
  const link = hit.source.url ? `，${hit.source.url}` : '（无可用原文链接）'
  return `[${index + 1}] ${hit.source.title}${location}${link}`
}
export function renderSearchCandidates(result: RankedResult): string {
  if (!result.items.length) return `【${label(result.mode)}】\n没有找到与「${result.query}」匹配的条目。请说明无检索依据，不要编造引用。`
  return [
    `【${label(result.mode)}】问题：${result.query}`,
    ...result.items.map((item) => `- ID=${item.id}｜${item.title}｜匹配分=${item.score.toFixed(3)}｜摘要：${item.snippet}`),
    '',
    '如果需要给出带来源的回答，请从以上 ID 选 1~5 个，调用 kb_cite_sources({query, ids})。',
  ].join('\n')
}

/** 直接构造可核对的引用式输出，不调用大模型、不添加未检索到的事实。 */
export function renderCitedAnswer(result: RankedResult): string {
  if (!result.items.length) return '未选中检索证据，无法给出带来源的回答。'
  return [
    `【带来源的回答｜${result.mode === 'mock' ? '模拟演示' : '真实接口'}】`,
    ...result.items.map((item, index) => `${index + 1}. ${item.snippet} [${index + 1}]`),
    '',
    '【参考来源】',
    ...result.items.map(sourceLine),
    '',
    '说明：以上为检索片段整理；模型若进一步推论，须与有来源的事实区分。',
  ].join('\n')
}
