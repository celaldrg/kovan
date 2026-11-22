import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forwardHook, hookEndpoint, resolveHook, timeoutFor, GEMINI_FORWARD_TIMEOUT_MS, GEMINI_HOOK_TIMEOUT_MS, GEMINI_SERVER_WAIT_MS } from './hook-client.mjs';
import { GEMINI_DENY_REASON } from '../shared/agents.js';

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

function denyResult(result) {
  const body = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 2);
  assert.equal(body.decision, 'deny');
  assert.equal(body.reason, GEMINI_DENY_REASON);
  assert.match(result.stderr, /Nothing was allowed/);
  assert.equal(body.decision === 'allow', false);
}

test('Gemini BeforeTool fails closed on every path that is not an explicit decision', async () => {
  assert.ok(GEMINI_HOOK_TIMEOUT_MS > GEMINI_FORWARD_TIMEOUT_MS);
  assert.ok(GEMINI_FORWARD_TIMEOUT_MS > GEMINI_SERVER_WAIT_MS);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-gemini-hook-'));
  const file = path.join(dir, 'token');
  fs.writeFileSync(file, `${'ab'.repeat(32)}\n`);
  const payload = JSON.stringify({
    hook_event_name: 'BeforeTool',
    session_id: 'gem_atlas',
    tool_name: 'run_shell_command',
    tool_input: { command: 'npm test' },
  });
  const argv = ['--cli', 'gemini', '--port', '4700', '--token-file', file];

  denyResult(await resolveHook(payload, argv, {}, {
    fetchImpl: async () => { throw new Error('down'); },
  }));
  denyResult(await resolveHook(payload, argv, {}, {
    fetchImpl: async () => { throw new Error('timed out'); },
  }));
  denyResult(await resolveHook(payload, ['--cli', 'gemini', '--port', '4700'], {}, {
    fetchImpl: async () => { throw new Error('should not be called'); },
  }));
  denyResult(await resolveHook(payload, argv, {}, {
    fetchImpl: async () => ({ ok: false, text: async () => 'nope' }),
  }));
  denyResult(await resolveHook(payload, argv, {}, {
    fetchImpl: async () => ({ ok: true, text: async () => '{}' }),
  }));
  denyResult(await resolveHook(payload, argv, {}, {
    fetchImpl: async () => ({ ok: true, text: async () => 'not-json' }),
  }));

  const allowed = await resolveHook(payload, argv, {}, {
    fetchImpl: async () => ({ ok: true, text: async () => '{"decision":"allow"}' }),
  });
  assert.equal(allowed.exitCode, 0);
  assert.equal(JSON.parse(allowed.stdout).decision, 'allow');

  const denied = await resolveHook(payload, argv, {}, {
    fetchImpl: async () => ({ ok: true, text: async () => '{"decision":"deny","reason":"Denied in Kovan"}' }),
  });
  assert.equal(denied.exitCode, 0);
  assert.equal(JSON.parse(denied.stdout).decision, 'deny');

  const codex = await resolveHook(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'c', tool_name: 'Bash' }), ['--cli', 'codex', '--port', '4700', '--token-file', file], {}, {
    fetchImpl: async () => { throw new Error('down'); },
  });
  assert.equal(codex.exitCode, 0);
  assert.equal(codex.stdout, '');
  assert.equal(codex.stdout.includes('allow'), false);

  const claude = await resolveHook(JSON.stringify({ hook_event_name: 'PermissionRequest' }), ['--port', '4700'], {}, {
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.equal(claude.exitCode, 0);
  assert.equal(claude.stdout, '');
  fs.rmSync(dir, { recursive: true, force: true });
});
