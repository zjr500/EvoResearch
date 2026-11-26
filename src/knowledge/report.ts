import type Database from 'better-sqlite3';
import { AppError, ownerId } from '../infrastructure/errors.js';

export interface ReportPublication {
  reportId: number; title: string; content: unknown;
}

/**
 * Publish an experiment report into the knowledge base.
 * Idempotent on (source_type='report', source_id=reportId) via the existing
 * UNIQUE constraint: republishing the same report returns the stored entry
 * instead of creating a duplicate.
 */
export function publishReport(db: Database.Database, owner: number, input: ReportPublication) {
  ownerId(owner);
  if (!input || typeof input !== 'object') throw new AppError(4001, 'Report publication required');
  if (!Number.isSafeInteger(input.reportId) || input.reportId < 1) throw new AppError(4001, 'reportId must be a positive integer');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300) throw new AppError(4001, 'title must be non-empty text (max 300 chars)');
  const content = JSON.stringify(input.content ?? {});
  if (Buffer.byteLength(content) > 1024 * 1024) throw new AppError(4001, 'Report content too large');
  return db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO kb_entries(type,title,content,source_type,source_id,owner_id)
      VALUES('experiment_report',?,?,'report',?,?)
      ON CONFLICT(source_type,source_id) DO NOTHING`).run(input.title.trim(), content, input.reportId, owner);
    const entry = db.prepare("SELECT * FROM kb_entries WHERE source_type='report' AND source_id=?").get(input.reportId) as { entry_id: number; owner_id: number; title: string; content: string } | undefined;
    if (!entry) throw new AppError(5000, 'Report publication failed');
    if (entry.owner_id !== owner) throw new AppError(4001, 'Report source ID is already used by another owner');
    if (inserted.changes > 0) {
      db.prepare('INSERT INTO knowledge_sync_events(document_id,owner_id) VALUES(?,?)').run(entry.entry_id, owner);
      return { entry_id: entry.entry_id, duplicated: false };
    }
    // Same report ID with different content is a conflict, not a duplicate:
    // silently keeping the old version would publish the wrong report.
    if (entry.title !== input.title.trim() || entry.content !== content)
      throw new AppError(4009, 'Report ID already published with different content; use a new report ID');
    return { entry_id: entry.entry_id, duplicated: true };
  })();
}
