import { cpSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { AppError, ownerId } from '../infrastructure/errors.js';
import { ContainerMonitor, DockerEngine, type ContainerOutcome, type DockerEnvironment } from './docker-engine.js';
import { isDirectoryEmpty } from './integrity.js';

const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_TIMEOUT_SECONDS = 3600;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timeout', 'stopped']);

export interface ExperimentRunRequest {
  /** Task slug; the backend derives every mount from it. No paths accepted. */
  taskId: string;
  /** Python source executed as the container entrypoint script. */
  script: string;
  timeoutSeconds?: number;
  memoryMb?: number;
  cpus?: number;
  /** Idempotent start: a repeated key returns the existing execution. */
  idempotencyKey?: string;
}

export interface ExecutionRecord {
  execution_id: number; owner_id: number; status: string; image: string;
  container_name: string | null; image_id: string | null;
  exit_code: number | null; log_tail: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
  deadline: string | null; idempotency_key: string | null;
}

const RECORD_COLUMNS = 'execution_id,owner_id,status,image,container_name,image_id,exit_code,log_tail,created_at,started_at,finished_at,deadline,idempotency_key';

/**
 * Controlled Docker execution for experiments.
 *
 * Isolation model (server-enforced, not caller-policed):
 * - Callers name a task, never a path. The backend derives one task directory
 *   (`<root>/tasks/<taskId>`) and one work directory per execution
 *   (`work/exec-<id>`), so executions never overlap and can never reach the
 *   workspace root, other tasks, or the certification root.
 * - Training data lives in `data/train` and `data/val` under the task
 *   directory and is mounted read-only; it never sits inside a writable mount.
 * - Hidden test sets live under the separate certification root, which no
 *   training container ever mounts.
 * - The image is digest-pinned at start and the pin is recorded.
 * - A persistent monitor enforces deadlines from start (not from wait),
 *   finalizes terminal state only after the container really exited, and
 *   stops containers on plugin unload. Restart recovery reconciles rows
 *   against actual container state.
 */
export class DockerExecution {
  readonly tasksRoot: string;
  private readonly engine: DockerEngine;
  private readonly monitor: ContainerMonitor;
  private readonly instanceTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly finalizing = new Set<number>();

  constructor(
    private db: Database.Database,
    options: { workspaceRoot: string; engine?: DockerEngine; monitor?: ContainerMonitor },
  ) {
    this.engine = options.engine ?? new DockerEngine();
    this.monitor = options.monitor ?? new ContainerMonitor(this.engine);
    this.tasksRoot = resolve(options.workspaceRoot, 'tasks');
    mkdirSync(this.tasksRoot, { recursive: true });
  }

  async environment(): Promise<DockerEnvironment> {
    return this.engine.environment();
  }

  private taskIdOf(value: unknown): string {
    if (typeof value !== 'string' || !TASK_ID_PATTERN.test(value)) throw new AppError(4001, 'taskId must be 1-64 chars of letters, digits, dash or underscore');
    return value;
  }

  /** Paths of a task directory; created on demand, always inside the tasks root. */
  prepareTask(owner: number, taskId: string) {
    ownerId(owner);
    const task = this.taskIdOf(taskId);
    const taskDir = join(this.tasksRoot, task);
    const paths = {
      taskDir,
      workDir: join(taskDir, 'work'),
      trainDir: join(taskDir, 'data', 'train'),
      valDir: join(taskDir, 'data', 'val'),
    };
    mkdirSync(paths.workDir, { recursive: true });
    mkdirSync(paths.trainDir, { recursive: true });
    mkdirSync(paths.valDir, { recursive: true });
    return paths;
  }

  /** Stage dataset content into a task's read-only data dirs (host-side copy). */
  stageTaskData(owner: number, taskId: string, source: { train?: string; val?: string }): void {
    const paths = this.prepareTask(owner, taskId);
    for (const [role, target] of [['train', paths.trainDir], ['val', paths.valDir]] as const) {
      const src = source[role];
      if (!src) continue;
      const resolved = realpathSync(resolve(src));
      if (!statSync(resolved).isDirectory()) throw new AppError(4001, `${role} source must be a directory`);
      cpSync(resolved, target, { recursive: true });
    }
  }

  /** Start an isolated run. Idempotent on (owner, idempotencyKey). */
  async start(owner: number, request: ExperimentRunRequest): Promise<number> {
    ownerId(owner);
    const taskId = this.taskIdOf(request.taskId);
    if (typeof request.script !== 'string' || !request.script.trim()) throw new AppError(4001, 'script required');
    if (Buffer.byteLength(request.script) > MAX_SCRIPT_BYTES) throw new AppError(4001, 'script too large');
    const timeoutSeconds = request.timeoutSeconds ?? 600;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) throw new AppError(4001, `timeoutSeconds must be 1..${MAX_TIMEOUT_SECONDS}`);
    const memoryMb = request.memoryMb ?? 512;
    if (!Number.isSafeInteger(memoryMb) || memoryMb < 64 || memoryMb > 8192) throw new AppError(4001, 'memoryMb must be 64..8192');
    const cpus = request.cpus ?? 1;
    if (typeof cpus !== 'number' || cpus < 0.5 || cpus > 8) throw new AppError(4001, 'cpus must be 0.5..8');
    const idempotencyKey = request.idempotencyKey === undefined ? null : String(request.idempotencyKey);
    if (idempotencyKey !== null && (idempotencyKey.length < 1 || idempotencyKey.length > 200)) throw new AppError(4001, 'idempotencyKey too long');
    if (idempotencyKey) {
      const existing = this.db.prepare('SELECT execution_id FROM experiment_executions WHERE owner_id=? AND idempotency_key=?').get(owner, idempotencyKey) as { execution_id: number } | undefined;
      if (existing) return existing.execution_id;
    }
    const environment = await this.engine.requireEnvironment();
    const paths = this.prepareTask(owner, taskId);
    const deadline = new Date(Date.now() + timeoutSeconds * 1000);
    let executionId: number;
    try {
      executionId = Number(this.db.prepare(`INSERT INTO experiment_executions(owner_id,status,image,image_id,request_json,started_at,deadline,idempotency_key)
        VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?,?)`).run(owner, 'running', this.engine.image, environment.imageId ?? null,
        JSON.stringify({ taskId, timeoutSeconds, memoryMb, cpus, scriptBytes: Buffer.byteLength(request.script) }),
        deadline.toISOString(), idempotencyKey).lastInsertRowid);
    } catch (error) {
      if (idempotencyKey && String(error).includes('UNIQUE')) {
        const raced = this.db.prepare('SELECT execution_id FROM experiment_executions WHERE owner_id=? AND idempotency_key=?').get(owner, idempotencyKey) as { execution_id: number };
        return raced.execution_id;
      }
      throw error;
    }
    const container = this.containerName(executionId);
    try {
      const execDir = join(paths.workDir, `exec-${executionId}`);
      mkdirSync(execDir, { recursive: true });
      await writeFile(join(execDir, '.evoresearch-entry.py'), request.script, 'utf8');
      await this.engine.startIsolated({
        name: container, imageId: environment.imageId!,
        workMount: { source: realpathSync(execDir), target: '/work' },
        extraMounts: [
          ...(isDirectoryEmpty(paths.trainDir) ? [] : [{ source: realpathSync(paths.trainDir), target: '/train', readonly: true }]),
          ...(isDirectoryEmpty(paths.valDir) ? [] : [{ source: realpathSync(paths.valDir), target: '/val', readonly: true }]),
        ],
        limits: { memoryMb, cpus }, command: ['-u', '.evoresearch-entry.py'],
      });
      this.db.prepare('UPDATE experiment_executions SET container_name=? WHERE execution_id=?').run(container, executionId);
      this.track(executionId, container, deadline.getTime());
      return executionId;
    } catch (error) {
      this.db.prepare(`UPDATE experiment_executions SET status='failed',log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE execution_id=?`)
        .run(`container start failed: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`, executionId);
      throw new AppError(4009, 'Container start failed; execution recorded as failed');
    }
  }

  private containerName(executionId: number): string {
    return `evoresearch-exec-${this.instanceTag}-${executionId}`;
  }

  private track(executionId: number, container: string, deadlineMs: number): void {
    this.monitor.track({
      name: container, deadlineMs,
      onExit: async (outcome) => { await this.finalize(executionId, container, outcome); },
    });
  }

  /** Finalize only after the container really exited; never trusts the row alone. */
  private async finalize(executionId: number, container: string, outcome: ContainerOutcome): Promise<void> {
    if (this.finalizing.has(executionId)) return;
    this.finalizing.add(executionId);
    try {
      const exitCode = await this.engine.exitCode(container);
      const logTail = await this.engine.logs(container);
      await this.engine.remove(container);
      const status = outcome === 'timeout' ? 'timeout' : outcome === 'stopped' ? 'stopped' : exitCode === 0 ? 'succeeded' : 'failed';
      this.db.prepare(`UPDATE experiment_executions SET status=?,exit_code=?,log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE execution_id=? AND status='running'`)
        .run(status, exitCode, logTail, executionId);
    } finally {
      this.finalizing.delete(executionId);
    }
  }

  /** Reconcile running rows with actual containers after a host restart. */
  async recover(): Promise<void> {
    const rows = this.db.prepare(`SELECT execution_id,container_name,deadline FROM experiment_executions WHERE status='running'`).all() as { execution_id: number; container_name: string | null; deadline: string | null }[];
    for (const row of rows) {
      const container = row.container_name ?? this.containerName(row.execution_id);
      const running = await this.engine.runningState(container);
      if (running === true) {
        this.track(row.execution_id, container, row.deadline ? Date.parse(row.deadline) : Date.now() + 60000);
      } else if (running === false) {
        await this.finalize(row.execution_id, container, 'exited');
      } else {
        this.db.prepare(`UPDATE experiment_executions SET status='failed',log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE execution_id=? AND status='running'`)
          .run('container lost during host restart', row.execution_id);
      }
    }
  }

  /** Owner-scoped record read; other owners' executions do not exist. */
  record(owner: number, executionId: number): ExecutionRecord {
    ownerId(owner);
    const row = this.db.prepare(`SELECT ${RECORD_COLUMNS} FROM experiment_executions WHERE execution_id=? AND owner_id=?`).get(executionId, owner) as ExecutionRecord | undefined;
    if (!row) throw new AppError(4004, 'Execution not found');
    return row;
  }

  list(owner: number, limit = 50, taskId?: string): ExecutionRecord[] {
    ownerId(owner);
    const rows = this.db.prepare(`SELECT ${RECORD_COLUMNS} FROM experiment_executions WHERE owner_id=? ORDER BY execution_id DESC LIMIT ?`).all(owner, limit) as ExecutionRecord[];
    if (taskId === undefined) return rows;
    const task = this.taskIdOf(taskId);
    return rows.filter((row) => this.requestTaskId(row.execution_id) === task);
  }

  /** Live logs for running containers, stored tail once finished. */
  async logs(owner: number, executionId: number): Promise<string> {
    const row = this.record(owner, executionId);
    if (TERMINAL_STATUSES.has(row.status)) return row.log_tail ?? '(no logs)';
    return this.engine.logs(row.container_name ?? this.containerName(executionId));
  }

  /** Cooperative cancel: the monitor stops the container and finalizes as 'stopped'. */
  async cancel(owner: number, executionId: number): Promise<void> {
    const row = this.record(owner, executionId);
    if (TERMINAL_STATUSES.has(row.status)) return;
    const container = row.container_name ?? this.containerName(executionId);
    this.monitor.requestStop(container);
    // The monitor owns finalization; wait for the row to settle so callers
    // never observe a half-canceled execution.
    let deadline = Date.now() + 30000;
    while (!TERMINAL_STATUSES.has(this.record(owner, executionId).status) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 400));
    if (!TERMINAL_STATUSES.has(this.record(owner, executionId).status)) {
      // Fallback: enforce directly, then wait out any in-flight finalize.
      await this.engine.stop(container);
      await this.finalize(executionId, container, 'stopped');
      deadline = Date.now() + 15000;
      while (!TERMINAL_STATUSES.has(this.record(owner, executionId).status) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /** Wait until terminal state; the monitor drives finalization, this only observes. */
  async wait(owner: number, executionId: number, pollMs = 500): Promise<ExecutionRecord> {
    const first = this.record(owner, executionId);
    const ceiling = first.deadline ? Date.parse(first.deadline) + 60000 : Date.now() + 660000;
    let row = first;
    while (!TERMINAL_STATUSES.has(row.status)) {
      if (Date.now() > ceiling) throw new AppError(4009, 'execution monitor did not finalize in time');
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      row = this.record(owner, executionId);
    }
    return row;
  }

  /** Start, wire an optional abort signal to cancel, and wait. */
  async run(owner: number, request: ExperimentRunRequest, signal?: AbortSignal): Promise<ExecutionRecord> {
    if (signal?.aborted) throw new AppError(4009, 'execution canceled before start');
    const executionId = await this.start(owner, request);
    if (signal) {
      if (signal.aborted) await this.cancel(owner, executionId);
      else signal.addEventListener('abort', () => void this.cancel(owner, executionId), { once: true });
    }
    return this.wait(owner, executionId);
  }

  /** Read a text artifact from a finished execution's own work directory. */
  readArtifact(owner: number, executionId: number, relativePath: string, maxBytes = 512 * 1024): string {
    const row = this.record(owner, executionId);
    if (!TERMINAL_STATUSES.has(row.status)) throw new AppError(4009, 'Execution is still running');
    if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) throw new AppError(4001, 'artifact path required');
    const workDir = realpathSync(this.execWorkDir(executionId));
    const target = realpathSync(resolve(workDir, relativePath));
    if (target !== workDir && !target.startsWith(workDir + sep)) throw new AppError(4001, 'artifact path must stay inside the execution work directory');
    const size = statSync(target).size;
    if (size > maxBytes) throw new AppError(4001, 'artifact too large');
    return readFileSync(target, 'utf8');
  }

  /** Host-side path of an execution's work directory (snapshots, tests). */
  execWorkDir(executionId: number): string {
    const row = this.db.prepare('SELECT request_json FROM experiment_executions WHERE execution_id=?').get(executionId) as { request_json: string } | undefined;
    if (!row) throw new AppError(4004, 'Execution not found');
    const taskId = JSON.parse(row.request_json).taskId as string;
    return join(this.tasksRoot, taskId, 'work', `exec-${executionId}`);
  }

  private requestTaskId(executionId: number): string | undefined {
    const row = this.db.prepare('SELECT request_json FROM experiment_executions WHERE execution_id=?').get(executionId) as { request_json: string } | undefined;
    return row ? (JSON.parse(row.request_json).taskId as string) : undefined;
  }

  /** Plugin unload: stop running containers, then stop monitoring. */
  async dispose(): Promise<void> {
    await this.monitor.stopAll();
    this.monitor.dispose();
  }
}
