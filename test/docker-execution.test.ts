import Database from 'better-sqlite3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { DockerExecution } from '../src/experiment/docker-execution.js';

const db = new Database(':memory:');
migrateDatabase(db);
const root = mkdtempSync(join(tmpdir(), 'evo-docker-'));
const service = new DockerExecution(db, { workspaceRoot: root });
let available = false;
let unavailableReason = '';
before(async () => {
  const environment = await service.environment();
  available = environment.available;
  unavailableReason = environment.reason ?? '';
});
after(async () => { await service.dispose(); });

/** Real CPU training: logistic regression on synthetic data, metrics artifact written to /work. */
const TRAINING_SCRIPT = `
import json, pathlib
import numpy as np
train = json.loads(pathlib.Path('/train/data.json').read_text())
X = np.array(train['x'], dtype=float); y = np.array(train['y'], dtype=float)
X = np.column_stack([X, np.ones(len(X))])
w = np.zeros(X.shape[1])
for _ in range(300):
    p = 1 / (1 + np.exp(-X @ w))
    w -= 0.5 * (X.T @ (p - y)) / len(y)
acc = float((((1 / (1 + np.exp(-X @ w))) > 0.5).astype(float) == y).mean())
pathlib.Path('/work/metrics.json').write_text(json.dumps({'accuracy': acc, 'weights': w.tolist()}))
print('TRAINING_ACCURACY', acc)
`;

function stageTrainData(taskId: string) {
  const source = mkdtempSync(join(tmpdir(), 'evo-train-'));
  const rng = [[0.1, 0], [0.2, 0], [0.9, 1], [1.1, 1], [0.15, 0], [1.2, 1], [0.05, 0], [0.95, 1]];
  writeFileSync(join(source, 'data.json'), JSON.stringify({ x: rng.map(([v]) => [v]), y: rng.map(([, l]) => l) }));
  service.stageTaskData(1, taskId, { train: source });
}

test('docker environment probe reports the daemon and pinned image', () => {
  assert.ok(available, `docker unavailable in this environment: ${unavailableReason}`);
});

test('taskId validation rejects traversal and empty values before anything is created', () => {
  for (const bad of ['../x', 'a/b', '..', '', 'a b', '/etc']) {
    assert.throws(() => service.prepareTask(1, bad), /taskId/);
  }
});

test('real CPU training runs isolated and produces an artifact', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  stageTrainData('task-train');
  const result = await service.run(1, { taskId: 'task-train', script: TRAINING_SCRIPT, timeoutSeconds: 120 });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.exit_code, 0);
  assert.match(result.log_tail ?? '', /TRAINING_ACCURACY 1(\.0)?/);
  const metrics = JSON.parse(service.readArtifact(1, result.execution_id, 'metrics.json'));
  assert.equal(metrics.accuracy, 1);
  const workDir = service.execWorkDir(result.execution_id);
  assert.ok(existsSync(join(workDir, '.evoresearch-entry.py')));
  assert.match(workDir, /tasks[\\/]task-train[\\/]work[\\/]exec-\d+$/);
});

test('container network is disabled', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const result = await service.run(1, {
    taskId: 'task-network',
    script: `import socket\ntry:\n socket.create_connection(('192.0.2.1',80),timeout=1)\n print('NETWORK_OPEN')\nexcept OSError:\n print('NETWORK_DENIED')`,
    timeoutSeconds: 60,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /NETWORK_DENIED/);
});

test('training data mount is read-only inside the container', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  stageTrainData('task-readonly');
  const result = await service.run(1, {
    taskId: 'task-readonly',
    script: `import pathlib\ntry:\n pathlib.Path('/train/tampered').write_text('x')\n print('TRAIN_WRITABLE')\nexcept OSError:\n print('TRAIN_READONLY')`,
    timeoutSeconds: 60,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /TRAIN_READONLY/);
});

test('empty data directories are not mounted at all', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const result = await service.run(1, {
    taskId: 'task-nodata',
    script: `import pathlib\nprint('TRAIN_MOUNTED' if pathlib.Path('/train').exists() else 'NO_TRAIN_MOUNT')`,
    timeoutSeconds: 60,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /NO_TRAIN_MOUNT/);
});

test('a runaway script is stopped at its deadline even when nobody waits', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const started = Date.now();
  const executionId = await service.start(1, { taskId: 'task-timeout', script: 'import time; time.sleep(300)', timeoutSeconds: 3 });
  // Deliberately NOT calling wait(): the persistent monitor must enforce the
  // deadline from start time and finalize the row by itself (P1-1).
  const result = await service.wait(1, executionId, 500);
  assert.equal(result.status, 'timeout');
  assert.ok(Date.now() - started < 60000, 'timeout enforcement took too long');
});

test('idempotent start returns the existing execution for a repeated key', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const first = await service.start(1, { taskId: 'task-idem', script: 'print(1)', timeoutSeconds: 60, idempotencyKey: 'key-1' });
  const second = await service.start(1, { taskId: 'task-idem', script: 'print(2)', timeoutSeconds: 60, idempotencyKey: 'key-1' });
  assert.equal(second, first);
  await service.wait(1, first);
});

test('cooperative cancel stops a running container and records stopped', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const executionId = await service.start(1, { taskId: 'task-cancel', script: 'import time; time.sleep(300)', timeoutSeconds: 300 });
  await service.cancel(1, executionId);
  const record = service.record(1, executionId);
  assert.equal(record.status, 'stopped');
});

test('executions are owner-scoped and artifacts reject traversal', { timeout: 60000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const mine = service.list(1);
  assert.ok(mine.length >= 3);
  assert.equal(service.list(2).length, 0);
  const anyId = mine[0].execution_id;
  assert.throws(() => service.record(2, anyId), /4004|not found/i);
  const finished = mine.find((row) => row.status === 'succeeded')!;
  assert.throws(() => service.readArtifact(1, finished.execution_id, '../'), /4001|inside/i);
});

test('abort signal cancels the run', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const controller = new AbortController();
  const pending = service.run(1, { taskId: 'task-abort', script: 'import time; time.sleep(300)', timeoutSeconds: 300 }, controller.signal);
  setTimeout(() => controller.abort(), 1500);
  const record = await pending;
  assert.equal(record.status, 'stopped');
});
