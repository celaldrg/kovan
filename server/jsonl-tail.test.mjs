import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClaudeSessions, readCodexSessions } from './jsonl-tail.mjs';

test('reads fictional Claude and Codex logs from a directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-logs-'));
  const claude = path.join(root, 'claude', 'work-lighthouse-api');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, 'ses_lighthouse.jsonl'), [
    JSON.stringify({ type: 'user', sessionId: 'ses_lighthouse', cwd: '/work/lighthouse-api', timestamp: '2026-04-01T00:00:00.000Z', message: { role: 'user', content: 'fix the hive' } }),
    JSON.stringify({ type: 'assistant', sessionId: 'ses_lighthouse', timestamp: '2026-04-01T00:00:02.000Z', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'The hive is quiet.' }] } }),
  ].join('\n'));
  const codex = path.join(root, 'codex', '2026', '04', '01');
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(codex, 'rollout-paper.jsonl'), [
    JSON.stringify({ timestamp: '2026-04-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'codex_paper', cwd: '/work/paperkite-cli', model: 'gpt-5.1-codex' } }),
    JSON.stringify({ timestamp: '2026-04-01T00:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete' } }),
  ].join('\n'));
  const c = readClaudeSessions(path.join(root, 'claude'));
  assert.equal(c.length, 1);
  assert.equal(c[0].id, 'ses_lighthouse');
  assert.equal(c[0].state, 'idle');
  const x = readCodexSessions(path.join(root, 'codex'));
  assert.equal(x[0].id, 'codex_paper');
  assert.equal(x[0].state, 'idle');
  assert.equal(x[0].source, 'codex');
  fs.rmSync(root, { recursive: true, force: true });
});
