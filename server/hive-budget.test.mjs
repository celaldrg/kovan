import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHive } from './hive.mjs';
import { createLedger } from './ledger.mjs';

test('company mode stops a department job at the budget and records real usage below it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-hive-'));
  const ledger = createLedger({ now: () => Date.UTC(2026, 10, 22, 12), persist: false });
  ledger.setBudget({ scope: 'department', key: 'engineering', limitUsd: 0.01, period: 'month' });
  ledger.ingest({
    messageId: 'already', dept: 'engineering', model: 'claude-sonnet-4-5',
    usage: { input_tokens: 100_000, output_tokens: 0 },
  });
  let calls = 0;
  const ai = {
    backend: 'test',
    async run() {
      calls += 1;
      return { text: 'kaya', tokens: 4, usage: { input_tokens: 10, output_tokens: 2 }, demo: false };
    },
  };
  const cfg = { name: 'Kovan', model: 'sonnet', dataDir: dir, vaultDir: dir, swarm: { enabled: false }, models: ['sonnet'] };
  const crew = {
    depts: [{ id: 'engineering', name: 'Engineering', code: 'ENG', mission: 'API fixes', color: '#aaa' }],
    workers: [{ id: 'kaya', dept: 'engineering', lead: true, name: 'KAYA', role: 'Backend', does: 'API fixes', skills: [] }],
  };
  const vault = { relevant: () => [], markRead() {}, writeDeliverable: () => null, size: () => 0 };
  const hive = createHive({ cfg, crew, vault, ai, emit() {}, costs: ledger });
  const blocked = await hive.addJob({ text: 'fix the limiter', dept: 'engineering' });
  assert.equal(blocked.state, 'failed');
  assert.match(blocked.error, /department budget reached/);
  assert.equal(calls, 0);

  ledger.setBudget({ scope: 'department', key: 'engineering', limitUsd: null, period: 'month' });
  const open = await hive.addJob({ text: 'fix the limiter', dept: 'engineering' });
  const deadline = Date.now() + 2000;
  while (open.state === 'queued' || open.state === 'working') {
    if (Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.equal(open.state, 'done');
  assert.ok(calls > 0);
  assert.ok(ledger.summary().departments.some(row => row.key === 'engineering' && row.tokens > 100_000));
  fs.rmSync(dir, { recursive: true, force: true });
});
