
CREATE TABLE IF NOT EXISTS papers (
    paper_id INTEGER PRIMARY KEY,
    title TEXT,
    authors TEXT,
    year INTEGER,
    abstract TEXT,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待确认'
        CHECK (status IN ('待确认', '待补全', '已入库')),
    uploader_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL UNIQUE
        CHECK (length(content_hash) = 64)
);
