-- Additive UC01 upgrade; preserve IDs, source PDFs, summaries and operation history.
ALTER TABLE papers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE papers ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'not_generated';
ALTER TABLE papers ADD COLUMN summary_error TEXT;
ALTER TABLE papers ADD COLUMN summary_run TEXT;
ALTER TABLE papers ADD COLUMN legacy_status TEXT;
UPDATE papers SET legacy_status=status,status='待确认'
 WHERE status='已入库' AND NOT EXISTS (SELECT 1 FROM kb_entries k WHERE k.source_type='paper' AND k.source_id=papers.paper_id AND k.owner_id=papers.uploader_id);
UPDATE papers SET summary_status='ready' WHERE pending_summary IS NOT NULL OR EXISTS
 (SELECT 1 FROM kb_entries k WHERE k.source_type='paper' AND k.source_id=papers.paper_id AND k.owner_id=papers.uploader_id);
CREATE TABLE knowledge_model_choices (
 owner_id INTEGER PRIMARY KEY, choice_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
-- Durable handoff only. No worker is installed and no indexing/graph success is implied.
CREATE TABLE knowledge_sync_events (
 event_id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES kb_entries(entry_id),
 owner_id INTEGER NOT NULL, entry_revision INTEGER NOT NULL DEFAULT 1,
 event_type TEXT NOT NULL DEFAULT 'entry-confirmed',
 index_status TEXT NOT NULL DEFAULT 'pending', graph_status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(document_id,entry_revision)
);
INSERT INTO knowledge_sync_events(document_id,owner_id) SELECT entry_id,owner_id FROM kb_entries;
