import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
function run(args, directory = root) {
  const result = spawnSync(process.execPath, args, { cwd: fileURLToPath(directory), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const mode = process.argv[2];
const tsc = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
run([tsc, '-p', 'modules/dialogue/tsconfig.json', ...(mode === 'check' ? ['--noEmit'] : [])]);
if (mode === 'build') run(['scripts/build-client.mjs'], new URL('modules/frontend/', root));
if (mode === 'test') {
  run(['--test', 'tests/*.test.mjs'], new URL('modules/dialogue/', root));
  run(['--test', 'checks/*.test.js'], new URL('modules/frontend/', root));
}
