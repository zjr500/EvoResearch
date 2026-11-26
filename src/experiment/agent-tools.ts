import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { DockerExecution, ExecutionRecord } from './docker-execution.js';

function describe(record: ExecutionRecord): string {
  return [
    `执行 #${record.execution_id} 状态：${record.status}（退出码 ${record.exit_code ?? '无'}）`,
    `开始：${record.started_at ?? '-'}  结束：${record.finished_at ?? '-'}  截止：${record.deadline ?? '-'}`,
    '日志尾部：',
    (record.log_tail ?? '(无日志)').slice(-4000),
  ].join('\n');
}

/**
 * 注册当前研究任务专用的实验工具。
 * 任务身份由后端绑定，Agent 不能自行指定其他任务。
 * 普通对话不加载这些工具。
 */
export function registerExperimentTools(
  ctx: Context,
  execution: DockerExecution,
  owner: number,
  taskId: string
) {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'experiment_run',
      description: '在当前研究任务的隔离 Docker 容器中运行 Python 实验脚本（断网、非 root、资源受限）。训练数据在 /train、/val（只读），产物写入 /work。任务身份及挂载目录由后端确定。返回执行状态、退出码与日志尾部。',
      parameters: {
        
        script: { type: 'string', required: true, description: 'Python 脚本源码' },
        timeoutSeconds: { type: 'integer', description: '超时秒数，默认 600，超时容器被强制停止' },
        memoryMb: { type: 'integer', description: '内存上限 MB，默认 512' },
        cpus: { type: 'number', description: 'CPU 核数上限，默认 1' },
        idempotencyKey: { type: 'string', description: '幂等键；重复提交返回已有执行而不是再跑一次' },
      },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: {
        script: string;
        timeoutSeconds?: number;
        memoryMb?: number;
        cpus?: number;
        idempotencyKey?: string;
      }, exec: ToolRunContext) {
        const record = await execution.run(owner, {
          taskId, script: args.script,
          timeoutSeconds: args.timeoutSeconds, memoryMb: args.memoryMb, cpus: args.cpus,
          idempotencyKey: args.idempotencyKey,
        }, exec.signal);
        return describe(record);
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_stop',
      description: '主动停止一次仍在运行的实验执行；容器被真实停止，状态记录为 stopped。',
      parameters: { execution_id: { type: 'integer', required: true, description: '要停止的执行编号' } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { execution_id: number }) {
        execution.assertTaskExecution(owner, taskId, args.execution_id);
        await execution.cancel(owner, args.execution_id);
        return describe(execution.record(owner, args.execution_id));
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_status',
      description: '查询一次实验执行的最新状态与日志（运行中返回实时日志）。',
      parameters: { execution_id: { type: 'integer', required: true, description: 'experiment_run 返回的执行编号' } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { execution_id: number }) {
        execution.assertTaskExecution(owner, taskId, args.execution_id);
        const record = execution.record(owner, args.execution_id);
        const live = ['succeeded', 'failed', 'timeout', 'stopped'].includes(record.status) ? null : await execution.logs(owner, args.execution_id);
        return live === null ? describe(record) : `${describe(record)}\n实时日志：\n${live.slice(-4000)}`;
      },
    })),
    ctx.tools.register(defineTool({
      name: 'experiment_list',
      description: '列出当前研究任务最近的实验执行记录（编号、状态、时间）。',
      parameters: {
        limit: { type: 'integer', description: '返回条数，默认 10，最多 50' },
      },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      async execute(args: { limit?: number }) {
        const rows = execution.list(
          owner,
          Math.min(args.limit ?? 10, 50),
          taskId
        );

        if (!rows.length) return '还没有实验执行记录。';

        return rows.map(
          (row) => `#${row.execution_id} ${row.status} exit=${row.exit_code ?? '-'} ${row.created_at}`
        ).join('\n');
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
        execution.assertTaskExecution(owner, taskId, args.execution_id);
        return execution.readArtifact(owner, args.execution_id, args.path);
      },
    })),
  ];
  const disposePrompt = (ctx as any).systemPrompt?.section({
    name: 'tool:evoresearch-experiment', order: 160,
    text: [
      '实验执行规则：',
      '- 通过 experiment_run 提交 Python 脚本在隔离容器中运行；容器断网、非 root、资源受限，训练数据在 /train 与 /val（只读），产物写入 /work。',
      '- 当前研究任务由后端绑定，无需提供 taskId；所有挂载目录由后端确定，你无权切换研究任务或指定宿主机路径。',
      '- 用 experiment_read_artifact 读取产物（如 metrics.json）后再决定下一轮实验；每轮都要基于上一轮的真实结果。',
      '- 用 experiment_status / experiment_list 跟踪执行；失败时先读日志尾部定位原因；需要中止时用 experiment_stop。',
      '- 你没有文件、Shell、子 Agent 等其他工具；不要尝试绕过容器边界，不要尝试联网安装依赖。',
      '- 如实报告状态：succeeded/failed/timeout/stopped 均以执行记录为准，不得把未运行的实验说成已完成。',
      '- 认证（对隐藏测试集的评估）由宿主可信流程执行，不向你开放；不要声称已完成认证。',
    ].join('\n'),
  });
  return () => { for (const dispose of disposers.reverse()) dispose(); disposePrompt?.(); };
}
