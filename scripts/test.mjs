// Lists test files and passes them to `node --test` as real paths.
// Node 20.19 does not expand quoted globs, and Windows shells do not either.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tests(dir, suffix) {
  return readdirSync(path.join(root, dir))
    .filter(name => name.endsWith(suffix))
    .map(name => path.join(dir, name));
}

const files = [...tests('shared', '.test.js'), ...tests('server', '.test.mjs')].sort();
if (!files.length) {
  console.error('no test files found');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
