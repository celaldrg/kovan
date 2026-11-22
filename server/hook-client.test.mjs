import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forwardHook, hookEndpoint, timeoutFor } from './hook-client.mjs';

test('hook endpoint stays on loopback', () => {
  assert.equal(hookEndpoint(4700, ''), 'http://127.0.0.1:4700/api/hooks');
  assert.equal(hookEndpoint(4700, 'http://evil.example/api/hooks'), null);
  assert.equal(hookEndpoint(4700, 'http://127.0.0.1:4700/api/hooks'), 'http://127.0.0.1:4700/api/hooks');
  assert.equal(timeoutFor('PermissionRequest', {}), 115000);
  assert.equal(timeoutFor('Stop', {}), 8000);
});

test('forwarder sends the token and does not invent an allow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-hook-'));
  const file = path.join(dir, 'token');
  const token = 'ab'.repeat(32);
  fs.writeFileSync(file, `${token}\n`);
  let seen;
  const out = await forwardHook(JSON.stringify({ hook_event_name: 'Stop' }), ['--port', '4700', '--token-file', file], {}, {
    fetchImpl: async (url, opts) => {
      seen = { url, headers: opts.headers, redirect: opts.redirect };
      return { ok: true, text: async () => '{"ok":true}' };
    },
  });
  assert.equal(out, '{"ok":true}');
  assert.equal(seen.url, 'http://127.0.0.1:4700/api/hooks');
  assert.equal(seen.headers['x-kovan-token'], token);
  assert.equal(seen.headers['content-type'], 'application/json');
  assert.equal(seen.redirect, 'error');

  let called = false;
  const refused = await forwardHook('{}', ['--port', '4700', '--token-file', file], { KOVAN_HOOK_URL: 'http://evil.example/api/hooks' }, {
    fetchImpl: async () => { called = true; return { ok: true, text: async () => '{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}' }; },
  });
  assert.equal(called, false);
  assert.equal(refused, '');

  const down = await forwardHook('{}', ['--port', '4700', '--token-file', file], {}, {
    fetchImpl: async () => { throw new Error('down'); },
  });
  assert.equal(down, '');

  const missing = await forwardHook('{}', ['--port', '4700'], {}, {
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.equal(missing, '');
  fs.rmSync(dir, { recursive: true, force: true });
});
