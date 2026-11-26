import Database from 'better-sqlite3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { DockerExecution } from '../src/experiment/docker-execution.js';
import { registerExperimentTools } from '../src/experiment/agent-tools.js';

/**
 * Two-round agent chain driven by a MOCK planner (a plain function, no model).
 * It proves the tool layer supports the propose → run → read artifact →
 * revise loop against real isolated Docker executions. A Mock planner passing
 * is NOT evidence of autonomous-experiment capability with a real model.
 */

const db = new Database(':memory:');
migrateDatabase(db);
const root = mkdtempSync(join(tmpdir(), 'evo-agent-'));
const execution = new DockerExecution(db, { workspaceRoot: root });
after(async () => { await execution.dispose(); });

const tools = new Map<string, { execute(args: any, exec: any): Promise<string> }>();
let promptText = '';
const fakeCtx: any = {
  tools: { register: (tool: any) => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  systemPrompt: { section: (options: any) => { promptText = options.text; return () => { promptText = ''; }; } },
};

// 将测试 Agent 绑定到指定研究任务
registerExperimentTools(fakeCtx, execution, 1, 'mock-chain');
const execContext = () => ({ signal: new AbortController().signal });

let available = false;
let unavailableReason = '';
before(async () => {
  const environment = await execution.environment();
  available = environment.available;
  unavailableReason = environment.reason ?? '';
  // Two clearly separated clusters; with zero gradient steps the model cannot
  // separate them, with 300 it reaches perfect accuracy deterministically.
  const source = join(root, 'staged-train');
  mkdirSync(source, { recursive: true });
  const x = [[-1.2], [-1.0], [-0.8], [-0.6], [0.6], [0.8], [1.0], [1.2]];
  const y = [0, 0, 0, 0, 1, 1, 1, 1];
  writeFileSync(join(source, 'data.json'), JSON.stringify({ x, y }));
  execution.stageTaskData(1, 'mock-chain', { train: source });
});

const scriptFor = (iterations: number) => `
import json, pathlib
import numpy as np
train = json.loads(pathlib.Path('/train/data.json').read_text())
X = np.array(train['x'], dtype=float); y = np.array(train['y'], dtype=float)
X = np.column_stack([X, np.ones(len(X))])
w = np.zeros(X.shape[1])
for _ in range(${iterations}):
    p = 1 / (1 + np.exp(-X @ w))
    w -= 0.1 * (X.T @ (p - y)) / len(y)
acc = float((((1 / (1 + np.exp(-X @ w))) > 0.5).astype(float) == y).mean())
pathlib.Path('/work/metrics.json').write_text(json.dumps({'accuracy': acc, 'iterations': ${iterations}}))
print('accuracy', acc)
`;

test('experiment tools and system prompt are registered', () => {
  assert.deepEqual([...tools.keys()].sort(), ['experiment_list', 'experiment_read_artifact', 'experiment_run', 'experiment_status', 'experiment_stop']);
  assert.match(promptText, /experiment_run/);
  assert.match(promptText, /如实报告状态/);
  // The prompt must state the whitelist boundary honestly: no other tools,
  // no path control, certification not exposed to the agent.
  assert.match(promptText, /没有文件、Shell、子 Agent/);
  assert.match(promptText, /认证.*不向你开放/);
});

test('mock planner improves over two real isolated rounds', { timeout: 300000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const runTool = tools.get('experiment_run')!;
  const readTool = tools.get('experiment_read_artifact')!;
  const listTool = tools.get('experiment_list')!;

  // Mock planner: round 1 underfits on purpose (zero gradient steps means the
  // sigmoid stays at 0.5 and everything is misclassified one way); after
  // reading the artifact it raises the iteration budget.
  let iterations = 0;
  let accuracy = 0;
  const executions: number[] = [];
  for (let round = 1; round <= 2; round++) {
    const output = await runTool.execute({
    script: scriptFor(iterations), timeoutSeconds: 120,
    }, execContext());
    assert.match(output, /状态：succeeded/, output);
    const executionId = Number(output.match(/执行 #(\d+)/)![1]);
    executions.push(executionId);
    const metrics = JSON.parse(await readTool.execute({ execution_id: executionId, path: 'metrics.json' }, execContext()));
    accuracy = metrics.accuracy;
    if (accuracy >= 0.95) break;
    iterations = 300; // mock revision based on the observed artifact
  }
  assert.equal(executions.length, 2, 'mock planner needed exactly two rounds');
  assert.equal(accuracy, 1);
  const listing = await listTool.execute({ limit: 10 }, execContext());
  for (const id of executions) assert.match(listing, new RegExp(`#${id} succeeded`));
});

test('实验 Agent 不允许访问其他研究任务', async () => {
  // 创建同一用户下另一个研究任务的执行记录
  const otherId = Number(db.prepare(`
    INSERT INTO experiment_executions
    (owner_id, status, image, request_json)
    VALUES (?, ?, ?, ?)
  `).run(
    1,
    'succeeded',
    'test-image',
    JSON.stringify({ taskId: 'other-task' })
  ).lastInsertRowid);

  // 禁止查询其他任务的执行状态
  await assert.rejects(
    () => tools.get('experiment_status')!.execute(
      { execution_id: otherId }, execContext()
    ),
    /Execution not found in current task/
  );

  // 禁止停止其他任务的执行
  await assert.rejects(
    () => tools.get('experiment_stop')!.execute(
      { execution_id: otherId }, execContext()
    ),
    /Execution not found in current task/
  );

  // 禁止读取其他任务的实验产物
  await assert.rejects(
    () => tools.get('experiment_read_artifact')!.execute(
      { execution_id: otherId, path: 'metrics.json' },
      execContext()
    ),
    /Execution not found in current task/
  );

  // 实验列表不得包含其他任务的执行记录
  const listing = await tools.get('experiment_list')!
    .execute({ limit: 50 }, execContext());

  assert.doesNotMatch(
    listing,
    new RegExp(`#${otherId}\\s`)
  );
});
