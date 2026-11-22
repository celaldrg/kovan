import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeCodexHooks, mergeGeminiHooks, removeCliHooks, installOptionalHooks } from './cli-hooks.mjs';
import { GEMINI_FORWARD_TIMEOUT_MS, GEMINI_HOOK_TIMEOUT_MS, GEMINI_SERVER_WAIT_MS, timeoutFor } from './hook-client.mjs';

test('Codex and Gemini hook merges keep other hooks and do not auto-allow', () => {
  const forwarder = '/opt/kovan/bin/hook-forward.mjs';
  const codex = mergeCodexHooks({
    hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] },
  }, { port: 4700, forwarder });
  const perm = codex.hooks.PermissionRequest;
  assert.equal(perm.length, 2);
  assert.equal(perm[0].hooks[0].command, 'echo keep');
  assert.match(perm[1].hooks[0].command, /--cli codex/);
  assert.equal(perm[1].hooks[0].timeout, 120);
  assert.equal(perm[1].hooks[0].onFailure, undefined);
  const gemini = mergeGeminiHooks({ model: 'gemini-2.5-flash' }, { port: 4700, forwarder });
  assert.equal(gemini.model, 'gemini-2.5-flash');
  assert.equal(gemini.hooks.BeforeTool[0].hooks[0].timeout, GEMINI_HOOK_TIMEOUT_MS);
  assert.ok(GEMINI_HOOK_TIMEOUT_MS > timeoutFor('BeforeTool', {}));
  assert.ok(timeoutFor('BeforeTool', {}) > GEMINI_SERVER_WAIT_MS);
  assert.equal(timeoutFor('BeforeTool', {}), GEMINI_FORWARD_TIMEOUT_MS);
  assert.match(gemini.hooks.BeforeTool[0].hooks[0].command, /--cli gemini/);
  const cleared = removeCliHooks(gemini);
  assert.equal(cleared.hooks, undefined);
  assert.equal(cleared.model, 'gemini-2.5-flash');
});

test('optional install does nothing when the tool directory is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-hooks-'));
  const missing = installOptionalHooks({
    port: 4700,
    forwarder: '/opt/kovan/bin/hook-forward.mjs',
    env: { CODEX_HOME: path.join(root, 'no-codex'), GEMINI_CLI_HOME: path.join(root, 'no-gemini') },
  });
  assert.equal(missing.installed.length, 0);
  fs.mkdirSync(path.join(root, 'codex'));
  const once = installOptionalHooks({
    port: 4700,
    forwarder: '/opt/kovan/bin/hook-forward.mjs',
    env: { CODEX_HOME: path.join(root, 'codex'), GEMINI_CLI_HOME: path.join(root, 'no-gemini') },
  });
  assert.equal(once.installed.length, 1);
  const written = JSON.parse(fs.readFileSync(path.join(root, 'codex', 'hooks.json'), 'utf8'));
  assert.match(written.hooks.PermissionRequest[0].hooks[0].command, /hook-forward/);
  fs.rmSync(root, { recursive: true, force: true });
});
