import Database from 'better-sqlite3';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { KnowledgeSearch } from '../src/knowledge/search.js';
import type { EmbeddingProvider } from '../src/knowledge/embedding.js';
import { publishReport } from '../src/knowledge/report.js';
import { claimKnowledgeEvents, settleKnowledgeEvent } from '../src/knowledge/publication.js';
import { knowledgeApi } from '../src/knowledge/api.js';
import { Operations } from '../src/knowledge/operations.js';

/** Deterministic keyword-vector provider: dimension i lights up when VOCAB[i] appears. */
const VOCAB = ['graph', 'neural', 'catalyst', 'battery', 'protein', 'folding', 'quantum', 'sensor'];
const fakeProvider: EmbeddingProvider = {
  name: 'test-keyword-v1',
  async dim() { return VOCAB.length; },
  async embed(texts: string[]) {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return VOCAB.map((word) => (lower.includes(word) ? 1 : 0));
    });
  },
};

function setup() {
  const db = new Database(':memory:');
  migrateDatabase(db);
  return db;
}
function insertEntry(db: Database.Database, owner: number, title: string, content: unknown, sourceId: number) {
  db.prepare("INSERT INTO kb_entries(type,title,content,source_type,source_id,owner_id) VALUES('paper_summary',?,?,'paper',?,?)")
    .run(title, JSON.stringify(content), sourceId, owner);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

test('migration 005 creates public-service tables and is idempotent', () => {
  const db = setup();
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_embedding_meta'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_index_state'").get());
  migrateDatabase(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM knowledge_migrations WHERE version=5").get() as { n: number }).n, 1);
  db.close();
});

test('search without an embedding provider answers 4009 instead of faking results', async () => {
  const db = setup();
  const search = new KnowledgeSearch(db, null);
  await assert.rejects(() => search.search(1, 'graph'), (error: any) => error.code === 4009);
  db.close();
});

test('semantic search ranks owner entries and isolates other owners', async () => {
  const db = setup();
  insertEntry(db, 1, 'Graph neural networks for molecules', { abstract: 'graph neural message passing' }, 11);
  insertEntry(db, 1, 'Battery catalyst screening', { abstract: 'catalyst for battery cathodes' }, 12);
  insertEntry(db, 2, 'Private graph notes', { abstract: 'graph neural' }, 13);
  const search = new KnowledgeSearch(db, fakeProvider);
  const result = await search.search(1, 'graph neural network', 5);
  assert.equal(result.total, 2);
  assert.equal(result.items[0].title, 'Graph neural networks for molecules');
  assert.ok(result.items[0].score > result.items[1].score);
  assert.ok(result.items.every((item) => item.title !== 'Private graph notes'));
  // Second search finds nothing new to embed.
  await search.search(1, 'graph neural network', 5);
  assert.equal(await search.reindex(1), 0);
  db.close();
});

test('editing an entry invalidates its vector so reindex picks the change up', async () => {
  const db = setup();
  const id = insertEntry(db, 1, 'Battery catalyst screening', { abstract: 'catalyst' }, 21);
  const search = new KnowledgeSearch(db, fakeProvider);
  await search.search(1, 'catalyst', 5);
  db.prepare('UPDATE kb_entries SET title=? WHERE entry_id=?').run('Quantum sensor review', id);
  search.invalidate(1, id);
  assert.equal(await search.reindex(1), 1);
  const result = await search.search(1, 'quantum sensor', 5);
  assert.equal(result.items[0].title, 'Quantum sensor review');
  db.close();
});

test('report publication is idempotent and emits one sync event', () => {
  const db = setup();
  const first = publishReport(db, 1, { reportId: 7, title: '实验报告 A', content: { conclusion: 'ok' } });
  assert.equal(first.duplicated, false);
  const second = publishReport(db, 1, { reportId: 7, title: '实验报告 A 改', content: { conclusion: 'changed' } });
  assert.equal(second.duplicated, true);
  assert.equal(second.entry_id, first.entry_id);
  const stored = db.prepare("SELECT title FROM kb_entries WHERE source_type='report' AND source_id=7").get() as { title: string };
  assert.equal(stored.title, '实验报告 A');
  const events = claimKnowledgeEvents(db, 1, 'index');
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).document_id, first.entry_id);
  db.close();
});

test('sync events are claimed per channel and settled exactly once', () => {
  const db = setup();
  publishReport(db, 1, { reportId: 9, title: '实验报告 B', content: {} });
  const [event] = claimKnowledgeEvents(db, 1, 'index') as any[];
  assert.equal(event.index_status, undefined);
  const settled = settleKnowledgeEvent(db, 1, event.event_id, 'index', 'done', event.entry_revision);
  assert.equal(settled.status, 'done');
  assert.equal(claimKnowledgeEvents(db, 1, 'index').length, 0);
  // Graph channel is independent and still pending.
  assert.equal(claimKnowledgeEvents(db, 1, 'graph').length, 1);
  assert.throws(() => settleKnowledgeEvent(db, 1, event.event_id, 'index', 'done', event.entry_revision), /already settled/);
  assert.throws(() => settleKnowledgeEvent(db, 1, event.event_id, 'graph', 'done', event.entry_revision + 1), /already settled/);
  db.close();
});

test('POST /kb/search answers synchronously through the authenticated API envelope', async () => {
  const db = setup();
  insertEntry(db, 1, 'Protein folding survey', { abstract: 'protein folding methods' }, 31);
  const search = new KnowledgeSearch(db, fakeProvider);
  const api = knowledgeApi(db, new Operations(db), mkdtempSync(join(tmpdir(), 'evo-papers-')), {} as any, undefined, search);
  const response = await api(new Request('http://localhost/kb/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'protein folding', top_k: 3 }),
  }), 1);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.code, 0);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].title, 'Protein folding survey');
  assert.equal(body.data.items[0].source.type, 'paper');
  // Unconfigured provider surfaces 4009 through the same route.
  const unconfigured = knowledgeApi(db, new Operations(db), mkdtempSync(join(tmpdir(), 'evo-papers-')), {} as any, undefined, new KnowledgeSearch(db, null));
  const denied = await unconfigured(new Request('http://localhost/kb/search', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'protein' }),
  }), 1);
  assert.equal((await denied.json() as any).code, 4009);
  db.close();
});
