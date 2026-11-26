-- Public knowledge services: embedding index metadata and per-owner report uniqueness guard.
-- The sqlite-vec virtual table is created lazily by the search service once an
-- embedding provider is configured, because its dimension is provider-defined.
CREATE TABLE IF NOT EXISTS kb_embedding_meta (
  owner_id INTEGER NOT NULL,
  entry_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, entry_id)
);
CREATE TABLE IF NOT EXISTS kb_index_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
