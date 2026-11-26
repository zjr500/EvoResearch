import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Install smoke test (P1-3): packs the plugin exactly as a release would,
 * extracts the tarball into an empty directory, verifies every runtime input
 * is present, and runs the real migration script from the packed layout.
 * This catches "works in the repo, missing in the tarball" regressions.
 */
test('npm pack ships every runtime input and migrations run from the packed layout', { timeout: 300000 }, () => {
  assert.ok(existsSync(join(repoRoot, 'dist', 'index.js')), 'run npm run build before the pack smoke test');
  const output = execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'pack'], { cwd: repoRoot, encoding: 'utf8' });
  const tarball = readdirSync(repoRoot).find((name) => name.endsWith('.tgz'));
  assert.ok(tarball, `npm pack produced no tarball: ${output}`);
  const installDir = mkdtempSync(join(tmpdir(), 'evo-install-'));
  try {
  // Read from stdin: portable across Windows bsdtar and GNU tar, without drive-letter parsing.
  execFileSync('tar', ['-xzf', '-'], { cwd: installDir, input: readFileSync(join(repoRoot, tarball)) });
  const root = join(installDir, 'package');

  // Every runtime input the plugin or DSH needs after installation.
  const required = [
    'dist/index.js',                     // cordis entry point
    'dist/experiment/agent-launch.js',
    'dist/experiment/agent-tools.js',
    'dist/runtime.js',
    'cordis.patch.yml',                  // composition incl. the experiment agent preset
    'migrations/knowledge/006_sync_consistency.sql',
    'migrations/modules/experiment/003_certification.sql',
    'scripts/migrate.mjs',
    // Runtime imports of the dialogue citation integration (P1-3 regression).
    'modules/dialogue/dist/src/tools/knowledge-tools.js',
    'modules/dialogue/dist/src/services/search-service.js',
  ];
  for (const file of required) assert.ok(existsSync(join(root, file)), `tarball is missing ${file}`);

  // 检查项目是否正确导出插件入口
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(manifest.exports?.['.']?.default, 'main export missing');
  

  // Run the real migration script from the packed layout against a throwaway
  // database. Only the two native runtime dependencies migrate.mjs needs are
  // copied into the packed layout (junctions are denied by Windows AV under
  // parallel test load); the packed code itself does the work.
  for (const pkg of ['better-sqlite3', 'sqlite-vec']) {
    cpSync(resolve(repoRoot, 'node_modules', pkg), join(root, 'node_modules', pkg), { recursive: true });
  }
  const dbPath = join(mkdtempSync(join(tmpdir(), 'evo-smoke-db-')), 'smoke.sqlite');
  const migrated = execFileSync(process.execPath, ['scripts/migrate.mjs'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, EVORESEARCH_DB_PATH: dbPath },
  });
  assert.match(migrated, /migrations ready/);
  assert.ok(existsSync(dbPath));
  // Repeat: the migration runner must be idempotent on an existing database.
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { cwd: root, env: { ...process.env, EVORESEARCH_DB_PATH: dbPath } });
  } finally {
    rmSync(join(repoRoot, tarball), { force: true }); // never leave release artifacts in the repo
  }
});
