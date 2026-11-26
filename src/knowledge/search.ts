import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
// @ts-ignore sqlite-vec ships no type declarations
import { load as loadVecExtension } from 'sqlite-vec';
import { AppError, ownerId } from '../infrastructure/errors.js';
import type { EmbeddingProvider } from './embedding.js';

/** Cap embedded text so a pathological entry cannot blow up provider requests. */
const EMBED_TEXT_LIMIT = 6000;

interface EntryRow {
  entry_id: number; owner_id: number; type: string; title: string;
  user_note: string | null; content: string; source_type: string; source_id: number;
}

function embedText(row: Pick<EntryRow, 'title' | 'user_note' | 'content'>): string {
  return `${row.title}\n${row.user_note ?? ''}\n${row.content}`.slice(0, EMBED_TEXT_LIMIT);
}
function contentHash(row: Pick<EntryRow, 'title' | 'user_note' | 'content'>): string {
  return createHash('sha256').update(embedText(row)).digest('hex');
}
function snippetOf(row: EntryRow): string {
  try {
    const parsed = JSON.parse(row.content);
    const text = parsed?.abstract ?? parsed?.summary ?? parsed?.text;
    if (typeof text === 'string' && text.trim()) return text.slice(0, 600);
  } catch { /* content is plain text */ }
  return row.content.slice(0, 600);
}

export interface KnowledgeHit {
  id: string; title: string; snippet: string; score: number;
  source: { type: 'paper' | 'internal'; title: string; url: string | null };
  entry_id: number; source_id: number; distance: number;
}

/**
 * Owner-scoped semantic search over kb_entries backed by sqlite-vec.
 * The vec0 virtual table is created lazily once an embedding provider is
 * configured; a provider or dimension change drops and rebuilds the index.
 * Without a provider every search answers 4009 instead of faking results.
 */
export class KnowledgeSearch {
  private vecLoaded = false;
  constructor(
    private db: Database.Database,
    private provider: EmbeddingProvider | null,
    private providerError = '',
  ) {}

  private unavailable(): AppError {
    return new AppError(4009, this.providerError
      ? `Semantic search unavailable: embedding provider misconfigured (${this.providerError})`
      : 'Semantic search unavailable: no embedding provider configured (set EVORESEARCH_EMBEDDING_BASE and EVORESEARCH_EMBEDDING_MODEL)');
  }

  /** Provider vectors must match the index dimension and contain only finite numbers. */
  private checkedVector(vector: unknown, dim: number): Float32Array {
    const values = vector instanceof Float32Array ? vector : Array.isArray(vector) ? new Float32Array(vector as number[]) : null;
    if (!values || values.length !== dim) throw new AppError(4009, `Embedding provider returned a vector of the wrong dimension (expected ${dim})`);
    for (const value of values) if (!Number.isFinite(value)) throw new AppError(4009, 'Embedding provider returned a non-finite vector component');
    return values;
  }

  private async ensureIndex(): Promise<number> {
    if (!this.provider) throw this.unavailable();
    const dim = await this.provider.dim();
    if (!Number.isSafeInteger(dim) || dim < 1 || dim > 8192) throw new AppError(4009, 'Embedding provider returned an invalid dimension');
    if (!this.vecLoaded) { loadVecExtension(this.db); this.vecLoaded = true; }
    // v2: owner partition key makes KNN owner-scoped inside the index instead
    // of filtering a global top-k afterwards (which starved results).
    const signature = `v2:${this.provider.name}:${dim}`;
    const recorded = this.db.prepare("SELECT value FROM kb_index_state WHERE key='vector'").get() as { value: string } | undefined;
    if (recorded && recorded.value !== signature) {
      this.db.exec('DROP TABLE IF EXISTS kb_entry_vectors; DELETE FROM kb_embedding_meta');
      this.db.prepare("DELETE FROM kb_index_state WHERE key='vector'").run();
    }
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_entry_vectors'").get()) {
      this.db.exec(`CREATE VIRTUAL TABLE kb_entry_vectors USING vec0(entry_id INTEGER PRIMARY KEY, embedding float[${dim}] distance_metric=cosine, owner_id INTEGER PARTITION KEY)`);
      this.db.prepare("INSERT INTO kb_index_state(key,value) VALUES('vector',?)").run(signature);
    }
    return dim;
  }

  /** Embed new or edited entries for this owner. Returns the number re-embedded. */
  async reindex(owner: number): Promise<number> {
    ownerId(owner);
    const dim = await this.ensureIndex();
    const rows = this.db.prepare('SELECT entry_id,owner_id,type,title,user_note,content,source_type,source_id FROM kb_entries WHERE owner_id=?').all(owner) as EntryRow[];
    const meta = new Map((this.db.prepare('SELECT entry_id,content_hash FROM kb_embedding_meta WHERE owner_id=?').all(owner) as { entry_id: number; content_hash: string }[]).map((m) => [m.entry_id, m.content_hash]));
    const stale = rows.filter((row) => meta.get(row.entry_id) !== contentHash(row));
    let written = 0;
    for (let offset = 0; offset < stale.length; offset += 16) {
      const batch = stale.slice(offset, offset + 16);
      const vectors = await this.provider!.embed(batch.map(embedText));
      if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new AppError(4009, 'Embedding provider returned the wrong number of vectors');
      this.db.transaction(() => {
        batch.forEach((row, index) => {
          // Revision guard: the entry may have been edited while the provider
          // call was in flight; never index content that no longer matches.
          const current = this.db.prepare('SELECT title,user_note,content FROM kb_entries WHERE owner_id=? AND entry_id=?').get(owner, row.entry_id) as Pick<EntryRow, 'title' | 'user_note' | 'content'> | undefined;
          if (!current || contentHash(current) !== contentHash(row)) return;
          const vector = this.checkedVector(vectors[index], dim);
          // vec0 requires int64 keys; better-sqlite3 binds numbers as REAL.
          this.db.prepare('DELETE FROM kb_entry_vectors WHERE entry_id=?').run(BigInt(row.entry_id));
          this.db.prepare('INSERT INTO kb_entry_vectors(entry_id,embedding,owner_id) VALUES(?,?,?)').run(BigInt(row.entry_id), vector, BigInt(owner));
          this.db.prepare('INSERT OR REPLACE INTO kb_embedding_meta(owner_id,entry_id,content_hash) VALUES(?,?,?)').run(owner, row.entry_id, contentHash(row));
          written++;
        });
      })();
    }
    return written;
  }

  /** Drop the stored vector for an edited or deleted entry. */
  invalidate(owner: number, entryId: number): void {
    ownerId(owner);
    this.db.prepare('DELETE FROM kb_embedding_meta WHERE owner_id=? AND entry_id=?').run(owner, entryId);
    // Close the gap even when this session has not loaded the vec extension
    // yet but an index table exists from an earlier run.
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_entry_vectors'").get()) {
      if (!this.vecLoaded) { loadVecExtension(this.db); this.vecLoaded = true; }
      this.db.prepare('DELETE FROM kb_entry_vectors WHERE entry_id=?').run(BigInt(entryId));
    }
  }

  async search(owner: number, query: string, topK = 5): Promise<{ query: string; total: number; items: KnowledgeHit[] }> {
    ownerId(owner);
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new AppError(4001, 'query must be non-empty text (max 500 chars)');
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 20) throw new AppError(4001, 'top_k must be an integer between 1 and 20');
    if (!this.provider) throw this.unavailable();
    const dim = await this.ensureIndex();
    await this.reindex(owner);
    const [queryVector] = await this.provider!.embed([query.trim()]);
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM kb_entry_vectors WHERE owner_id=?').get(BigInt(owner)) as { n: number }).n;
    if (!total) return { query: query.trim(), total: 0, items: [] };
    // Owner-scoped KNN via the partition key: results can no longer be
    // starved by other owners' vectors occupying a global top-k window.
    const neighbors = this.db.prepare('SELECT entry_id, distance FROM kb_entry_vectors WHERE embedding MATCH ? AND k = ? AND owner_id = ? ORDER BY distance')
      .all(this.checkedVector(queryVector, dim), Math.min(total, Math.max(topK * 2, 8)), BigInt(owner)) as { entry_id: number; distance: number }[];
    const byId = new Map((this.db.prepare('SELECT entry_id,owner_id,type,title,user_note,content,source_type,source_id FROM kb_entries WHERE owner_id=?').all(owner) as EntryRow[]).map((row) => [row.entry_id, row]));
    const items: KnowledgeHit[] = [];
    for (const hit of neighbors) {
      const row = byId.get(hit.entry_id);
      if (!row) continue;
      items.push({
        id: String(row.entry_id), title: row.title, snippet: snippetOf(row),
        score: Math.min(1, Math.max(0, 1 - hit.distance)),
        source: { type: row.source_type === 'paper' ? 'paper' : 'internal', title: row.title, url: null },
        entry_id: row.entry_id, source_id: row.source_id, distance: hit.distance,
      });
      if (items.length >= topK) break;
    }
    return { query: query.trim(), total: items.length, items };
  }
}
