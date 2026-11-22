import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRules, globMatch, pathMatch, reorderRules, validateRules } from './rules.js';

const base = { cli: 'claude', project: 'lighthouse-api', tool: 'Bash', command: 'npm test', path: '', costSoFar: 0.2 };

test('globs match literals, stars and single characters without hanging', () => {
  assert.equal(globMatch('npm test', 'npm test'), true);
  assert.equal(globMatch('npm *', 'npm test'), true);
  assert.equal(globMatch('npm *', 'yarn test'), false);
  assert.equal(globMatch('rm -rf *', 'rm -rf build'), true);
  assert.equal(globMatch('????', 'test'), true);
  assert.equal(globMatch('????', 'tests'), false);
  const started = Date.now();
  assert.equal(globMatch(`${'*'.repeat(40)}x`, 'a'.repeat(80)), false);
  assert.ok(Date.now() - started < 500);
});

test('path globs honor segments and match a suffix of a longer path', () => {
  const file = '/work/lighthouse-api/src/hive.ts';
  assert.equal(pathMatch('src/*.ts', file), true);
  assert.equal(pathMatch('src/**/*.ts', '/work/lighthouse-api/src/a/hive.ts'), true);
  assert.equal(pathMatch('src/*.ts', '/work/lighthouse-api/src/a/hive.ts'), false);
  assert.equal(pathMatch('*.ts', file), true);
  assert.equal(pathMatch('lib/**/*.ts', file), false);
  assert.equal(pathMatch('src/*.ts', String.raw`\work\lighthouse-api\src\hive.ts`), true);
});

test('the first matching priority wins, and deny beats allow inside that priority', () => {
  const rules = [
    { id: 'allow-bash', priority: 10, action: 'allow', match: { tool: 'Bash' } },
    { id: 'deny-bash', priority: 10, action: 'deny', match: { tool: 'Bash' } },
    { id: 'deny-later', priority: 0, action: 'deny', match: { command: 'npm test' } },
  ];
  const conflict = decideRules(rules, base);
  assert.equal(conflict.action, 'deny');
  assert.equal(conflict.ruleId, 'deny-bash');
  assert.equal(conflict.override, true);

  const higherAllow = decideRules([
    { id: 'allow-high', priority: 50, action: 'allow', match: { tool: 'Bash', command: 'npm test' } },
    { id: 'deny-low', priority: 10, action: 'deny', match: { tool: 'Bash' } },
  ], base);
  assert.equal(higherAllow.action, 'allow');
  assert.equal(higherAllow.ruleId, 'allow-high');
  assert.equal(decideRules([], base).action, 'ask');
  assert.equal(decideRules(rules, { ...base, tool: 'Read', command: 'README.md' }).action, 'ask');
});

test('cost, cli and a disabled rule constrain a match', () => {
  const rules = [
    { id: 'off', priority: 30, action: 'allow', enabled: false, match: { tool: 'Bash' } },
    { id: 'cost', priority: 20, action: 'deny', match: { cli: ['claude', 'codex'], costSoFar: { gte: 1 } } },
    { id: 'cheap', priority: 10, action: 'allow', match: { project: 'light*', costSoFar: { lt: 1 } } },
  ];
  assert.equal(decideRules(rules, base).ruleId, 'cheap');
  assert.equal(decideRules(rules, { ...base, costSoFar: 1.5 }).ruleId, 'cost');
  assert.equal(decideRules(rules, { ...base, costSoFar: null }).action, 'ask');
  assert.equal(decideRules(rules, { ...base, cli: 'gemini' }).ruleId, 'cheap');
});

test('validation is strict and reorder swaps priority', () => {
  const bad = validateRules({ version: 1, rules: [{ id: 'ok', priority: 1, action: 'allow', match: {} }], extra: true });
  assert.equal(bad.error, 'schema');
  const empty = validateRules({ version: 1, rules: [{ id: 'wide', priority: 1, action: 'allow', match: {} }] });
  assert.equal(empty.error, 'match');
  const parsed = validateRules({ version: 2, rules: [] });
  assert.equal(parsed.error, 'version');
  const ok = validateRules({
    version: 1,
    rules: [
      { id: 'a', priority: 1, action: 'ask', match: { tool: 'Edit' } },
      { id: 'b', priority: 5, action: 'deny', match: { command: 'rm -rf *' } },
    ],
  });
  assert.equal(ok.value.rules[1].id, 'b');
  const moved = reorderRules(ok.value.rules, 'a', 'up');
  assert.equal(moved.value.find(rule => rule.id === 'a').priority, 5);
  assert.equal(moved.value.find(rule => rule.id === 'b').priority, 1);
});
