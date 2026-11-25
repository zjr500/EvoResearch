-- Apply through migrateKnowledge(): rebuild 001's global hash constraint atomically.
ALTER TABLE papers RENAME TO papers_legacy_f1;
CREATE TABLE papers (
 paper_id INTEGER PRIMARY KEY, title TEXT, authors TEXT, year INTEGER, abstract TEXT,
 file_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待确认'
 CHECK(status IN ('待确认','待补全','已入库')),
 uploader_id INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 full_text TEXT, parse_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(uploader_id,content_hash)
);
INSERT INTO papers(paper_id,title,authors,year,abstract,file_path,status,uploader_id,content_hash)
 SELECT paper_id,title,authors,year,abstract,file_path,status,uploader_id,content_hash FROM papers_legacy_f1;
DROP TABLE papers_legacy_f1;
CREATE TABLE kb_entries (
 entry_id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('paper_summary','experiment_report')),
 title TEXT NOT NULL, user_note TEXT, content TEXT NOT NULL,
 source_type TEXT NOT NULL CHECK(source_type IN ('paper','report')), source_id INTEGER NOT NULL,
 embedding BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, owner_id INTEGER NOT NULL,
 UNIQUE(source_type,source_id)
);
CREATE INDEX kb_entries_owner_created ON kb_entries(owner_id,created_at DESC,entry_id DESC);
-- Knowledge-owned journal; deliberately does not create or replace shared operation_records.
CREATE TABLE knowledge_operations (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
 operation_type TEXT NOT NULL, request_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('受理','执行中','成功','失败')),
 result_json TEXT, error_code INTEGER, error_message TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(owner_id,idempotency_key)
);
