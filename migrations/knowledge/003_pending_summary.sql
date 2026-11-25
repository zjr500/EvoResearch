-- 保存尚未确认入库的 AI 生成摘要
ALTER TABLE papers ADD COLUMN pending_summary TEXT;