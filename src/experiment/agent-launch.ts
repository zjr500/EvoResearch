import { registerExperimentTools } from './agent-tools.js';
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { AppError, ownerId } from '../infrastructure/errors.js';
import type { PurposeModels } from '../infrastructure/models.js';
import type { DockerExecution } from './docker-execution.js';

/** Preset declared in cordis.patch.yml; holds ONLY the experiment tool surface. */
export const EXPERIMENT_PRESET_ID = 'evoresearch-experiment';

export interface ExperimentAgentLaunchRequest {
  /** Task slug; the backend derives the agent cwd from it, never from caller paths. */
  taskId: string;
  /** Initial experiment instruction for the agent. */
  prompt: string;
}

export interface ExperimentAgentInfo {
  sessionId: string;
  taskId: string;
  /** Immutable model snapshot taken at launch; later settings changes do not move a live run. */
  model: { provider: string; model: string; reasoningEffort?: string };
}

/** Structural views of host services; avoids a hard dependency on host internals. */
interface AgentLike {
  cancel(cause: { kind: 'user' } | { kind: 'parent' } | { kind: 'hook'; reason: string }): void;
  followup(message: unknown): void;
}
interface AgentHandleLike { agent: AgentLike; dispose(): Promise<void> }
interface AgentsServiceLike {
  create(options: {
    sessionId: string;
    meta?: { cwd?: string; agentPreset?: string };
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    setup?: (agentCtx: Context) => void | Promise<void>;
  }): Promise<AgentHandleLike>;
}
interface PresetsServiceLike {
  resolve(id?: string): Promise<{ id: string; broken?: string }>;
  mount(ctx: Context, id?: string): Promise<unknown>;
}

const MAX_PROMPT_CHARS = 32 * 1024;

/**
 * Launches experiment agents bound to the restricted `evoresearch-experiment`
 * preset: the only tools the model ever sees are the experiment_* surface
 * registered by preset-plugin.ts. No file, shell, or subagent tools exist in
 * that scope, and the certification service is never provided to it.
 *
 * - The agent cwd is the backend-derived task directory; callers never pass a path.
 * - The model selection is snapshotted at launch from the 'experiment' purpose.
 * - cancel() aborts the model turn AND stops the task's running containers, so
 *   a stopped agent never leaves an orphan run consuming resources.
 */
export class ExperimentAgentService {
  private readonly live = new Map<string, { handle: AgentHandleLike; taskId: string }>();

  constructor(
    private readonly hostCtx: Context,
    private readonly models: PurposeModels,
    private readonly execution: DockerExecution,
  ) {}

  async configureAgent(
    agentCtx: Context,
    owner: number,
    taskId: string
  ): Promise<void> {
    const presets = this.hostCtx.get(
      'agentPresets'
    ) as PresetsServiceLike;

    await presets.mount(agentCtx, EXPERIMENT_PRESET_ID);

    // 禁止继承其他工具
    agentCtx.tools.restrict({ allow: [] });

    // 注册当前任务的实验工具
    agentCtx.effect(() =>
      registerExperimentTools(
        agentCtx,
        this.execution,
        owner,
        taskId
      )
    );

    agentCtx.tools.presentAs('native');
  }

  async launch(owner: number, request: ExperimentAgentLaunchRequest): Promise<ExperimentAgentInfo> {
    ownerId(owner);
    if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new AppError(4001, 'prompt required');
    if (request.prompt.length > MAX_PROMPT_CHARS) throw new AppError(4001, 'prompt too long');
    const agents = this.hostCtx.get('agents') as AgentsServiceLike | undefined;
    if (!agents) throw new AppError(4009, 'DSH agent service unavailable');
    const presets = this.hostCtx.get('agentPresets') as PresetsServiceLike | undefined;
    if (!presets) throw new AppError(4009, 'DSH agent preset service unavailable');
    const preset = await presets.resolve(EXPERIMENT_PRESET_ID);
    if (preset.broken) throw new AppError(4009, `experiment preset is not usable: ${preset.broken}`);
    // Immutable model snapshot for this run.
    const selection = this.models.selection('experiment');
    // Backend-derived task directory; also creates the data mount points.
    const { taskDir } = this.execution.prepareTask(owner, request.taskId);
    const sessionId = randomUUID();
    const handle = await agents.create({
      sessionId,
      meta: { cwd: taskDir, agentPreset: EXPERIMENT_PRESET_ID },
      agentOptions: {
        provider: selection.provider, model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      },
      setup: async (agentCtx: Context) => {
        await this.configureAgent(
          agentCtx,
          owner,
          request.taskId
      );
    },
    });
    try {
      handle.agent.followup({
        id: randomUUID(), role: 'user',
        content: [{ type: 'text', text: request.prompt }],
        source: { kind: 'user' },
      });
    } catch (error) {
      await handle.dispose();
      throw error;
    }
    this.live.set(sessionId, { handle, taskId: request.taskId });
    return { sessionId, taskId: request.taskId, model: selection };
  }

  /** Abort the agent turn, stop its task's running containers, tear the agent down. */
  async cancel(owner: number, sessionId: string): Promise<void> {
    ownerId(owner);
    const entry = this.live.get(sessionId);
    if (!entry) throw new AppError(4004, 'experiment agent not found');
    this.live.delete(sessionId);
    entry.handle.agent.cancel({ kind: 'user' });
    for (const row of this.execution.list(owner, 50, entry.taskId)) {
      if (row.status === 'running') await this.execution.cancel(owner, row.execution_id).catch(() => undefined);
    }
    await entry.handle.dispose();
  }

  /** Live session ids (for diagnostics / tests). */
  sessions(): string[] {
    return [...this.live.keys()];
  }

  /** Plugin unload: cancel every live experiment agent. */
  async dispose(): Promise<void> {
    const entries = [...this.live.entries()];
    this.live.clear();
    for (const [, entry] of entries) {
      entry.handle.agent.cancel({ kind: 'parent' });
      await entry.handle.dispose().catch(() => undefined);
    }
  }
}
