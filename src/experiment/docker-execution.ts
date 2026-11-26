import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { AppError, ownerId } from '../infrastructure/errors.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKER_IMAGE = 'evoresearch-worker:latest';
const WINDOWS_DOCKER_BIN = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const MAX_SCRIPT_BYTES = 256 * 1024;
const LOG_TAIL_BYTES = 64 * 1024;
const MAX_TIMEOUT_SECONDS = 3600;

export interface DockerEnvironment {
  available: boolean; reason?: string;
  dockerBin?: string; serverVersion?: string; imageId?: string;
}

export interface ExperimentRunRequest {
  /** Python source executed as the container entrypoint script. */
  script: string;
  /** Read-write bind mount, must resolve inside the workspace root. */
  workDir: string;
  /** Optional read-only training data mount (target /train). */
  trainDir?: string;
  /** Optional read-only validation data mount (target /val). */
  valDir?: string;
  timeoutSeconds?: number;
  memoryMb?: number;
  cpus?: number;
}

export interface ExecutionRecord {
  execution_id: number; owner_id: number; status: string; image: string;
  container_name: string | null;
  exit_code: number | null; log_tail: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}

/**
 * Controlled Docker execution for experiments. Runs only the pinned worker
 * image with network disabled, all capabilities dropped, no privilege
 * escalation, an unprivileged user, and read-only everything except the
 * whitelisted work mount. When any isolation property cannot be guaranteed
 * (no daemon, missing pinned image, mount outside the workspace root) the
 * execution is refused instead of silently degrading.
 */
export class DockerExecution {
  private readonly image: string;
  private readonly workspaceRoot: string;
  private readonly stopRequested = new Set<number>();
  constructor(private db: Database.Database, options: { workspaceRoot: string; image?: string }) {
    this.image = options.image ?? DEFAULT_WORKER_IMAGE;
    this.workspaceRoot = resolve(options.workspaceRoot);
    mkdirSync(this.workspaceRoot, { recursive: true });
  }

  private dockerBin(): string {
    if (process.env.EVORESEARCH_DOCKER_BIN) return process.env.EVORESEARCH_DOCKER_BIN;
    if (existsSync(WINDOWS_DOCKER_BIN)) return WINDOWS_DOCKER_BIN;
    return 'docker';
  }

  private async docker(args: string[], timeoutMs = 30000): Promise<string> {
    const { stdout } = await execFileAsync(this.dockerBin(), args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  }

  /** Probe the daemon and pinned image; never throws, reports availability. */
  async environment(): Promise<DockerEnvironment> {
    const dockerBin = this.dockerBin();
    let serverVersion: string;
    try {
      serverVersion = await this.docker(['version', '--format', '{{.Server.Version}}'], 15000);
    } catch (error) {
      return { available: false, reason: `docker daemon unreachable (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`, dockerBin };
    }
    try {
      const imageId = await this.docker(['image', 'inspect', this.image, '--format', '{{.Id}}'], 15000);
      return { available: true, dockerBin, serverVersion, imageId };
    } catch {
      return { available: false, reason: `pinned worker image ${this.image} is not present; refusing to pull or substitute`, dockerBin, serverVersion };
    }
  }

  private async requireEnvironment(): Promise<DockerEnvironment> {
    const environment = await this.environment();
    if (!environment.available) throw new AppError(4009, `Docker execution unavailable: ${environment.reason}`);
    return environment;
  }

  /** Resolve a mount path and prove it stays inside the workspace root. */
  private mountSource(dir: string, role: string): string {
    if (typeof dir !== 'string' || !dir.trim()) throw new AppError(4001, `${role} directory required`);
    const resolved = realpathSync(resolve(dir));
    if (resolved !== this.workspaceRoot && !resolved.startsWith(this.workspaceRoot + sep))
      throw new AppError(4001, `${role} directory must stay inside ${this.workspaceRoot}`);
    return resolved;
  }

  /** Start an isolated run; returns the execution id immediately. */
  async start(owner: number, request: ExperimentRunRequest): Promise<number> {
    ownerId(owner);
    if (!request || typeof request.script !== 'string' || !request.script.trim()) throw new AppError(4001, 'script required');
    if (Buffer.byteLength(request.script) > MAX_SCRIPT_BYTES) throw new AppError(4001, 'script too large');
    const timeoutSeconds = request.timeoutSeconds ?? 600;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) throw new AppError(4001, `timeoutSeconds must be 1..${MAX_TIMEOUT_SECONDS}`);
    const memoryMb = request.memoryMb ?? 512;
    if (!Number.isSafeInteger(memoryMb) || memoryMb < 64 || memoryMb > 8192) throw new AppError(4001, 'memoryMb must be 64..8192');
    const cpus = request.cpus ?? 1;
    if (typeof cpus !== 'number' || cpus < 0.5 || cpus > 8) throw new AppError(4001, 'cpus must be 0.5..8');
    const workDir = this.mountSource(request.workDir, 'work');
    const trainDir = request.trainDir ? this.mountSource(request.trainDir, 'train') : undefined;
    const valDir = request.valDir ? this.mountSource(request.valDir, 'val') : undefined;
    await this.requireEnvironment();

    const inserted = this.db.prepare(`INSERT INTO experiment_executions(owner_id,status,image,request_json,started_at)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP)`).run(owner, 'running', this.image,
      JSON.stringify({ workDir, trainDir, valDir, timeoutSeconds, memoryMb, cpus, scriptBytes: Buffer.byteLength(request.script) }));
    const executionId = Number(inserted.lastInsertRowid);
    const container = `evoresearch-exec-${executionId}`;
    try {
      await writeFile(join(workDir, '.evoresearch-entry.py'), request.script, 'utf8');
      const args = ['run', '-d', '--name', container, '--pull', 'never',
        '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--user', '65534:65534',
        '--pids-limit', '64', '--memory', `${memoryMb}m`, '--cpus', String(cpus),
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
        '--mount', `type=bind,source=${workDir},target=/work`,
        ...(trainDir ? ['--mount', `type=bind,source=${trainDir},target=/train,readonly`] : []),
        ...(valDir ? ['--mount', `type=bind,source=${valDir},target=/val,readonly`] : []),
        '--workdir', '/work', '--entrypoint', 'python', this.image, '-u', '.evoresearch-entry.py'];
      await this.docker(args, 60000);
      this.db.prepare('UPDATE experiment_executions SET container_name=? WHERE execution_id=?').run(container, executionId);
      return executionId;
    } catch (error) {
      this.db.prepare(`UPDATE experiment_executions SET status='failed',log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE execution_id=?`)
        .run(`container start failed: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`, executionId);
      throw new AppError(4009, 'Container start failed; execution recorded as failed');
    }
  }

  private async inspect(container: string, format: string): Promise<string> {
    return this.docker(['inspect', '--format', format, container], 15000);
  }

  /** Wait for completion or timeout; stops the container past its deadline. */
  async wait(executionId: number, pollMs = 500): Promise<ExecutionRecord> {
    const row = this.record(executionId);
    if (row.status !== 'running') return row;
    const request = JSON.parse(this.requestJson(executionId));
    const deadline = Date.now() + request.timeoutSeconds * 1000;
    const container = row.container_name ?? `evoresearch-exec-${executionId}`;
    let running = true;
    while (running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      running = (await this.inspect(container, '{{.State.Running}}')) === 'true';
    }
    let status = 'succeeded';
    if (running || this.stopRequested.has(executionId)) {
      await this.docker(['stop', '--time', '2', container], 30000).catch(() => '');
      status = running ? 'timeout' : 'stopped';
      this.stopRequested.delete(executionId);
    }
    const exitCode = Number(await this.inspect(container, '{{.State.ExitCode}}').catch(() => '-1'));
    if (status === 'succeeded' && exitCode !== 0) status = 'failed';
    let logTail = '';
    try {
      const { stdout, stderr } = await execFileAsync(this.dockerBin(), ['logs', container], { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      logTail = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(-LOG_TAIL_BYTES);
    } catch { logTail = '(logs unavailable)'; }
    await this.docker(['rm', '-f', container], 15000).catch(() => '');
    this.db.prepare(`UPDATE experiment_executions SET status=?,exit_code=?,log_tail=?,finished_at=CURRENT_TIMESTAMP WHERE execution_id=?`)
      .run(status, exitCode, logTail, executionId);
    return this.record(executionId);
  }

  /** Convenience: start and wait. */
  async run(owner: number, request: ExperimentRunRequest): Promise<ExecutionRecord> {
    return this.wait(await this.start(owner, request));
  }

  /** Request an early stop; the wait loop finalizes status as 'stopped'. */
  async stop(executionId: number): Promise<void> {
    const row = this.record(executionId);
    if (row.status !== 'running') throw new AppError(4009, 'Execution is not running');
    this.stopRequested.add(executionId);
    await this.docker(['stop', '--time', '2', row.container_name ?? `evoresearch-exec-${executionId}`], 30000).catch(() => '');
  }

  record(executionId: number): ExecutionRecord {
    const row = this.db.prepare('SELECT execution_id,owner_id,status,image,container_name,exit_code,log_tail,created_at,started_at,finished_at FROM experiment_executions WHERE execution_id=?').get(executionId) as ExecutionRecord | undefined;
    if (!row) throw new AppError(4004, 'Execution not found');
    return row;
  }

  list(owner: number, limit = 50): ExecutionRecord[] {
    ownerId(owner);
    return this.db.prepare('SELECT execution_id,owner_id,status,image,container_name,exit_code,log_tail,created_at,started_at,finished_at FROM experiment_executions WHERE owner_id=? ORDER BY execution_id DESC LIMIT ?').all(owner, limit) as ExecutionRecord[];
  }

  private requestJson(executionId: number): string {
    return (this.db.prepare('SELECT request_json FROM experiment_executions WHERE execution_id=?').get(executionId) as { request_json: string }).request_json;
  }
}
