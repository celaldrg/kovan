import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 400 }, () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

test('the server binds loopback and requires the launch token', async () => {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-listen-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: data,
      KOVAN_DEMO: '1',
      KOVAN_AUTOPILOT: '0',
      KOVAN_PORT: String(port),
      KOVAN_DATA: data,
      KOVAN_VAULT: path.join(root, 'vault'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  const tokenFile = path.join(data, 'token');
  const started = Date.now();
  while (!fs.existsSync(tokenFile) && Date.now() - started < 5000) await new Promise(r => setTimeout(r, 40));
  assert.equal(fs.existsSync(tokenFile), true, logs.slice(-500));
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (process.platform !== 'win32') assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  assert.equal(logs.includes(token), false);

  let health = 0;
  for (let i = 0; i < 40 && health !== 200; i++) {
    health = await new Promise((resolve) => {
      const req = net.connect(port, '127.0.0.1', () => {
        req.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-kovan-token: ${token}\r\nConnection: close\r\n\r\n`);
      });
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('error', () => resolve(0));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.startsWith('HTTP/1.1 200') ? 200 : 0);
      });
    });
    if (health !== 200) await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(health, 200, logs.slice(-500));

  const denied = await new Promise((resolve) => {
    const req = net.connect(port, '127.0.0.1', () => {
      req.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  assert.match(denied, /^HTTP\/1\.1 401/);

  if (process.platform === 'linux') {
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const tcp = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1).filter(line => line.toUpperCase().includes(`:${hex}`));
    assert.ok(tcp.length > 0);
    for (const line of tcp) {
      const local = line.trim().split(/\s+/)[1].toUpperCase();
      assert.match(local, /^0100007F:/);
      assert.equal(local.startsWith('00000000:'), false);
    }
  }
  const outsides = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4').map(i => i.address);
  for (const host of outsides) assert.equal(await canConnect(host, port), false);

  child.kill('SIGTERM');
  await new Promise(r => child.on('exit', r));
  fs.rmSync(data, { recursive: true, force: true });
});
