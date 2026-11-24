import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderCitedAnswer, renderSearchCandidates } from '../services/citation-service.js'
import { SearchService } from '../services/search-service.js'

export function registerKnowledgeTools(ctx: Context, service: SearchService): (() => void)[] {
  const removeSearch = ctx.tools.register(defineTool({
    name: 'kb_search_sources',
    description: '为当前 DSH 会话检索知识条目，返回可供选择的 ID、摘要和匹配分数。先搜索，再选有依据的条目。',
    parameters: {
      query: { type: 'string', required: true, description: '用户的问题' },
      topK: { type: 'integer', description: '返回候选条目数（1~10），默认 5' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
    async execute(args: { query: string; topK?: number }) {
      return renderSearchCandidates(await service.search(args.query, args.topK ?? 5))
    },
  }))
  const removeCite = ctx.tools.register(defineTool({
    name: 'kb_cite_sources',
    description: '从 kb_search_sources 当前问题的结果中选择 1~5 个条目，输出附 [1] [2] 来源清单的回答。禁止引用未检索到的 ID。',
    parameters: {
      query: { type: 'string', required: true, description: '必须与前一步检索问题相同' },
      ids: { type: 'array', required: true, items: { type: 'string' }, description: '选中的检索条目 ID，最多 5 个' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
    async execute(args: { query: string; ids: string[] }) {
      return renderCitedAnswer(await service.select(args.query, args.ids))
    },
  }))
  return [removeSearch, removeCite]
}
