-- F7: host identity and environment check results. SSH credentials stay in DSH/OpenSSH.
CREATE TABLE IF NOT EXISTS remote_hosts (
  host_id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT,
  port INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  host_alias TEXT NOT NULL UNIQUE,
  gpu_info TEXT,
  driver TEXT,
  framework TEXT,
  work_dir TEXT,
  status TEXT NOT NULL CHECK (status IN ('自检中', '就绪', '不可用')),
  checked_at TEXT,
  error_code TEXT,
  error_reason TEXT
);
