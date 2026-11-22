import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { createPhone } from './phone.mjs';
import { createLedger } from './ledger.mjs';

const token = 'ab'.repeat(32);

function request({ port, method = 'GET', path: reqPath = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body != null) req.end(body);
    else req.end();
  });
}

test('phone routes keep host, origin, and single-use checks, and the launch token is not a device', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-phone-http-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body>desk</body></html>');
  fs.writeFileSync(path.join(dist, 'phone.html'), '<!doctype html><html><head><meta name="kovan-phone" content="1"></head><body>phone</body></html>');
  let now = 1_700_000_000_000;
  const phone = createPhone({ now: () => now, enabled: true, publicOrigin: 'https://tunnel.example', file: path.join(root, 'phone.json') });
  const ledger = createLedger({ now: () => now, persist: false });
  const live = {
    snapshot: () => ({ sessions: [], queue: [{ id: 'req-1', sessionId: 'ses_north', project: 'northwind-web', tool: 'Bash', command: 'npm test', diff: '', file: '', since: 1 }], zones: [], source: 'hooks', hooked: true }),
    handleHook: async () => ({}),
    answer: (id, behavior) => id === 'req-1' && (behavior === 'allow' || behavior === 'deny'),
  };
  const cfg = { name: 'Kovan', port: 1, model: 'sonnet', mode: 'live', vaultDir: dist, models: ['sonnet'], swarm: { enabled: false } };
  const server = createApp({
    cfg, crew: { depts: [], workers: [] }, vault: { size: () => 0, scan() {}, graph: () => ({}), note: () => null },
    ai: { backend: 'demo' }, hive: { jobs: () => [], routines: () => [], chatsFor: () => [], runs: () => [] },
    live, token, distDir: dist, phone, ledger, reach: { origin: 'https://tunnel.example', host: 'tunnel.example' },
    allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); });

  const json = (extra = {}) => ({ host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...extra });
  const off = await request({ port, method: 'POST', path: '/api/phone/pair', headers: { host: 'evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(off.status, 403);

  const started = await request({
    port, method: 'POST', path: '/api/phone/pairing',
    headers: json({ 'x-kovan-token': token }), body: '{}',
  });
  assert.equal(started.status, 200);
  const pairing = JSON.parse(started.body);
  const badOrigin = await request({
    port, method: 'POST', path: '/api/phone/pair',
    headers: json({ origin: 'https://evil.example' }),
    body: JSON.stringify({ code: pairing.code }),
  });
  assert.equal(badOrigin.status, 403);

  const paired = await request({
    port, method: 'POST', path: '/api/phone/pair',
    headers: json({ origin: 'https://tunnel.example' }),
    body: JSON.stringify({ code: pairing.code }),
  });
  assert.equal(paired.status, 200);
  const device = JSON.parse(paired.body);
  assert.equal(device.deviceToken === token, false);
  const again = await request({
    port, method: 'POST', path: '/api/phone/pair',
    headers: json({ origin: 'https://tunnel.example' }),
    body: JSON.stringify({ code: pairing.code }),
  });
  assert.equal(again.status, 401);

  const unpaired = await request({
    port, method: 'POST', path: '/api/phone/approve',
    headers: json({ origin: 'https://tunnel.example', 'x-kovan-device': token }),
    body: JSON.stringify({ requestId: 'req-1', token: 'nope', behavior: 'allow' }),
  });
  assert.equal(unpaired.status, 401);

  const pending = await request({
    port, path: '/api/phone/pending',
    headers: { host: `127.0.0.1:${port}`, 'x-kovan-device': device.deviceToken },
  });
  const queue = JSON.parse(pending.body);
  assert.equal(pending.status, 200);
  assert.equal(queue.requests[0].id, 'req-1');
  const stateWithDevice = await request({
    port, path: '/api/state',
    headers: { host: `127.0.0.1:${port}`, 'x-kovan-device': device.deviceToken },
  });
  assert.equal(stateWithDevice.status, 401);

  const allowed = await request({
    port, method: 'POST', path: '/api/phone/approve',
    headers: json({ origin: 'https://tunnel.example', 'x-kovan-device': device.deviceToken }),
    body: JSON.stringify({ requestId: 'req-1', token: queue.requests[0].token, behavior: 'allow' }),
  });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.body).behavior, 'allow');
  const replay = await request({
    port, method: 'POST', path: '/api/phone/approve',
    headers: json({ origin: 'https://tunnel.example', 'x-kovan-device': device.deviceToken }),
    body: JSON.stringify({ requestId: 'req-1', token: queue.requests[0].token, behavior: 'allow' }),
  });
  assert.equal(replay.status, 403);
  assert.equal(JSON.parse(replay.body).error, 'used');

  const minted = phone.mintApproval('req-old');
  now += 5 * 60 * 1000 + 1;
  const expired = await request({
    port, method: 'POST', path: '/api/phone/approve',
    headers: json({ origin: 'https://tunnel.example', 'x-kovan-device': device.deviceToken }),
    body: JSON.stringify({ requestId: 'req-old', token: minted.token, behavior: 'deny' }),
  });
  assert.equal(expired.status, 403);
  assert.equal(JSON.parse(expired.body).error, 'expired');

  const desk = await request({ port, path: '/', headers: { host: `127.0.0.1:${port}` } });
  assert.match(desk.body, /kovan-token/);
  const remoteDesk = await request({ port, path: '/', headers: { host: 'tunnel.example' } });
  assert.equal(remoteDesk.body.includes('kovan-token'), false);
  const phonePage = await request({ port, path: '/phone.html', headers: { host: `127.0.0.1:${port}` } });
  assert.equal(phonePage.body.includes('kovan-token'), false);
  assert.match(phonePage.body, /kovan-phone/);
});

test('phone routes are absent until phone access is turned on', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-phone-off-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');
  const server = createApp({
    cfg: { name: 'Kovan', port: 1, model: 'sonnet', mode: 'live', vaultDir: dist, models: ['sonnet'], swarm: {} },
    crew: { depts: [], workers: [] },
    vault: { size: () => 0, scan() {}, graph: () => ({}), note: () => null },
    ai: { backend: 'demo' },
    hive: { jobs: () => [], routines: () => [], chatsFor: () => [], runs: () => [] },
    live: { snapshot: () => ({ sessions: [], queue: [], zones: [] }), handleHook: async () => ({}), answer: () => false },
    token, distDir: dist, allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); });
  const res = await request({
    port, method: 'POST', path: '/api/phone/pair',
    headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-kovan-token': token },
    body: '{}',
  });
  assert.equal(res.status, 404);
});
