import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGeminiSessions, readOpenCodeSessions, readAiderSessions, startAgentWatch } from './agents-watch.mjs';
import { createLive } from './live.mjs';

test('missing CLIs produce no sessions and do not throw', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-absent-'));
  assert.deepEqual(readGeminiSessions(path.join(root, 'missing')), []);
  assert.deepEqual(readOpenCodeSessions(path.join(root, 'no.db'), () => { throw new Error('no sqlite'); }), []);
  assert.deepEqual(readAiderSessions({ AIDER_CHAT_HISTORY_FILE: '', KOVAN_AIDER_DIRS: path.join(root, 'none') }), []);
  const live = createLive();
  const watch = startAgentWatch(live, { env: { KOVAN_DEMO: '1' } });
  watch.stop();
  assert.equal(live.snapshot().sessions.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a Gemini log and an Aider history file show up as read-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-watch-'));
  const chats = path.join(root, 'hash', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.copyFileSync(path.resolve('fixtures/agents/gemini-session.jsonl'), path.join(chats, 'session-2026-04-03-gem.jsonl'));
  const history = path.join(root, 'keel', '.aider.chat.history.md');
  fs.mkdirSync(path.dirname(history), { recursive: true });
  fs.copyFileSync(path.resolve('fixtures/agents/aider-history.md'), history);
  const gemini = readGeminiSessions(root);
  assert.equal(gemini[0].source, 'gemini');
  assert.equal(gemini[0].readOnly, true);
  const aider = readAiderSessions({ AIDER_CHAT_HISTORY_FILE: history, KOVAN_AIDER_DIRS: '' });
  assert.equal(aider[0].source, 'aider');
  assert.match(aider[0].note, /no approval hook/);
  const live = createLive();
  live.applyLog(gemini[0]);
  live.applyLog(aider[0]);
  const snap = live.snapshot();
  assert.equal(snap.sessions.length, 2);
  assert.equal(snap.sessions.every(s => s.readOnly), true);
  assert.equal(snap.queue.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an OpenCode permission is not approved unless the reply is delivered', () => {
  const live = createLive();
  let sent = null;
  const id = live.holdExternal({
    cli: 'opencode',
    requestId: 'perm_quill',
    sessionId: 'ses_quill',
    cwd: '/work/quill-editor',
    toolName: 'bash',
    toolInput: { command: 'npm test' },
    deliver(body) { sent = body; return body?.reply === 'reject' || body?.reply === 'once' || body?.reply === 'always'; },
  });
  assert.equal(live.answer(id, 'nope'), false);
  assert.equal(sent, null);
  assert.equal(live.snapshot().queue.length, 1);
  assert.equal(live.answer(id, 'deny'), true);
  assert.equal(sent.reply, 'reject');
  assert.equal(live.snapshot().queue.length, 0);
});
