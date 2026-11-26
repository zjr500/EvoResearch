-- Sync-event consistency: per-channel attempt counters so failed events can be
-- re-claimed a bounded number of times instead of being stranded forever.
ALTER TABLE knowledge_sync_events ADD COLUMN index_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_sync_events ADD COLUMN graph_attempts INTEGER NOT NULL DEFAULT 0;
