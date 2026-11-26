-- Controlled Docker experiment executions. Registered through the module
-- migration directory mechanism; no shared migration file is edited.
CREATE TABLE experiment_executions (
  execution_id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','timeout','stopped')),
  image TEXT NOT NULL,
  container_name TEXT,
  request_json TEXT NOT NULL,
  exit_code INTEGER,
  log_tail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX experiment_executions_owner_created ON experiment_executions(owner_id, created_at DESC, execution_id DESC);
