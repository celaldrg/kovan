import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeHooks, removeHooks, installHooks, uninstallHooks, isKovanHook, hookUrl } from './hooks-settings.mjs';

const forwarder = path.join('pkg', 'bin', 'hook-forward.mjs');

test('merge keeps existing hooks and does not duplicate on a second pass', () => {
  const before = {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  };
  const once = mergeHooks(before, { port: 4700, forwarder });
  assert.equal(once.model, 'opus');
  assert.equal(once.hooks.PreToolUse[0].hooks[0].command, 'echo keep-me');
  const ours = once.hooks.PreToolUse[1].hooks[0];
  assert.equal(ours.type, 'http');
  assert.equal(ours.url, hookUrl(4700));
  assert.equal(ours.onFailure, undefined);
  assert.equal(once.hooks.PermissionRequest[0].hooks[0].timeout, 120);
  assert.equal(once.hooks.PermissionRequest[0].hooks[0].onFailure, undefined);
  assert.equal(once.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.deepEqual(once.hooks.SessionStart[0].hooks[0].args, [forwarder]);

  const twice = mergeHooks(once, { port: 4700, forwarder });
  assert.equal(twice.hooks.PreToolUse.length, 2);
  assert.equal(twice.hooks.PermissionRequest.length, 1);
  assert.equal(twice.hooks.SessionStart.length, 1);
  assert.equal(JSON.stringify(before.hooks), JSON.stringify({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] }] }));
});

test('removeHooks drops only Kovan entries', () => {
  const merged = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stay' }] }] } }, { port: 4711, forwarder });
  const back = removeHooks(merged);
  assert.equal(back.hooks.Stop.length, 1);
  assert.equal(back.hooks.Stop[0].hooks[0].command, 'echo stay');
  assert.equal(back.hooks.PermissionRequest, undefined);
  assert.equal(back.hooks.SessionStart, undefined);
  assert.equal(isKovanHook({ type: 'http', url: 'http://127.0.0.1:9/api/hooks' }), true);
  assert.equal(isKovanHook({ type: 'command', command: 'echo stay' }), false);
});

test('install writes a backup and uninstall restores the other hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-hooks-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { Notification: [{ matcher: 'idle_prompt', hooks: [{ type: 'command', command: 'echo ping' }] }] } }));
  const installed = installHooks({ file, port: 4700, forwarder });
  assert.ok(installed.backup && fs.existsSync(installed.backup));
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.theme, 'dark');
  assert.equal(onDisk.hooks.Notification[0].hooks[0].command, 'echo ping');
  assert.ok(onDisk.hooks.PermissionRequest.some(g => g.hooks.some(isKovanHook)));
  uninstallHooks({ file });
  const gone = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(gone.theme, 'dark');
  assert.equal(gone.hooks.Notification[0].hooks[0].command, 'echo ping');
  assert.equal(JSON.stringify(gone).includes('/api/hooks'), false);
  assert.equal(JSON.stringify(gone).includes('hook-forward'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('install refuses to clobber invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-hooks-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ this is not json');
  assert.throws(() => installHooks({ file, port: 4700, forwarder }), /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ this is not json');
  fs.rmSync(dir, { recursive: true, force: true });
});
