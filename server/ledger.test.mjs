import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLedger } from './ledger.mjs';

test('ledger prices reported usage and stops at the department and project limits', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const ledger = createLedger({ now: () => now, persist: false });
  const first = ledger.ingest({
    messageId: 'msg_1',
    sessionId: 'ses_north',
    project: 'northwind-web',
    model: 'claude-sonnet-4-5',
    at: now - 1000,
    usage: { input_tokens: 1_000_000, output_tokens: 0 },
  });
  assert.ok(Math.abs(first.usd - 3) < 1e-9);
  assert.equal(ledger.ingest({ messageId: 'msg_1', sessionId: 'ses_north', model: 'sonnet', usage: { input_tokens: 1_000_000 } }), null);

  assert.equal(ledger.ingest({ sessionId: 'ses_north', model: 'sonnet' }), null);
  const unpriced = ledger.ingest({
    messageId: 'msg_unknown',
    sessionId: 'ses_north',
    project: 'northwind-web',
    model: 'claude-made-up',
    usage: { input_tokens: 50, output_tokens: 5 },
  });
  assert.equal(unpriced.priced, false);
  assert.equal(unpriced.usd, 0);

  ledger.setBudget({ scope: 'project', key: 'northwind-web', limitUsd: 4, period: 'day' });
  assert.equal(ledger.status('project', 'northwind-web').level, 'warn');
  ledger.ingest({
    messageId: 'msg_2',
    sessionId: 'ses_north',
    project: 'northwind-web',
    dept: 'engineering',
    model: 'claude-sonnet-4-5',
    usage: { input_tokens: 1_000_000, output_tokens: 0 },
  });
  assert.equal(ledger.status('project', 'northwind-web').level, 'stop');
  const block = ledger.blockPermission({ id: 'ses_north', project: 'northwind-web' });
  assert.equal(block.level, 'stop');
  assert.match(block.message, /Nothing was allowed/);
  assert.equal(ledger.blockPermission({ id: 'ses_other', project: 'lighthouse-api' }), null);

  ledger.setBudget({ scope: 'department', key: 'engineering', limitUsd: 3, period: 'month' });
  const dept = ledger.blockDepartment('engineering');
  assert.equal(dept.level, 'stop');
  assert.match(dept.message, /department budget reached/);
  assert.equal(ledger.blockDepartment('finance'), null);
});

test('runaway flags stay on the session that repeated itself', () => {
  let now = 5_000_000;
  const ledger = createLedger({ now: () => now, persist: false });
  for (let i = 0; i < 6; i++) ledger.noteTool({ sessionId: 'ses_kite', project: 'paperkite-cli', signature: 'Bash npm test', at: now - i * 1000 });
  const view = ledger.decorate({ id: 'ses_kite', project: 'paperkite-cli' });
  assert.equal(view.runaway.kind, 'loop');
  assert.match(view.runaway.detail, /Bash npm test/);
  assert.equal(ledger.decorate({ id: 'ses_lighthouse', project: 'lighthouse-api' }).runaway, null);
  now += 10 * 60e3;
  assert.equal(ledger.decorate({ id: 'ses_kite', project: 'paperkite-cli' }).runaway, null);
});

test('demo figures are priced from explicit token counts', () => {
  const ledger = createLedger({ now: () => Date.UTC(2026, 10, 22, 15), persist: false });
  ledger.useDemo();
  const summary = ledger.summary();
  assert.equal(summary.demo, true);
  assert.equal(summary.dated, '2026-11-22');
  const north = summary.projects.find(row => row.key === 'northwind-web');
  const eng = summary.departments.find(row => row.key === 'engineering');
  assert.equal(north.level, 'warn');
  assert.ok(north.ratio >= 0.75 && north.ratio < 0.95);
  assert.equal(eng.level, 'high');
  assert.ok(eng.ratio >= 0.95 && eng.ratio < 1);
  assert.equal(summary.runaway.some(flag => flag.sessionId === 'ses_kite' && flag.kind === 'loop'), true);
  assert.equal(ledger.blockPermission({ id: 'ses_lighthouse', project: 'lighthouse-api' }), null);
});

test('budgets persist as a private file and reject bad values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-budget-'));
  const ledger = createLedger({
    file: path.join(dir, 'costs.json'),
    budgetFile: path.join(dir, 'budgets.json'),
    now: () => Date.UTC(2026, 10, 22, 8),
  });
  assert.deepEqual(ledger.setBudget({ scope: 'nope', limitUsd: 1 }), { error: 'invalid budget' });
  assert.equal(ledger.setBudget({ scope: 'project', key: 'lighthouse-api', limitUsd: 12, period: 'day' }).ok, true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'budgets.json')).mode & 0o777, 0o600);
  const again = createLedger({
    file: path.join(dir, 'costs.json'),
    budgetFile: path.join(dir, 'budgets.json'),
    now: () => Date.UTC(2026, 10, 22, 9),
  });
  assert.equal(again.status('project', 'lighthouse-api').limitUsd, 12);
  fs.rmSync(dir, { recursive: true, force: true });
});
