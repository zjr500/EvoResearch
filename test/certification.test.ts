import Database from 'better-sqlite3';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase } from '../src/infrastructure/migrations.js';
import { DockerExecution } from '../src/experiment/docker-execution.js';
import { CertificationService } from '../src/experiment/certification.js';
import { verifyDirectory } from '../src/experiment/integrity.js';

/**
 * Trusted certification base (P0-3): frozen candidates carry a content hash
 * that is re-verified before every certification; hidden test sets live in a
 * separate root that training containers never mount; tampered content is
 * refused, not evaluated.
 */

const db = new Database(':memory:');
migrateDatabase(db);
const workspace = mkdtempSync(join(tmpdir(), 'evo-cert-work-'));
const certRoot = mkdtempSync(join(tmpdir(), 'evo-cert-root-'));
const execution = new DockerExecution(db, { workspaceRoot: workspace });
const certification = new CertificationService(db, { certificationRoot: certRoot, execution });
after(async () => { await certification.dispose(); await execution.dispose(); });

let available = false;
let unavailableReason = '';
before(async () => {
  const environment = await certification.environment();
  available = environment.available;
  unavailableReason = environment.reason ?? '';
});

/** Deterministic "model": a constant predictor serialized as JSON. */
const TRAIN_SCRIPT = `
import json, pathlib
pathlib.Path('/work/model.json').write_text(json.dumps({'constant': 1}))
print('trained')
`;

/** Honest evaluation: score the frozen candidate on the hidden test set. */
const EVAL_SCRIPT = `
import json, pathlib
model = json.loads(pathlib.Path('/candidate/model.json').read_text())
rows = json.loads(pathlib.Path('/eval/labels.json').read_text())
correct = sum(1 for row in rows if row['label'] == model['constant'])
print('CERT_ACCURACY', correct / len(rows))
`;

function makeTestSetSource(): string {
  const source = mkdtempSync(join(tmpdir(), 'evo-testset-'));
  writeFileSync(join(source, 'labels.json'), JSON.stringify([{ x: 0.9, label: 1 }, { x: 1.1, label: 1 }]));
  return source;
}

async function trainCandidate(): Promise<number> {
  const result = await execution.run(1, { taskId: 'cert-task', script: TRAIN_SCRIPT, timeoutSeconds: 120 });
  assert.equal(result.status, 'succeeded');
  return result.execution_id;
}

test('frozen snapshot hash matches the copied content', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const executionId = await trainCandidate();
  const snapshotId = certification.freezeCandidate(1, { taskId: 'cert-task', executionId, files: ['model.json'] });
  const snapshot = certification.snapshot(1, snapshotId);
  assert.equal(snapshot.source_execution_id, executionId);
  assert.match(snapshot.content_hash, /^[0-9a-f]{64}$/);
  const dir = join(certRoot, 'snapshots', `snap-${snapshotId}`);
  assert.ok(verifyDirectory(dir, snapshot.content_hash), 'frozen content must verify against its recorded hash');
});

test('certification runs the frozen candidate against the hidden test set', { timeout: 300000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const snapshotId = Number(db.prepare('SELECT snapshot_id FROM candidate_snapshots ORDER BY snapshot_id').get()!.snapshot_id);
  const testSetId = certification.registerTestSet(1, 'hidden-basic', makeTestSetSource());
  const certificationId = await certification.certify(1, { snapshotId, testSetId, script: EVAL_SCRIPT, timeoutSeconds: 120 });
  const result = await certification.wait(1, certificationId);
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /CERT_ACCURACY 1(\.0)?/);
});

test('tampered candidate content is refused, never evaluated', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const snapshotId = Number(db.prepare('SELECT snapshot_id FROM candidate_snapshots ORDER BY snapshot_id').get()!.snapshot_id);
  const testSetId = Number(db.prepare('SELECT test_set_id FROM test_sets ORDER BY test_set_id').get()!.test_set_id);
  const dir = join(certRoot, 'snapshots', `snap-${snapshotId}`);
  const target = join(dir, 'model.json');
  chmodSync(target, 0o666); // Windows best-effort readonly; restore write access to tamper
  writeFileSync(target, JSON.stringify({ constant: 0 }));
  await assert.rejects(
    () => certification.certify(1, { snapshotId, testSetId, script: EVAL_SCRIPT, timeoutSeconds: 60 }),
    (error: any) => error.code === 4009 && /integrity/.test(error.message),
  );
});

test('tampered test set content is refused, never evaluated', { timeout: 120000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const testSetId = Number(db.prepare('SELECT test_set_id FROM test_sets ORDER BY test_set_id').get()!.test_set_id);
  const dir = join(certRoot, 'testsets', `ts-${testSetId}`);
  const target = join(dir, 'labels.json');
  chmodSync(target, 0o666);
  writeFileSync(target, JSON.stringify([{ x: 0.1, label: 0 }]));
  const executionId = await trainCandidate();
  const snapshotId = certification.freezeCandidate(1, { taskId: 'cert-task', executionId, files: ['model.json'] });
  await assert.rejects(
    () => certification.certify(1, { snapshotId, testSetId, script: EVAL_SCRIPT, timeoutSeconds: 60 }),
    (error: any) => error.code === 4009 && /integrity/.test(error.message),
  );
});

test('freeze refuses running or failed executions and crosses no owners', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const failed = await execution.run(1, { taskId: 'cert-task', script: 'raise SystemExit(3)', timeoutSeconds: 60 });
  assert.equal(failed.status, 'failed');
  assert.throws(() => certification.freezeCandidate(1, { taskId: 'cert-task', executionId: failed.execution_id }), /failed/);
  const runningId = await execution.start(1, { taskId: 'cert-task', script: 'import time; time.sleep(60)', timeoutSeconds: 60 });
  assert.throws(() => certification.freezeCandidate(1, { taskId: 'cert-task', executionId: runningId }), /still running/);
  await execution.cancel(1, runningId);
  const snapshotId = Number(db.prepare('SELECT snapshot_id FROM candidate_snapshots ORDER BY snapshot_id DESC LIMIT 1').get()!.snapshot_id);
  assert.throws(() => certification.snapshot(2, snapshotId), /not found/i);
});

test('training containers never see the certification mounts', { timeout: 180000 }, async (t) => {
  if (!available) { t.skip(unavailableReason); return; }
  const result = await execution.run(1, {
    taskId: 'cert-task',
    script: `import pathlib\nprint('EVAL_LEAKED' if pathlib.Path('/eval').exists() else 'NO_EVAL_MOUNT')\nprint('CANDIDATE_LEAKED' if pathlib.Path('/candidate').exists() else 'NO_CANDIDATE_MOUNT')`,
    timeoutSeconds: 120,
  });
  assert.equal(result.status, 'succeeded');
  assert.match(result.log_tail ?? '', /NO_EVAL_MOUNT/);
  assert.match(result.log_tail ?? '', /NO_CANDIDATE_MOUNT/);
});
