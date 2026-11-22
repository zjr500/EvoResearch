
import type Database from "better-sqlite3";

export interface PaperRecord {
  paper_id: number;
  title: string | null;
  authors: string | null;
  year: number | null;
  abstract: string | null;
  file_path: string;
  status: "待确认" | "待补全" | "已入库";
  uploader_id: number;
  content_hash: string;
}

export interface NewPaper {
  filePath: string;
  uploaderId: number;
  contentHash: string;
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  abstract?: string | null;
}

export function savePaper(
  db: Database.Database,
  paper: NewPaper
): { record: PaperRecord; duplicated: boolean } {
  // 先检查是否已经上传过相同内容的 PDF
  const existing = db
    .prepare("SELECT * FROM papers WHERE uploader_id = ? AND content_hash = ?")
    .get(paper.uploaderId, paper.contentHash) as PaperRecord | undefined;

  if (existing) {
    return { record: existing, duplicated: true };
  }

  // 保存新论文
  const result = db.prepare(`
    INSERT INTO papers (
      title, authors, year, abstract,
      file_path, status, uploader_id, content_hash
    )
    VALUES (?, ?, ?, ?, ?, '待确认', ?, ?)
    ON CONFLICT(uploader_id, content_hash) DO NOTHING
  `).run(
    paper.title ?? null,
    paper.authors ?? null,
    paper.year ?? null,
    paper.abstract ?? null,
    paper.filePath,
    paper.uploaderId,
    paper.contentHash
  );

  const record = db
    .prepare("SELECT * FROM papers WHERE uploader_id = ? AND content_hash = ?")
    .get(paper.uploaderId, paper.contentHash) as PaperRecord;

  return { record, duplicated: result.changes === 0 };
}
