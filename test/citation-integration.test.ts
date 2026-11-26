import Database from 'better-sqlite3';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { KnowledgeSearch } from '../src/knowledge/search.js';
import type { KnowledgeService } from '../src/knowledge/plugin.js';
import type { EmbeddingProvider } from '../src/knowledge/embedding.js';
import { installCitation } from '../src/dialogue/citation-integration.js';

const VOCAB = ['graph', 'neural', 'catalyst', 'battery'];
const fakeProvider: EmbeddingProvider = {
  name: 'test-keyword-v1',
  async dim() { return VOCAB.length; },
  async embed(texts: string[]) {
    return texts.map((text) => VOCAB.map((word) => (text.toLowerCase().includes(word) ? 1 : 0)));
  },
};

function setup(provider: EmbeddingProvider | null) {
  const db = new Database(':memory:');
  migrateDatabase(db);
  const search = new KnowledgeSearch(db, provider);
  const knowledge = { search: (owner: number, query: string, topK?: number) => search.search(owner, query, topK) } as KnowledgeService;
  const tools = new Map<string, { execute(args: any): Promise<string> }>();
  let prompt = '';
  const ctx: any = {
    tools: { register: (tool: any) => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    systemPrompt: { section: (options: any) => { prompt = options.text; return () => {}; } },
  };
  const dispose = installCitation(ctx, knowledge, 1);
  return { db, tools, dispose, prompt: () => prompt };
}
function insertEntry(db: Database.Database, title: string, content: unknown, sourceId: number) {
  db.prepare("INSERT INTO kb_entries(type,title,content,source_type,source_id,owner_id) VALUES('paper_summary',?,?,'paper',?,1)")
    .run(title, JSON.stringify(content), sourceId);
}

test('citation tools query the unified knowledge service in process', async () => {
  const { db, tools, dispose, prompt } = setup(fakeProvider);
  insertEntry(db, 'Graph neural survey', { abstract: 'graph neural methods' }, 41);
  insertEntry(db, 'Battery catalyst notes', { abstract: 'catalyst screening' }, 42);
  assert.ok(tools.has('kb_search_sources') && tools.has('kb_cite_sources'));
  assert.match(prompt(), /不得编造论文标题/);

  const candidates = await tools.get('kb_search_sources')!.execute({ query: 'graph neural', topK: 5 });
  assert.match(candidates, /知识库检索结果/);
  assert.match(candidates, /Graph neural survey/);

  const id = candidates.match(/ID=(\d+)｜Graph neural survey/)![1];
  const cited = await tools.get('kb_cite_sources')!.execute({ query: 'graph neural', ids: [id] });
  assert.match(cited, /带来源的回答/);
  assert.match(cited, /参考来源/);
  // Refusing to cite an ID that was never retrieved stays intact.
  await assert.rejects(() => tools.get('kb_cite_sources')!.execute({ query: 'graph neural', ids: ['999'] }), /拒绝伪造引用/);
  dispose();
  db.close();
});

test('formal mode without an embedding provider fails honestly, never mocks', async () => {
  const { db, tools, dispose } = setup(null);
  insertEntry(db, 'Graph neural survey', { abstract: 'graph neural methods' }, 51);
  await assert.rejects(
    () => tools.get('kb_search_sources')!.execute({ query: 'graph', topK: 5 }),
    (error: any) => error.code === 4009 && /embedding/i.test(error.message),
  );
  dispose();
  db.close();
});
