import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAudit } from './audit.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-audit-'));
  return {
    root,
    file: path.join(root, 'audit.jsonl'),
    headFile: path.join(root, 'audit.head'),
  };
}

test('the audit log is private, redacts secrets, and verify detects an edit', () => {
  const { root, file, headFile } = fixture();
  const secret = ['sk', 'ant', 'api03-syntheticfixturekey0000'].join('-');
  const audit = createAudit({ file, headFile, retentionDays: 30, now: () => 1_700_000_000_000 });
  const saved = audit.append({
    actor: 'rule', decision: 'deny', behavior: 'deny', ruleId: 'deny-rm', rulesStatus: 'ok',
    cli: 'claude', project: 'lighthouse-api', sessionId: 'ses_lighthouse', tool: 'Bash',
    command: `rm -rf build ${secret}`, path: '/work/lighthouse-api/src/hive.ts', costSoFar: 1.25,
    reason: 'rule', at: 1_700_000_000_000,
  });
  assert.equal(saved.command.includes(secret), false);
  assert.match(saved.command, /\[redacted\]/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(headFile).mode & 0o777, 0o600);
  }
  audit.append({
    actor: 'desktop', decision: 'allow', behavior: 'always', cli: 'codex', project: 'harbor-docs',
    sessionId: 'codex_harbor', tool: 'Bash', command: 'git status', at: 1_700_000_100_000,
  });
  assert.equal(audit.verify().ok, true);
  assert.equal(audit.verify().checked, 2);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const edited = JSON.parse(lines[0]);
  edited.command = 'rm -rf /';
  lines[0] = JSON.stringify(edited);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const broken = audit.verify();
  assert.equal(broken.ok, false);
  assert.equal(broken.error, 'hash mismatch');
  assert.equal(audit.search({ q: secret }).length, 0);
  assert.equal(audit.exportSince('2023-11-14T00:00:00Z').records.length, 2);
  assert.equal(audit.exportSince('not-a-date').error, 'since');
  fs.rmSync(root, { recursive: true, force: true });
});

test('retention keeps a new chain that still verifies', () => {
  const { root, file, headFile } = fixture();
  const now = Date.parse('2026-04-10T00:00:00Z');
  const audit = createAudit({ file, headFile, retentionDays: 2, now: () => now });
  audit.append({ actor: 'timeout', decision: 'unanswered', cli: 'claude', project: 'northwind-web', tool: 'Edit', command: 'old', at: now - 5 * 86400e3 });
  audit.append({ actor: 'phone', decision: 'deny', behavior: 'deny', cli: 'gemini', project: 'atlas-notes', tool: 'Bash', command: 'npm test', at: now - 1000 });
  const dropped = audit.purge();
  assert.equal(dropped, 1);
  const verified = audit.verify();
  assert.equal(verified.ok, true);
  const rows = audit.read().records;
  assert.equal(rows[0].actor, 'retention');
  assert.equal(rows[0].decision, 'anchor');
  assert.equal(rows[0].dropped, 1);
  assert.equal(rows[1].actor, 'phone');
  assert.equal(rows[1].prev, rows[0].hash);
  fs.rmSync(root, { recursive: true, force: true });
});

test('kovan audit verify and export use the data directory', () => {
  const { root, file, headFile } = fixture();
  const audit = createAudit({ file, headFile, now: () => Date.parse('2026-04-02T00:00:00Z') });
  audit.append({ actor: 'budget', decision: 'deny', behavior: 'deny', cli: 'claude', project: 'paperkite-cli', tool: 'Bash', command: 'npm test', at: Date.parse('2026-04-02T00:00:00Z') });
  const bin = path.resolve('bin/kovan.mjs');
  const env = { ...process.env, KOVAN_DATA: root };
  const ok = spawnSync(process.execPath, [bin, 'audit', 'verify'], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /ok 1/);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const row = JSON.parse(lines[0]);
  row.tool = 'Edit';
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`);
  const bad = spawnSync(process.execPath, [bin, 'audit', 'verify'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /hash mismatch/);
  fs.writeFileSync(file, `${lines[0]}\n`);
  fs.writeFileSync(headFile, fs.readFileSync(headFile));
  const exported = spawnSync(process.execPath, [bin, 'audit', 'export', '--since', '2026-04-01'], { env, encoding: 'utf8' });
  assert.equal(exported.status, 0);
  assert.match(exported.stdout, /paperkite-cli/);
  const older = spawnSync(process.execPath, [bin, 'audit', 'export', '--since', '2026-05-01'], { env, encoding: 'utf8' });
  assert.equal(older.status, 0);
  assert.equal(older.stdout, '');
  fs.rmSync(root, { recursive: true, force: true });
});
