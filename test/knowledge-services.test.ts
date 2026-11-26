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

test('owner-scoped KNN cannot be starved by other owners crowding a global top-k', async () => {
  const db = setup();
  // Owner 2 floods the index with vectors that are all closer to the query
  // than owner 1's only entry. A global top-k window would crowd owner 1 out
  // entirely; the owner partition key must not.
  for (let i = 0; i < 40; i++) insertEntry(db, 2, `Graph note ${i}`, { abstract: 'graph neural' }, 100 + i);
  insertEntry(db, 1, 'Sensor-only note', { abstract: 'sensor' }, 201);
  const search = new KnowledgeSearch(db, fakeProvider);
  const result = await search.search(1, 'graph neural', 5);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].title, 'Sensor-only note');
  db.close();
});

test('entry edit publishes an entry-updated event with an incremented revision', async () => {
  const db = setup();
  const id = insertEntry(db, 1, 'Battery catalyst screening', { abstract: 'catalyst' }, 41);
  db.prepare('INSERT INTO knowledge_sync_events(document_id,owner_id) VALUES(?,?)').run(id, 1);
  const ops = new Operations(db);
  const api = knowledgeApi(db, ops, mkdtempSync(join(tmpdir(), 'evo-papers-')), {} as any, undefined, new KnowledgeSearch(db, fakeProvider));
  const response = await api(new Request(`http://localhost/kb/entries/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Battery catalyst screening (revised)', idempotency_key: 'edit-1' }),
  }), 1);
  assert.equal(response.status, 202);
  await ops.drain();
  const events = db.prepare("SELECT event_type, entry_revision FROM knowledge_sync_events WHERE document_id=? ORDER BY entry_revision").all(id) as { event_type: string; entry_revision: number }[];
  assert.deepEqual(events, [
    { event_type: 'entry-confirmed', entry_revision: 1 },
    { event_type: 'entry-updated', entry_revision: 2 },
  ]);
  // The updated event is claimable by both channels with the new revision.
  const claimed = claimKnowledgeEvents(db, 1, 'index') as any[];
  assert.equal(claimed.length, 2);
  assert.equal(claimed[1].entry_revision, 2);
  assert.equal(claimed[1].event_type, 'entry-updated');
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
  // Identical republish is a true duplicate; changed content under the same
  // report ID is a conflict, never a silent keep-old (P2-2).
  const second = publishReport(db, 1, { reportId: 7, title: '实验报告 A', content: { conclusion: 'ok' } });
  assert.equal(second.duplicated, true);
  assert.equal(second.entry_id, first.entry_id);
  assert.throws(() => publishReport(db, 1, { reportId: 7, title: '实验报告 A 改', content: { conclusion: 'changed' } }),
    (error: any) => error.code === 4009 && /different content/.test(error.message));
  const stored = db.prepare("SELECT title FROM kb_entries WHERE source_type='report' AND source_id=7").get() as { title: string };
  assert.equal(stored.title, '实验报告 A');
  const events = claimKnowledgeEvents(db, 1, 'index');
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).document_id, first.entry_id);
  db.close();
});

test('failed sync events are re-claimable with bounded attempts', () => {
  const db = setup();
  publishReport(db, 1, { reportId: 11, title: '实验报告 C', content: {} });
  const [event] = claimKnowledgeEvents(db, 1, 'index') as any[];
  // First failure: attempts 1, event claimable again.
  settleKnowledgeEvent(db, 1, event.event_id, 'index', 'failed', event.entry_revision);
  const reclaimed = claimKnowledgeEvents(db, 1, 'index') as any[];
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].event_id, event.event_id);
  assert.equal(reclaimed[0].attempts, 1);
  // Exhaust the remaining attempts.
  for (let i = 0; i < 4; i++) settleKnowledgeEvent(db, 1, event.event_id, 'index', 'failed', event.entry_revision);
  assert.equal(claimKnowledgeEvents(db, 1, 'index').length, 0);
  assert.throws(() => settleKnowledgeEvent(db, 1, event.event_id, 'index', 'done', event.entry_revision), /attempts exhausted|already settled/);
  // Graph channel is unaffected by index-channel failures.
  assert.equal(claimKnowledgeEvents(db, 1, 'graph').length, 1);
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
