import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRules } from './rules.mjs';

function dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-rules-'));
}

test('a rules file that fails to parse asks and never allows', () => {
  const root = dir();
  const file = path.join(root, 'rules.json');
  fs.writeFileSync(file, '{');
  const rules = createRules({ file });
  const decision = rules.evaluate({ cli: 'claude', tool: 'Bash', command: 'npm test' });
  assert.equal(decision.failed, true);
  assert.equal(decision.action, 'ask');
  assert.equal(decision.status, 'invalid');
  fs.writeFileSync(file, '{"version":1,"rules":[{"id":"wide","priority":1,"action":"allow","match":{}}]}');
  const schema = rules.evaluate({ cli: 'claude', tool: 'Bash', command: 'rm -rf build' });
  assert.equal(schema.failed, true);
  assert.equal(schema.action, 'ask');
  const missing = createRules({ file: path.join(root, 'missing.json') });
  assert.equal(missing.evaluate({ tool: 'Bash' }).action, 'ask');
  assert.equal(missing.evaluate({ tool: 'Bash' }).failed, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('valid rules match, writes are private, and reorder persists', () => {
  const root = dir();
  const file = path.join(root, 'rules.json');
  const rules = createRules({ file });
  const added = rules.mutate({
    op: 'add',
    rule: { id: 'deny-rm', action: 'deny', priority: 10, match: { tool: 'Bash', command: 'rm -rf *' } },
  });
  assert.equal(added.ok, true);
  assert.equal(added.rules.length, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const allow = rules.mutate({
    op: 'add',
    rule: { id: 'allow-bash', action: 'allow', priority: 0, match: { tool: 'Bash' } },
  });
  assert.equal(allow.ok, true);
  const hit = rules.evaluate({ cli: 'claude', project: 'lighthouse-api', tool: 'Bash', command: 'rm -rf build', path: '', costSoFar: 0 });
  assert.equal(hit.action, 'deny');
  assert.equal(hit.ruleId, 'deny-rm');
  assert.equal(hit.failed, false);
  const ask = rules.evaluate({ cli: 'claude', tool: 'Edit', command: 'hive.ts', path: '/work/lighthouse-api/src/hive.ts', costSoFar: 0 });
  assert.equal(ask.action, 'ask');
  assert.equal(ask.ruleId, null);
  const moved = rules.mutate({ op: 'reorder', id: 'allow-bash', dir: 'up' });
  assert.equal(moved.ok, true);
  assert.equal(moved.rules.find(rule => rule.id === 'allow-bash').priority > moved.rules.find(rule => rule.id === 'deny-rm').priority, true);
  const after = rules.evaluate({ cli: 'claude', tool: 'Bash', command: 'rm -rf build', costSoFar: 0 });
  assert.equal(after.action, 'allow');
  assert.equal(after.ruleId, 'allow-bash');
  assert.equal(rules.mutate({ op: 'add', rule: { action: 'allow', match: { tool: 'bad\ntool' } } }).error, 'tool');
  fs.writeFileSync(file, 'not-json');
  assert.equal(rules.mutate({ op: 'delete', id: 'deny-rm' }).error, 'rules file is invalid');
  assert.equal(rules.mutate({ op: 'reset' }).status, 'ok');
  assert.equal(rules.evaluate({ tool: 'Bash', command: 'rm -rf build' }).action, 'ask');
  fs.rmSync(root, { recursive: true, force: true });
});
