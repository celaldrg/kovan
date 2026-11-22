import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';
import { injectLaunchToken, prepareIndexHtml } from './page-token.mjs';

const launch = 'ab'.repeat(32);
const stale = 'cd'.repeat(32);

test('a production build does not bake a launch token', () => {
  const html = '<!doctype html><html><head></head><body>ok</body></html>';
  assert.equal(prepareIndexHtml(html, { command: 'build', token: launch }), html);
  assert.equal(prepareIndexHtml(html, { command: 'build', token: launch }).includes(launch), false);
  assert.match(prepareIndexHtml(html, { command: 'serve', token: launch }), new RegExp(launch));
});

test('the server replaces a baked token with the current launch token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-page-token-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html><head><meta name="kovan-token" content="${stale}" /></head><body>ok</body></html>`);
  fs.writeFileSync(path.join(dist, 'phone.html'), '<!doctype html><html><head><meta name="kovan-phone" content="1" /><meta name="kovan-token" content="' + stale + '" /></head></html>');
  const server = createApp({
    cfg: { name: 'Kovan', port: 1, model: 'sonnet', mode: 'live', vaultDir: dist, models: ['sonnet'], swarm: {} },
    crew: { depts: [], workers: [] },
    vault: { size: () => 0, scan() {}, graph: () => ({}), note: () => null },
    ai: { backend: 'demo' },
    hive: { jobs: () => [], routines: () => [], chatsFor: () => [], runs: () => [] },
    live: { snapshot: () => ({ sessions: [], queue: [], zones: [] }), handleHook: async () => ({}), answer: () => false },
    token: launch,
    distDir: dist,
    allowedHosts: ['127.0.0.1', 'localhost', '::1'],
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const page = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
  assert.match(page, new RegExp(`name="kovan-token" content="${launch}"`));
  assert.equal(page.includes(stale), false);
  assert.equal(injectLaunchToken(`<head><meta name="kovan-token" content="${stale}"></head>`, launch).includes(stale), false);
  await new Promise(r => server.close(() => r()));
  fs.rmSync(root, { recursive: true, force: true });
});
