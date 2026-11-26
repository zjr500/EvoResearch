import Database from 'better-sqlite3';
import { test, before } from 'node:test';
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

function dirs(name: string) {
  const work = join(root, name, 'work');
  const train = join(root, name, 'train');
  mkdirSync(work, { recursive: true });
  mkdirSync(train, { recursive: true });
  return { work, train };
}

/** Real CPU training: logistic regression on synthetic data, metrics artifact written to /work. */
const TRAINING_SCRIPT = `
import json, pathlib
import numpy as np
rng = np.random.default_rng(7)
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

test('docker environment probe reports the daemon and pinned image', () => {
  assert.ok(available, `docker unavailable in this environment: ${unavailableReason}`);
});

test('real CPU training runs isolated and produces an artifact', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const { work, train } = dirs('training');
  const rng = [[0.1, 0], [0.2, 0], [0.9, 1], [1.1, 1], [0.15, 0], [1.2, 1], [0.05, 0], [0.95, 1]];
  writeFileSync(join(train, 'data.json'), JSON.stringify({ x: rng.map(([v]) => [v]), y: rng.map(([, l]) => l) }));
  const result = await service.run(1, { script: TRAINING_SCRIPT, workDir: work, trainDir: train, timeoutSeconds: 120 });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.exit_code, 0);
  assert.match(result.log_tail ?? '', /TRAINING_ACCURACY 1(\.0)?/);
  const metrics = JSON.parse(readFileSync(join(work, 'metrics.json'), 'utf8'));
  assert.equal(metrics.accuracy, 1);
  assert.ok(existsSync(join(work, '.evoresearch-entry.py')));
});

test('container network is disabled', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const { work } = dirs('network');
  const result = await service.run(1, {
    script: `import socket\ntry:\n socket.create_connection(('192.0.2.1',80),timeout=1)\n print('NETWORK_OPEN')\nexcept OSError:\n print('NETWORK_DENIED')`,
    workDir: work, timeoutSeconds: 60,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /NETWORK_DENIED/);
});

test('training data mount is read-only inside the container', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const { work, train } = dirs('readonly');
  const result = await service.run(1, {
    script: `import pathlib\ntry:\n pathlib.Path('/train/tampered').write_text('x')\n print('TRAIN_WRITABLE')\nexcept OSError:\n print('TRAIN_READONLY')`,
    workDir: work, trainDir: train, timeoutSeconds: 60,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /TRAIN_READONLY/);
});

test('mounts outside the workspace root are refused before any container starts', async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  await assert.rejects(
    () => service.start(1, { script: 'print(1)', workDir: tmpdir() }),
    (error: any) => error.code === 4001 && /inside/.test(error.message),
  );
});

test('a runaway script is stopped at its timeout and recorded honestly', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const { work } = dirs('timeout');
  const started = Date.now();
  const result = await service.run(1, { script: 'import time; time.sleep(300)', workDir: work, timeoutSeconds: 3 });
  assert.equal(result.status, 'timeout');
  assert.ok(Date.now() - started < 60000, 'timeout enforcement took too long');
});

test('executions persist and list per owner', (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const mine = service.list(1);
  assert.ok(mine.length >= 3);
  assert.equal(service.list(2).length, 0);
  assert.throws(() => service.record(999999), /not found/);
});
