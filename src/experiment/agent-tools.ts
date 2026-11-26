import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolve } from 'node:path';
import type { DockerExecution, ExecutionRecord } from './docker-execution.js';

function describe(record: ExecutionRecord): string {
  return [
    `执行 #${record.execution_id} 状态：${record.status}（退出码 ${record.exit_code ?? '无'}）`,
    `开始：${record.started_at ?? '-'}  结束：${record.finished_at ?? '-'}`,
    '日志尾部：',
    (record.log_tail ?? '(无日志)').slice(-4000),
  ].join('\n');
}

/**
 * Experiment agent surface. The model proposes Python scripts; every run goes
 * through DockerExecution's pinned, offline, unprivileged container — the
 * agent never touches the docker CLI, the host filesystem outside the
 * experiments workspace, or the network. Paths are relative to the
 * experiments workspace root.
 */
export function registerExperimentTools(ctx: Context, execution: DockerExecution, workspaceRoot: string, owner: number) {
  const insideWorkspace = (relative: string | undefined, role: string): string | undefined => {
    if (relative === undefined) return undefined;
    if (typeof relative !== 'string' || !relative.trim() || relative.includes('\0') || relative.includes('..')) throw new Error(`${role} 必须是工作区内的相对路径`);
    return resolve(workspaceRoot, relative);
  };
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'experiment_run',
      description: '在隔离 Docker 容器中运行一段 Python 实验脚本（断网、非 root、资源受限）。返回执行状态、退出码与日志尾部。workDir/trainDir/valDir 为实验工作区内的相对路径，train/val 只读挂载到 /train、/val，workDir 可写挂载到 /work。',
      parameters: {
        script: { type: 'string', required: true, description: 'Python 脚本源码' },
        workDir: { type: 'string', required: true, description: '可写工作目录（相对实验工作区）' },
        trainDir: { type: 'string', description: '训练数据目录（相对路径，只读挂载 /train）' },
        valDir: { type: 'string', description: '验证数据目录（相对路径，只读挂载 /val）' },
        timeoutSeconds: { type: 'integer', description: '超时秒数，默认 600' },
        memoryMb: { type: 'integer', description: '内存上限 MB，默认 512' },
        cpus: { type: 'number', description: 'CPU 核数上限，默认 1' },
      },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { script: string; workDir: string; trainDir?: string; valDir?: string; timeoutSeconds?: number; memoryMb?: number; cpus?: number }) {
        const record = await execution.run(owner, {
          script: args.script,
          workDir: insideWorkspace(args.workDir, 'workDir')!,
          trainDir: insideWorkspace(args.trainDir, 'trainDir'),
          valDir: insideWorkspace(args.valDir, 'valDir'),
          timeoutSeconds: args.timeoutSeconds,
          memoryMb: args.memoryMb,
          cpus: args.cpus,
        });
        return describe(record);
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_status',
      description: '查询一次实验执行的最新状态与日志尾部。',
      parameters: { execution_id: { type: 'integer', required: true, description: 'experiment_run 返回的执行编号' } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { execution_id: number }) {
        return describe(execution.record(args.execution_id));
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_list',
      description: '列出最近的实验执行记录（编号、状态、时间）。',
      parameters: { limit: { type: 'integer', description: '返回条数，默认 10，最多 50' } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { limit?: number }) {
        const rows = execution.list(owner, Math.min(args.limit ?? 10, 50));
        if (!rows.length) return '还没有实验执行记录。';
        return rows.map((row) => `#${row.execution_id} ${row.status} exit=${row.exit_code ?? '-'} ${row.created_at}`).join('\n');
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_read_artifact',
      description: '读取已完成实验工作目录中的文本产物（如 metrics.json），用于决定下一步实验。',
      parameters: {
        execution_id: { type: 'integer', required: true, description: '产生该产物的执行编号' },
        path: { type: 'string', required: true, description: '产物相对路径（限于该执行的工作目录内）' },
      },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { execution_id: number; path: string }) {
        return execution.readArtifact(args.execution_id, args.path);
      },
    })),
  ];
  const disposePrompt = (ctx as any).systemPrompt?.section({
    name: 'tool:evoresearch-experiment', order: 160,
    text: [
      '实验执行规则：',
      '- 通过 experiment_run 提交 Python 脚本在隔离容器中运行；容器断网、非 root、资源受限，训练数据在 /train 与 /val（只读），产物写入 /work。',
      '- 用 experiment_read_artifact 读取产物（如 metrics.json）后再决定下一轮实验；每轮都要基于上一轮的真实结果。',
      '- 用 experiment_status / experiment_list 跟踪执行；失败时先读日志尾部定位原因。',
      '- 只能使用实验工作区内的相对路径，不访问宿主机其他路径，不尝试联网安装依赖。',
      '- 如实报告状态：succeeded/failed/timeout 均以执行记录为准，不得把未运行的实验说成已完成。',
    ].join('\n'),
  });
  return () => { for (const dispose of disposers.reverse()) dispose(); disposePrompt?.(); };
}
