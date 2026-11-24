-- Shared metadata; result bodies remain in the compatibility payload store.
CREATE TABLE operation_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 idempotency_key TEXT NOT NULL UNIQUE,
 operation_type TEXT NOT NULL, target_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('受理','执行中','成功','失败')),
 request_digest TEXT NOT NULL, result_ref TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE operation_payloads (
 operation_id INTEGER PRIMARY KEY REFERENCES operation_records(id),
 owner_id INTEGER NOT NULL, scope TEXT NOT NULL, client_key TEXT NOT NULL,
 result_json TEXT, error_code INTEGER, error_message TEXT,
 UNIQUE(owner_id,scope,client_key)
);
