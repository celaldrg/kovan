import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowedHostnames, hostAllowed, originAllowed, resolveBind, resolveStatic } from './guard.mjs';
import { launchToken, tokenMatches } from './token.mjs';

test('default bind is loopback and expose is explicit', () => {
  assert.deepEqual(resolveBind({}), { host: '127.0.0.1', exposed: false });
  assert.equal(resolveBind({ KOVAN_HOST: '127.0.0.1' }).exposed, false);
  assert.equal(resolveBind({ KOVAN_HOST: '::1' }).exposed, false);
  assert.equal(resolveBind({ KOVAN_HOST: '0.0.0.0' }).exposed, true);
  const names = allowedHostnames({ KOVAN_HOST_ALLOW: 'hive.local' }, '0.0.0.0');
  assert.ok(names.includes('127.0.0.1'));
  assert.ok(names.includes('hive.local'));
  assert.equal(names.includes('0.0.0.0'), false);
  assert.ok(allowedHostnames({}, '192.0.2.10').includes('192.0.2.10'));
});

test('host and origin allowlists', () => {
  const names = ['127.0.0.1', 'localhost', '::1'];
  assert.equal(hostAllowed('127.0.0.1:4700', { port: 4700, names }), true);
  assert.equal(hostAllowed('localhost:4700', { port: 4700, names }), true);
  assert.equal(hostAllowed('[::1]:4700', { port: 4700, names }), true);
  assert.equal(hostAllowed('evil.example', { port: 4700, names }), false);
  assert.equal(hostAllowed('127.0.0.1:1', { port: 4700, names }), false);
  assert.equal(hostAllowed(undefined, { port: 4700, names }), false);
  assert.equal(originAllowed(undefined, { port: 4700, names }), true);
  assert.equal(originAllowed('', { port: 4700, names }), true);
  assert.equal(originAllowed('http://127.0.0.1:4700', { port: 4700, names }), true);
  assert.equal(originAllowed('http://localhost:4700', { port: 4700, names }), true);
  assert.equal(originAllowed('http://evil.example', { port: 4700, names }), false);
  assert.equal(originAllowed('null', { port: 4700, names }), false);
  assert.equal(originAllowed('http://127.0.0.1:9', { port: 4700, names }), false);
});

test('resolveStatic stays inside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-static-'));
  const dist = path.join(root, 'dist');
  const evil = path.join(root, 'dist-evil');
  fs.mkdirSync(dist);
  fs.mkdirSync(evil);
  fs.writeFileSync(path.join(evil, 'secret.txt'), 'nope');
  fs.writeFileSync(path.join(dist, 'index.html'), 'ok');
  assert.equal(resolveStatic(dist, '../dist-evil/secret.txt'), null);
  const nested = resolveStatic(dist, '/../dist-evil/secret.txt');
  assert.equal(nested, path.join(dist, 'dist-evil', 'secret.txt'));
  assert.equal(nested.startsWith(evil), false);
  assert.equal(resolveStatic(dist, '/index.html'), path.join(dist, 'index.html'));
  assert.equal(resolveStatic(dist, '/'), dist);
  fs.rmSync(root, { recursive: true, force: true });
});

test('launch token is 0600 and compared in constant form', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-token-'));
  const file = path.join(dir, 'token');
  const token = launchToken(file);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), token);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), token), false);
  assert.equal(tokenMatches('', token), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
