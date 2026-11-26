import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { AppError } from '../infrastructure/errors.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKER_IMAGE = 'evoresearch-worker:latest';
const WINDOWS_DOCKER_BIN = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
export const LOG_TAIL_BYTES = 64 * 1024;

export interface DockerEnvironment {
  available: boolean; reason?: string;
  dockerBin?: string; serverVersion?: string; imageId?: string;
}

export interface MountSpec { source: string; target: string; readonly?: boolean }
export interface ContainerLimits { memoryMb: number; cpus: number }

/**
 * Low-level Docker adapter shared by experiment execution and certification.
 * Every container runs with the same isolation profile: network disabled,
 * all capabilities dropped, no privilege escalation, unprivileged user,
 * read-only root filesystem, bounded pids/memory/cpu. Nothing here ever
 * relaxes isolation; callers that cannot satisfy it must refuse.
 */
export class DockerEngine {
  readonly image: string;
  constructor(options: { image?: string } = {}) {
    this.image = options.image ?? DEFAULT_WORKER_IMAGE;
  }

  dockerBin(): string {
    if (process.env.EVORESEARCH_DOCKER_BIN) return process.env.EVORESEARCH_DOCKER_BIN;
    if (existsSync(WINDOWS_DOCKER_BIN)) return WINDOWS_DOCKER_BIN;
    return 'docker';
  }

  private async docker(args: string[], timeoutMs = 30000): Promise<string> {
    const { stdout } = await execFileAsync(this.dockerBin(), args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
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

  async requireEnvironment(): Promise<DockerEnvironment> {
    const environment = await this.environment();
    if (!environment.available) throw new AppError(4009, `Docker execution unavailable: ${environment.reason}`);
    return environment;
  }

  /** Digest-pinned image reference so 'latest' retagging cannot swap code mid-run. */
  imageRef(imageId: string): string {
    return `${this.image}@${imageId}`;
  }

  /** Start a detached isolated container. Mounts are provided fully resolved by callers. */
  async startIsolated(spec: {
    name: string; imageId: string;
    workMount: MountSpec; extraMounts?: MountSpec[];
    limits: ContainerLimits; command: string[];
  }): Promise<void> {
    const mounts = [spec.workMount, ...(spec.extraMounts ?? [])];
    const args = ['run', '-d', '--name', spec.name, '--pull', 'never',
      '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      '--pids-limit', '64', '--memory', `${spec.limits.memoryMb}m`, '--cpus', String(spec.limits.cpus),
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
      ...mounts.flatMap((m) => ['--mount', `type=bind,source=${m.source},target=${m.target}${m.readonly ? ',readonly' : ''}`]),
      '--workdir', spec.workMount.target, '--entrypoint', 'python', this.imageRef(spec.imageId), ...spec.command];
    await this.docker(args, 60000);
  }

  async inspect(name: string, format: string): Promise<string> {
    return this.docker(['inspect', '--format', format, name], 15000);
  }

  /** true=running, false=exited, null=container gone. */
  async runningState(name: string): Promise<boolean | null> {
    try {
      return (await this.inspect(name, '{{.State.Running}}')) === 'true';
    } catch {
      return null;
    }
  }

  async exitCode(name: string): Promise<number> {
    try {
      return Number(await this.inspect(name, '{{.State.ExitCode}}'));
    } catch {
      return -1;
    }
  }

  /** Live log snapshot; works for running and stopped containers. */
  async logs(name: string): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(this.dockerBin(), ['logs', name], { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      return (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(-LOG_TAIL_BYTES);
    } catch {
      return '(logs unavailable)';
    }
  }

  async stop(name: string): Promise<void> {
    await this.docker(['stop', '--time', '2', name], 30000).catch(() => '');
  }

  async remove(name: string): Promise<void> {
    await this.docker(['rm', '-f', name], 15000).catch(() => '');
  }
}

export type ContainerOutcome = 'exited' | 'timeout' | 'stopped';

interface TrackedContainer {
  name: string;
  deadlineMs: number;
  stopRequested: boolean;
  onExit: (outcome: ContainerOutcome) => Promise<void>;
}

/**
 * Persistent container monitor. Deadlines are enforced from the moment a
 * container is tracked, not from when someone happens to wait. Each tracked
 * container fires its completion callback exactly once.
 */
export class ContainerMonitor {
  private readonly tracked = new Map<string, TrackedContainer>();
  private readonly timer: NodeJS.Timeout;
  private polling = false;
  constructor(private engine: DockerEngine, pollMs = 1000) {
    this.timer = setInterval(() => void this.poll(), pollMs);
    this.timer.unref();
  }

  track(item: { name: string; deadlineMs: number; onExit: (outcome: ContainerOutcome) => Promise<void> }): void {
    this.tracked.set(item.name, { ...item, stopRequested: false });
  }

  /** Ask the monitor to stop a tracked container; completion reports 'stopped'. */
  requestStop(name: string): void {
    const item = this.tracked.get(name);
    if (item) item.stopRequested = true;
  }

  isTracked(name: string): boolean {
    return this.tracked.has(name);
  }

  /** Stop every tracked container (plugin unload); completions still fire. */
  async stopAll(): Promise<void> {
    for (const item of this.tracked.values()) item.stopRequested = true;
    const deadline = Date.now() + 15000;
    while (this.tracked.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  dispose(): void {
    clearInterval(this.timer);
    this.tracked.clear();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [name, item] of [...this.tracked]) {
        let outcome: ContainerOutcome | null = null;
        if (item.stopRequested) {
          await this.engine.stop(name);
          outcome = 'stopped';
        } else if (Date.now() >= item.deadlineMs) {
          await this.engine.stop(name);
          outcome = 'timeout';
        } else {
          const running = await this.engine.runningState(name);
          if (running === false) outcome = 'exited';
          else if (running === null) outcome = 'exited'; // container vanished; finalize with what we can read
        }
        if (outcome) {
          this.tracked.delete(name);
          try {
            await item.onExit(outcome);
          } catch { /* finalization errors must not kill the monitor */ }
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
