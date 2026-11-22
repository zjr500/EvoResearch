
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateKnowledge } from "../src/knowledge/database.js";
import Database from "better-sqlite3";
import { savePaper } from "../src/knowledge/paper-repository.js";

test("F1：论文保存与重复检测", () => {
  // 创建临时内存数据库
  const db = new Database(":memory:");

  try {
    // 执行正式的 papers 建表脚本
    migrateKnowledge(db);

    const paper = {
      filePath: "unused-test-path.pdf",
      uploaderId: 1,
      contentHash: "a".repeat(64),
      abstract: "这是一篇测试论文的摘要",
    };

    // 第一次保存
    const first = savePaper(db, paper);

    assert.equal(first.duplicated, false);
    assert.equal(first.record.paper_id, 1);
    assert.equal(first.record.abstract, paper.abstract);

    // 第二次保存同一篇论文
    const second = savePaper(db, paper);

    assert.equal(second.duplicated, true);
    assert.equal(second.record.paper_id, first.record.paper_id);

    // 数据库中应该只有一条记录
    const count = db
      .prepare("SELECT COUNT(*) AS total FROM papers")
      .get() as { total: number };

    assert.equal(count.total, 1);
  } finally {
    db.close();
  }
});


// Force a competing row to appear after the initial lookup but before INSERT.
// Unlike Promise scheduling, this deterministically exercises the conflict path.
test('F1: insert conflict returns the existing same-owner row without swallowing other constraints', () => {
  const db = new Database(':memory:');
  try {
    migrateKnowledge(db);
    db.exec(`CREATE TEMP TRIGGER simulate_competing_upload BEFORE INSERT ON papers
      WHEN NEW.file_path = 'racing.pdf'
      BEGIN
        INSERT INTO papers(file_path,uploader_id,content_hash,title)
        VALUES('winner.pdf',NEW.uploader_id,NEW.content_hash,'Existing metadata');
      END;`);
    const result = savePaper(db, {filePath:'racing.pdf',uploaderId:1,contentHash:'b'.repeat(64)});
    assert.equal(result.duplicated, true);
    assert.equal(result.record.title, 'Existing metadata');
    assert.equal(result.record.file_path, 'winner.pdf');
    assert.equal((db.prepare('SELECT count(*) n FROM papers').get() as {n:number}).n, 1);
    db.exec('DROP TRIGGER simulate_competing_upload');
    const other = savePaper(db, {filePath:'other.pdf',uploaderId:2,contentHash:'b'.repeat(64)});
    assert.equal(other.duplicated, false);
    assert.notEqual(other.record.paper_id, result.record.paper_id);
    assert.throws(() => savePaper(db, {filePath:null as unknown as string,uploaderId:1,contentHash:'c'.repeat(64)}), /NOT NULL/);
  } finally { db.close(); }
});
