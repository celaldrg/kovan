import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReplay } from './replay.mjs';

test('replay files are private, secrets are redacted, and retention deletes old lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-replay-'));
  const secret = ['sk', 'ant', 'api03-syntheticfixturekey0000'].join('-');
  const now = Date.parse('2026-04-10T00:00:00Z');
  const replay = createReplay({ dir, retentionDays: 2, now: () => now });
  const saved = replay.append({
    sessionId: 'ses_harbor', cli: 'codex', project: 'harbor-docs', status: 'working', kind: 'prompt',
    text: `dock note ${secret}`, at: now - 1000,
  });
  assert.equal(saved.text.includes(secret), false);
  assert.match(saved.text, /\[redacted\]/);
  const file = path.join(dir, 'ses_harbor.jsonl');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  replay.append({ sessionId: 'ses_harbor', cli: 'codex', project: 'harbor-docs', status: 'idle', kind: 'tool', tool: 'shell', text: 'old', at: now - 5 * 86400e3 });
  const dropped = replay.purge();
  assert.equal(dropped, 1);
  assert.equal(replay.timeline('ses_harbor').length, 1);
  assert.equal(replay.search({ q: 'dock', cli: 'codex', project: 'harbor-docs' }).length, 1);
  assert.equal(replay.search({ q: secret }).length, 0);
  const off = createReplay({ dir: path.join(dir, 'off'), enabled: false });
  assert.equal(off.append({ sessionId: 'x', text: 'nope' }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
