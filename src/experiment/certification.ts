import { chmodSync, cpSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { AppError, ownerId } from '../infrastructure/errors.js';
import { ContainerMonitor, DockerEngine, type ContainerOutcome, type DockerEnvironment } from './docker-engine.js';
import { hashDirectory, verifyDirectory } from './integrity.js';
import type { DockerExecution } from './docker-execution.js';

const MAX_SCRIPT_BYTES = 256 * 1024;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timeout', 'stopped']);
const CERT_RECORD_COLUMNS = 'certification_id,owner_id,snapshot_id,test_set_id,status,image,image_id,container_name,exit_code,log_tail,created_at,started_at,finished_at';

export interface SnapshotRecord {
  snapshot_id: number; owner_id: number; task_id: string;
  source_execution_id: number | null; content_hash: string; created_at: string;
}
export interface TestSetRecord {
  test_set_id: number; owner_id: number; name: string; content_hash: string; created_at: string;
}
export interface CertificationRecord {
  certification_id: number; owner_id: number; snapshot_id: number; test_set_id: number;
  status: string; image: string; image_id: string | null; container_name: string | null;
  exit_code: number | null; log_tail: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}

/**
 * Trusted certification base.
 *
 * - freezeCandidate copies a finished execution's artifacts into the
 *   certification root, hashes the full manifest and marks files read-only.
 *   The snapshot is immutable: every certification re-verifies the hash.
 * - Test sets are registered the same way (copy + hash) and live under the
 *   certification root, which training containers never mount.
 * - certify() runs the frozen candidate against a frozen test set in the same
 *   isolation profile as training, driven by the host — never by the
 *   experiment agent, which has no tool reaching certification runs,
 *   results, snapshot directories, or test sets.
 */
export class CertificationService {
  readonly root: string;
  private readonly engine: DockerEngine;
  private readonly monitor: ContainerMonitor;
  private readonly instanceTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private db: Database.Database,
    options: { certificationRoot: string; execution?: DockerExecution; engine?: DockerEngine; monitor?: ContainerMonitor },
  ) {
    this.engine = options.engine ?? new DockerEngine();
    this.monitor = options.monitor ?? new ContainerMonitor(this.engine);
    this.root = resolve(options.certificationRoot);
    for (const dir of ['snapshots', 'testsets', 'runs']) mkdirSync(join(this.root, dir), { recursive: true });
    this.execution = options.execution;
  }

  private execution?: DockerExecution;

  async environment(): Promise<DockerEnvironment> {
    return this.engine.environment();
  }

  /** Register a hidden test set by copying it into the certification root. */
  registerTestSet(owner: number, name: string, sourceDir: string): number {
    ownerId(owner);
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_-]{1,64}$/u.test(name.trim())) throw new AppError(4001, 'test set name invalid');
    const source = realpathSync(resolve(sourceDir));
    if (source.startsWith(this.root)) throw new AppError(4001, 'test set source must be outside the certification root');
    const { entries, hash } = hashDirectory(source);
    if (!entries.length) throw new AppError(4001, 'test set is empty');
    const id = Number(this.db.prepare('INSERT INTO test_sets(owner_id,name,content_hash,test_set_dir) VALUES(?,?,?,?)')
      .run(owner, name.trim(), hash, '').lastInsertRowid);
    const target = join(this.root, 'testsets', `ts-${id}`);
    try {
      cpSync(source, target, { recursive: true });
      this.markReadonly(target);
      this.db.prepare('UPDATE test_sets SET test_set_dir=? WHERE test_set_id=?').run(target, id);
    } catch (error) {
      this.db.prepare('DELETE FROM test_sets WHERE test_set_id=?').run(id);
      rmSync(target, { recursive: true, force: true });
      throw error;
    }
    return id;
  }

  /** Freeze a finished execution's artifacts into an immutable candidate snapshot. */
  freezeCandidate(owner: number, input: { taskId: string; executionId: number; files?: string[] }): number {
    ownerId(owner);
    if (!this.execution) throw new AppError(4009, 'execution service unavailable');
    if (typeof input.taskId !== 'string' || !input.taskId.trim()) throw new AppError(4001, 'taskId required');
    // 确保被冻结的实验产物属于当前研究任务
    this.execution.assertTaskExecution(
      owner,
      input.taskId,
      input.executionId
    );
    const record = this.execution.record(owner, input.executionId);
    if (!TERMINAL_STATUSES.has(record.status)) throw new AppError(4009, 'execution is still running; freeze only finished runs');
    if (record.status !== 'succeeded') throw new AppError(4001, `cannot freeze a ${record.status} execution as a candidate`);
    const source = realpathSync(this.execution.execWorkDir(input.executionId));
    if (source.startsWith(this.root)) throw new AppError(4001, 'candidate source must be outside the certification root');
    const available = hashDirectory(source).entries;
    const selected = input.files?.length ? available.filter((entry) => input.files!.includes(entry.path)) : available;
    if (!selected.length) throw new AppError(4001, 'nothing to freeze');
    if (input.files?.length && selected.length !== new Set(input.files).size) throw new AppError(4001, 'some requested files do not exist in the execution work directory');
    const id = Number(this.db.prepare(`INSERT INTO candidate_snapshots(owner_id,task_id,source_execution_id,content_hash,manifest_json,snapshot_dir)
      VALUES(?,?,?,?,?,?)`).run(owner, input.taskId, input.executionId, '0'.repeat(64), JSON.stringify(selected), '').lastInsertRowid);
    const target = join(this.root, 'snapshots', `snap-${id}`);
    try {
      mkdirSync(target, { recursive: true });
      for (const entry of selected) cpSync(join(source, entry.path), join(target, entry.path), { recursive: true });
      this.markReadonly(target);
      const frozen = hashDirectory(target);
      this.db.prepare('UPDATE candidate_snapshots SET content_hash=?,manifest_json=?,snapshot_dir=? WHERE snapshot_id=?')
        .run(frozen.hash, JSON.stringify(frozen.entries), target, id);
    } catch (error) {
      this.db.prepare('DELETE FROM candidate_snapshots WHERE snapshot_id=?').run(id);
      rmSync(target, { recursive: true, force: true });
      throw error;
    }
    return id;
  }

  private markReadonly(dir: string): void {
    const walk = (current: string) => {
      for (const item of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, item.name);
        if (item.isDirectory()) walk(full);
        else if (item.isFile()) { try { chmodSync(full, 0o444); } catch { /* Windows ACL best effort */ } }
      }
    };
    walk(dir);
  }

  snapshot(owner: number, snapshotId: number): SnapshotRecord {
    ownerId(owner);
    const row = this.db.prepare('SELECT snapshot_id,owner_id,task_id,source_execution_id,content_hash,created_at FROM candidate_snapshots WHERE snapshot_id=? AND owner_id=?').get(snapshotId, owner) as SnapshotRecord | undefined;
    if (!row) throw new AppError(4004, 'Snapshot not found');
    return row;
  }

  testSets(owner: number): TestSetRecord[] {
    ownerId(owner);
    return this.db.prepare('SELECT test_set_id,owner_id,name,content_hash,created_at FROM test_sets WHERE owner_id=? ORDER BY test_set_id').all(owner) as TestSetRecord[];
  }

  /** Tamper check: recompute the frozen hash before any certification. */
  private verifyFrozen(table: 'candidate_snapshots' | 'test_sets', idColumn: string, dirColumn: string, id: number): { dir: string; hash: string } {
    const row = this.db.prepare(`SELECT ${dirColumn} AS dir, content_hash AS hash FROM ${table} WHERE ${idColumn}=?`).get(id) as { dir: string; hash: string } | undefined;
    if (!row) throw new AppError(4004, 'frozen artifact not found');
    if (!verifyDirectory(row.dir, row.hash)) throw new AppError(4009, `${table} #${id} failed integrity verification; refusing to certify tampered content`);
    return row;
  }

  /** Run a frozen candidate against a frozen test set. Host-driven only. */
  async certify(owner: number, input: { snapshotId: number; testSetId: number; script: string; timeoutSeconds?: number }): Promise<number> {
    ownerId(owner);
    if (typeof input.script !== 'string' || !input.script.trim()) throw new AppError(4001, 'evaluation script required');
    if (Buffer.byteLength(input.script) > MAX_SCRIPT_BYTES) throw new AppError(4001, 'evaluation script too large');
    const timeoutSeconds = input.timeoutSeconds ?? 600;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new AppError(4001, 'timeoutSeconds must be 1..3600');
    this.snapshot(owner, input.snapshotId);
    const snapshot = this.verifyFrozen('candidate_snapshots', 'snapshot_id', 'snapshot_dir', input.snapshotId);
    // 检查测试集是否属于当前用户
    const ownedTestSet = this.db.prepare(
      'SELECT test_set_id FROM test_sets WHERE test_set_id=? AND owner_id=?'
    ).get(input.testSetId, owner);

    if (!ownedTestSet) {
      throw new AppError(4004, 'Test set not found');
    }
    const testSet = this.verifyFrozen('test_sets', 'test_set_id', 'test_set_dir', input.testSetId);
    const environment = await this.engine.requireEnvironment();
    const deadline = new Date(Date.now() + timeoutSeconds * 1000);
    const id = Number(this.db.prepare(`INSERT INTO certifications(owner_id,snapshot_id,test_set_id,status,image,image_id,request_json,started_at,deadline)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`).run(owner, input.snapshotId, input.testSetId, 'running', this.engine.image, environment.imageId ?? null,
      JSON.stringify({ timeoutSeconds, scriptBytes: Buffer.byteLength(input.script) }), deadline.toISOString()).lastInsertRowid);
    const container = `evoresearch-cert-${this.instanceTag}-${id}`;
    try {
      const runDir = join(this.root, 'runs', `cert-${id}`);
      mkdirSync(runDir, { recursive: true });
      await writeFile(join(runDir, '.evoresearch-eval.py'), input.script, 'utf8');
      await this.engine.startIsolated({
        name: container, imageId: environment.imageId!,
        workMount: { source: realpathSync(runDir), target: '/work' },
        extraMounts: [
          { source: realpathSync(snapshot.dir), target: '/candidate', readonly: true },
          { source: realpathSync(testSet.dir), target: '/eval', readonly: true },
        ],
        limits: { memoryMb: 512, cpus: 1 }, command: ['-u', '.evoresearch-eval.py'],
      });
      this.db.prepare('UPDATE certifications SET container_name=? WHERE certification_id=?').run(container, id);
      this.monitor.track({
        name: container, deadlineMs: deadline.getTime(),
        onExit: async (outcome) => { await this.finalize(id, container, outcome); },
      });
      return id;
    } catch (error) {
      this.db.prepare(`UPDATE certifications SET status='failed',log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE certification_id=?`)
        .run(`certification start failed: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`, id);
      throw new AppError(4009, 'Certification start failed; recorded as failed');
    }
  }

  private async finalize(id: number, container: string, outcome: ContainerOutcome): Promise<void> {
    const exitCode = await this.engine.exitCode(container);
    const logTail = await this.engine.logs(container);
    await this.engine.remove(container);
    const status = outcome === 'timeout' ? 'timeout' : outcome === 'stopped' ? 'stopped' : exitCode === 0 ? 'succeeded' : 'failed';
    this.db.prepare(`UPDATE certifications SET status=?,exit_code=?,log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE certification_id=? AND status='running'`)
      .run(status, exitCode, logTail, id);
  }

  async wait(owner: number, certificationId: number, pollMs = 500): Promise<CertificationRecord> {
    let row = this.result(owner, certificationId);
    let guard = 0;
    while (!TERMINAL_STATUSES.has(row.status)) {
      if (++guard > 14400) throw new AppError(4009, 'certification monitor did not finalize in time');
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      row = this.result(owner, certificationId);
    }
    return row;
  }

  /** Owner-scoped read; certification results are not exposed to the experiment agent. */
  result(owner: number, certificationId: number): CertificationRecord {
    ownerId(owner);
    const row = this.db.prepare(`SELECT ${CERT_RECORD_COLUMNS} FROM certifications WHERE certification_id=? AND owner_id=?`).get(certificationId, owner) as CertificationRecord | undefined;
    if (!row) throw new AppError(4004, 'Certification not found');
    return row;
  }

  list(owner: number, snapshotId?: number): CertificationRecord[] {
    ownerId(owner);
    if (snapshotId !== undefined)
      return this.db.prepare(`SELECT ${CERT_RECORD_COLUMNS} FROM certifications WHERE owner_id=? AND snapshot_id=? ORDER BY certification_id DESC`).all(owner, snapshotId) as CertificationRecord[];
    return this.db.prepare(`SELECT ${CERT_RECORD_COLUMNS} FROM certifications WHERE owner_id=? ORDER BY certification_id DESC LIMIT 50`).all(owner) as CertificationRecord[];
  }

  async recover(): Promise<void> {
    const rows = this.db.prepare(`SELECT certification_id,container_name,deadline FROM certifications WHERE status='running'`).all() as { certification_id: number; container_name: string | null; deadline: string | null }[];
    for (const row of rows) {
      const container = row.container_name ?? `evoresearch-cert-${this.instanceTag}-${row.certification_id}`;
      const running = await this.engine.runningState(container);
      if (running === true) {
        this.monitor.track({
          name: container, deadlineMs: row.deadline ? Date.parse(row.deadline) : Date.now() + 60000,
          onExit: async (outcome) => { await this.finalize(row.certification_id, container, outcome); },
        });
      } else if (running === false) {
        await this.finalize(row.certification_id, container, 'exited');
      } else {
        this.db.prepare(`UPDATE certifications SET status='failed',log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE certification_id=? AND status='running'`)
          .run('container lost during host restart', row.certification_id);
      }
    }
  }

  async dispose(): Promise<void> {
    await this.monitor.stopAll();
    this.monitor.dispose();
  }
}
