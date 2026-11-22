import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { createRules } from './rules.mjs';
import { createAudit } from './audit.mjs';

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

test('rules dry-run and audit reads require the launch token and do not write a decision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-policy-'));
  const rules = createRules({ file: path.join(root, 'rules.json') });
  rules.mutate({ op: 'add', rule: { id: 'deny-rm', action: 'deny', priority: 20, match: { command: 'rm -rf *' } } });
  const audit = createAudit({ file: path.join(root, 'audit.jsonl'), headFile: path.join(root, 'audit.head') });
  const hive = {
    jobs: () => [], routines: () => [], chatsFor: () => [], runs: () => [],
    addJob: async () => ({}), scheduleRoutine: () => ({}), approve: async () => ({}), reject: async () => ({}),
    cancel: () => ({}), routineAction: () => ({}), chat: async () => ({}), flush() {},
  };
  const live = {
    snapshot: () => ({ sessions: [], queue: [], zones: [], source: 'none', hooked: false }),
    handleHook: async () => ({}),
    answer: () => false,
  };
  const server = createApp({
    cfg: { name: 'Kovan', port: 1, model: 'sonnet', mode: 'live', vaultDir: root, models: ['sonnet'], swarm: { enabled: true } },
    crew: { depts: [], workers: [] },
    vault: { size: () => 0, scan() {}, graph: () => ({ nodes: [], links: [] }), note: () => null },
    ai: { backend: 'demo' }, hive, live, token, rules, audit,
    allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const headers = { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'x-kovan-token': token };
  const open = await request({ port, path: '/api/rules', headers: { host: `127.0.0.1:${port}` } });
  assert.equal(open.status, 401);
  const listed = await request({ port, path: '/api/rules', headers });
  assert.equal(listed.status, 200);
  assert.match(listed.body, /deny-rm/);
  const dry = await request({
    port, method: 'POST', path: '/api/rules/test', headers,
    body: JSON.stringify({ event: { cli: 'claude', tool: 'Bash', command: 'rm -rf build', costSoFar: 0 } }),
  });
  assert.equal(dry.status, 200);
  const decision = JSON.parse(dry.body);
  assert.equal(decision.action, 'deny');
  assert.equal(decision.ruleId, 'deny-rm');
  assert.equal(decision.failed, false);
  assert.equal(fs.existsSync(path.join(root, 'audit.jsonl')), false);
  const checked = await request({ port, path: '/api/audit/verify', headers });
  assert.equal(JSON.parse(checked.body).ok, true);
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
