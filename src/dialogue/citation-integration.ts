import type { Context } from '@deepseek-ai/cordis';
import { SearchService } from '../../modules/dialogue/dist/src/services/search-service.js';
import { registerKnowledgeTools } from '../../modules/dialogue/dist/src/tools/knowledge-tools.js';
import { CITATION_PROMPT } from '../../modules/dialogue/dist/src/dsh/index.js';
import type { SearchAdapter, SearchRequest, SearchResponse } from '../../modules/dialogue/dist/src/domain/types.js';
import type { KnowledgeService } from '../knowledge/plugin.js';

/**
 * In-process adapter: the dialogue module's citation tools query the unified
 * knowledge service directly (no HTTP hop, no mock data). When no embedding
 * provider is configured the search throws the honest 4009 error and the
 * agent must say so — formal mode never silently falls back to mock.
 */
class KnowledgeServiceAdapter implements SearchAdapter {
  constructor(private knowledge: KnowledgeService, private owner: number) {}
  async search(request: SearchRequest): Promise<SearchResponse> {
    const result = await this.knowledge.search(this.owner, request.query, request.topK);
    return {
      query: result.query,
      total: result.total,
      items: result.items.map(({ id, title, snippet, score, source }) => ({ id, title, snippet, score, source })),
    };
  }
}

/** Wire the dialogue module's citation tools into the root plugin runtime. */
export function installCitation(ctx: Context, knowledge: KnowledgeService, owner: number): () => void {
  const service = new SearchService(new KnowledgeServiceAdapter(knowledge, owner), 'service');
  const disposers = registerKnowledgeTools(ctx, service);
  const disposePrompt = (ctx as any).systemPrompt?.section({
    name: 'tool:f12-knowledge-citation', order: 155,
    text: CITATION_PROMPT,
  });
  return () => { for (const dispose of disposers.reverse()) dispose(); disposePrompt?.(); };
}
