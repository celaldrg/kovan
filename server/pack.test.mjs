import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runPack() {
  const cli = process.env.npm_execpath;
  if (cli) {
    const viaNode = spawnSync(process.execPath, [cli, 'pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8' });
    if (viaNode.status === 0) return viaNode;
  }
  return spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

test('the npm package is @celaldrg/kovan and the packed files omit tests', () => {
  const result = runPack();
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'npm pack failed');
  assertPacked(parsePack(result.stdout || ''));
});

function parsePack(stdout) {
  const start = stdout.search(/[\[{]/);
  assert.ok(start >= 0, stdout);
  return JSON.parse(stdout.slice(start));
}

function assertPacked(payload) {
  const entry = Array.isArray(payload) ? payload[0] : payload;
  assert.equal(entry.name, '@celaldrg/kovan');
  const paths = (entry.files || []).map(file => file.path);
  assert.ok(paths.includes('bin/kovan.mjs'));
  assert.ok(paths.includes('server/index.mjs'));
  assert.ok(paths.includes('rules.example.json'));
  assert.equal(paths.some(file => file.includes('.test.')), false);
  assert.equal(paths.some(file => file.startsWith('web/') || file.startsWith('desktop/') || file.startsWith('.github/')), false);
}
