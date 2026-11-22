const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kovanRoot, serverEnv, isAppUrl, windowOpenDecision } = require('./launch.cjs');

test('the desktop shell forces loopback and can find a packaged tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-desktop-'));
  const packed = path.join(root, 'resources', 'kovan', 'server');
  fs.mkdirSync(packed, { recursive: true });
  fs.writeFileSync(path.join(packed, 'index.mjs'), '');
  assert.equal(kovanRoot({ resourcesPath: path.join(root, 'resources'), moduleDir: root }), path.join(root, 'resources', 'kovan'));
  assert.equal(kovanRoot({ moduleDir: path.join(root, 'desktop') }), root);
  const env = serverEnv({ KOVAN_HOST: '0.0.0.0', PATH: '/usr/bin' }, { port: 4701, dataDir: path.join(root, 'data') });
  assert.equal(env.KOVAN_HOST, '127.0.0.1');
  assert.equal(env.KOVAN_PORT, '4701');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.PATH, '/usr/bin');
  fs.rmSync(root, { recursive: true, force: true });
});

test('navigation stays on the loopback origin Kovan started with', () => {
  assert.equal(isAppUrl('http://127.0.0.1:4700/', 4700), true);
  assert.equal(isAppUrl('http://127.0.0.1:4700/phone.html', 4700), true);
  assert.equal(isAppUrl('http://127.0.0.1:4701/', 4700), false);
  assert.equal(isAppUrl('http://localhost:4700/', 4700), false);
  assert.equal(isAppUrl('https://127.0.0.1:4700/', 4700), false);
  assert.equal(isAppUrl('http://127.0.0.1.evil.test:4700/', 4700), false);
  assert.equal(isAppUrl('file:///tmp/index.html', 4700), false);
  assert.equal(isAppUrl('javascript:alert(1)', 4700), false);
  const page = windowOpenDecision('https://example.com/docs');
  assert.deepEqual(page, { action: 'deny', external: 'https://example.com/docs' });
  for (const blocked of ['http://127.0.0.1:4700/', 'file:///tmp/x', 'javascript:alert(1)', 'kovan://open', 'not a url']) {
    const decision = windowOpenDecision(blocked);
    assert.equal(decision.action, 'deny');
    assert.equal(decision.external, '');
  }
});
