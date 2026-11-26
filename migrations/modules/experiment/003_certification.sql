-- Trusted certification base: immutable candidate snapshots, registered test
-- sets, and host-side certification runs. Training executions never mount
-- anything under the certification root.
CREATE TABLE candidate_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  source_execution_id INTEGER,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  manifest_json TEXT NOT NULL,
  snapshot_dir TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX candidate_snapshots_owner_task ON candidate_snapshots(owner_id, task_id, snapshot_id DESC);

CREATE TABLE test_sets (
  test_set_id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  test_set_dir TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, name)
);

CREATE TABLE certifications (
  certification_id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL REFERENCES candidate_snapshots(snapshot_id),
  test_set_id INTEGER NOT NULL REFERENCES test_sets(test_set_id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','timeout','stopped')),
  image TEXT NOT NULL,
  image_id TEXT,
  container_name TEXT,
  request_json TEXT NOT NULL,
  exit_code INTEGER,
  log_tail TEXT,
  deadline TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX certifications_owner ON certifications(owner_id, created_at DESC, certification_id DESC);
