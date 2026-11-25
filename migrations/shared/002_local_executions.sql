CREATE TABLE local_executions (
 execution_id TEXT PRIMARY KEY,
 operation_id INTEGER NOT NULL UNIQUE REFERENCES operation_records(id),
 owner_id INTEGER NOT NULL,
 job_id TEXT, session_id TEXT,
 status TEXT NOT NULL,
 enforcement TEXT,
 exit_code INTEGER,
 termination_confirmed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
