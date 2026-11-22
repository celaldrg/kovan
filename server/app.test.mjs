import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { CONTENT_SECURITY_POLICY } from './guard.mjs';

const token = 'cd'.repeat(32);

function request({ port, method = 'GET', path: reqPath = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body != null) req.end(body);
    else req.end();
  });
}

function raw(port, text) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sock = net.connect(port, '127.0.0.1', () => sock.write(text));
    let timer;
    const finish = () => { clearTimeout(timer); sock.end(); resolve(Buffer.concat(chunks).toString('utf8')); };
    sock.on('data', c => { chunks.push(c); clearTimeout(timer); timer = setTimeout(finish, 30); });
    sock.setTimeout(1000, finish);
    sock.on('error', reject);
  });
}

function jsonHeaders(port, extra = {}) {
  return { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-kovan-token': token, ...extra };
}

test('api auth, host, origin, content-type, size, and model rules', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-http-'));
  const dist = path.join(root, 'dist');
  const evil = path.join(root, 'dist-evil');
  fs.mkdirSync(dist);
  fs.mkdirSync(evil);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');
  fs.writeFileSync(path.join(dist, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(evil, 'secret.txt'), 'secret-marker');
  const seen = [];
  const hive = {
    jobs: () => [], routines: () => [], chatsFor: () => [], runs: () => [],
    addJob: async (job) => { seen.push(job); return { id: 'j1', ...job }; },
    scheduleRoutine: (rule) => { seen.push(rule); return { id: 'r1', ...rule, next: 1 }; },
    approve: async () => ({}), reject: async () => ({}), cancel: () => ({}), routineAction: () => ({}),
    chat() { throw new Error('ENOENT secret-marker/settings.json'); },
    flush() {},
  };
  const live = {
    snapshot: () => ({ sessions: [], queue: [], zones: [], source: 'none', hooked: false }),
    handleHook: async (body) => { seen.push(body); return {}; },
    answer: (id, behavior) => id === 'p1' && behavior === 'allow',
  };
  const cfg = { name: 'Kovan', port: 1, model: 'sonnet', mode: 'live', vaultDir: dist, models: ['sonnet', 'opus', 'haiku'], swarm: { enabled: true } };
  const crew = { depts: [{ id: 'engineering', code: 'ENG' }], workers: [] };
  const vault = { size: () => 0, scan() {}, graph: () => ({ nodes: [], links: [] }), note: () => null };
  const server = createApp({
    cfg, crew, vault, ai: { backend: 'demo' }, hive, live, token, distDir: dist,
    allowedHosts: ['127.0.0.1', 'localhost', '::1'],
    limits: { json: 256, hook: 256 },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(async () => { await new Promise(r => server.close(() => r())); fs.rmSync(root, { recursive: true, force: true }); });

  const auth = (path, extra = {}) => request({ port, path, headers: { host: `127.0.0.1:${port}`, 'x-kovan-token': token, ...extra } });

  await t.test('token is required on the api, including hooks and answers', async () => {
    const open = await request({ port, path: '/api/state', headers: { host: `127.0.0.1:${port}` } });
    assert.equal(open.status, 401);
    assert.equal(JSON.parse(open.body).error, 'unauthorized');
    const wrong = await request({ port, path: '/api/health', headers: { host: `127.0.0.1:${port}`, 'x-kovan-token': 'ab'.repeat(32) } });
    assert.equal(wrong.status, 401);
    const ok = await auth('/api/health');
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).ok, true);
    const hook = await request({ port, method: 'POST', path: '/api/hooks', headers: jsonHeaders(port), body: '{}' });
    assert.equal(hook.status, 200);
    const hookDenied = await request({ port, method: 'POST', path: '/api/hooks', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(hookDenied.status, 401);
    const answer = await request({ port, method: 'POST', path: '/api/live/answer', headers: jsonHeaders(port), body: JSON.stringify({ id: 'p1', behavior: 'allow' }) });
    assert.equal(answer.status, 200);
    const answerDenied = await request({ port, method: 'POST', path: '/api/live/answer', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'p1', behavior: 'allow' }) });
    assert.equal(answerDenied.status, 401);
  });

  await t.test('host and origin are rejected', async () => {
    const evilHost = await raw(port, `GET /api/health HTTP/1.1\r\nHost: evil.example\r\nx-kovan-token: ${token}\r\nConnection: close\r\n\r\n`);
    assert.match(evilHost, /^HTTP\/1\.1 403/);
    const loop = await raw(port, `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-kovan-token: ${token}\r\nConnection: close\r\n\r\n`);
    assert.match(loop, /^HTTP\/1\.1 200/);
    const local = await raw(port, `GET /api/health HTTP/1.1\r\nHost: localhost:${port}\r\nx-kovan-token: ${token}\r\nConnection: close\r\n\r\n`);
    assert.match(local, /^HTTP\/1\.1 200/);
    const origin = await request({
      port, method: 'POST', path: '/api/jobs',
      headers: jsonHeaders(port, { origin: 'http://evil.example' }),
      body: JSON.stringify({ text: 'hello', model: 'sonnet' }),
    });
    assert.equal(origin.status, 403);
    assert.equal(origin.headers['access-control-allow-origin'], undefined);
    const own = await request({
      port, method: 'POST', path: '/api/jobs',
      headers: jsonHeaders(port, { origin: `http://127.0.0.1:${port}` }),
      body: JSON.stringify({ text: 'draft a note', model: 'sonnet' }),
    });
    assert.equal(own.status, 200);
  });

  await t.test('only json bodies are accepted', async () => {
    const plain = await request({
      port, method: 'POST', path: '/api/jobs',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'text/plain', 'x-kovan-token': token },
      body: JSON.stringify({ text: 'hello', model: 'sonnet' }),
    });
    assert.equal(plain.status, 415);
    const preflight = await request({ port, method: 'OPTIONS', path: '/api/jobs', headers: { host: `127.0.0.1:${port}`, origin: 'http://evil.example' } });
    assert.equal(preflight.status, 405);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  });

  await t.test('oversized bodies return 413 instead of hanging', async () => {
    const bulky = `{"text":"${'A'.repeat(300)}"}`;
    const hung = Promise.race([
      request({
        port, method: 'POST', path: '/api/jobs',
        headers: { ...jsonHeaders(port), 'content-length': String(Buffer.byteLength(bulky)) },
        body: bulky,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 1000)),
    ]);
    const tooBig = await hung;
    assert.equal(tooBig.status, 413);
    assert.equal(JSON.parse(tooBig.body).error, 'payload too large');
    const chunked = await Promise.race([
      new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port, path: '/api/jobs', method: 'POST',
          headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-kovan-token': token },
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.write('{"text":"');
        req.write('A'.repeat(300));
        req.end('"}');
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 1000)),
    ]);
    assert.equal(chunked.status, 413);
    const again = await auth('/api/health');
    assert.equal(again.status, 200);
  });

  await t.test('model and rule are allowlisted', async () => {
    const before = seen.length;
    const xss = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'hello', model: '<img src=x onerror=alert(1)>' }),
    });
    assert.equal(xss.status, 400);
    assert.equal(JSON.parse(xss.body).error, 'invalid model');
    const flag = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'hello', model: '--dangerously-skip-permissions' }),
    });
    assert.equal(flag.status, 400);
    const rule = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'hello', model: 'sonnet', rule: { kind: 'minutes', every: '<svg onload=alert(1)>' } }),
    });
    assert.equal(rule.status, 400);
    assert.equal(JSON.parse(rule.body).error, 'invalid rule');
    const effort = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'hello', model: 'sonnet', effort: 'nope' }),
    });
    assert.equal(effort.status, 400);
    const dept = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'hello', model: 'haiku', dept: 'nope' }),
    });
    assert.equal(dept.status, 400);
    assert.equal(seen.length, before);
    const job = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'review the checklist', model: 'haiku', effort: 'low', dept: 'engineering', repeat: false }),
    });
    assert.equal(job.status, 200);
    assert.equal(seen.at(-1).model, 'haiku');
    assert.equal(seen.at(-1).dept, 'engineering');
    const routine = await request({
      port, method: 'POST', path: '/api/jobs', headers: jsonHeaders(port),
      body: JSON.stringify({ text: 'check uptime', model: 'sonnet', rule: { kind: 'minutes', every: 5, hour: '<b>' } }),
    });
    assert.equal(routine.status, 200);
    assert.deepEqual(seen.at(-1).rule, { kind: 'minutes', every: 5 });
  });

  await t.test('errors and static files do not leak', async () => {
    const leaked = await request({
      port, method: 'POST', path: '/api/chat/abc', headers: jsonHeaders(port),
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(leaked.status, 500);
    assert.equal(JSON.parse(leaked.body).error, 'request failed');
    assert.equal(leaked.body.includes('secret-marker'), false);
    const page = await request({ port, path: '/', headers: { host: `127.0.0.1:${port}` } });
    assert.equal(page.status, 200);
    assert.match(page.body, new RegExp(`name="kovan-token" content="${token}"`));
    assert.equal(page.headers['content-security-policy'], CONTENT_SECURITY_POLICY);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.headers['content-security-policy'], /object-src 'none'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    const script = await request({ port, path: '/app.js', headers: { host: `127.0.0.1:${port}` } });
    assert.equal(script.status, 200);
    assert.equal(script.body.includes(token), false);
    const escaped = await request({ port, path: '/../dist-evil/secret.txt', headers: { host: `127.0.0.1:${port}` } });
    assert.equal(escaped.body.includes('secret-marker'), false);
  });
});
