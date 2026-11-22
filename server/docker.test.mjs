import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

test('the image runs as a non-root user and stays on loopback unless asked', () => {
  const text = fs.readFileSync('Dockerfile', 'utf8');
  const users = [...text.matchAll(/^USER\s+(\S+)/gm)].map(match => match[1]);
  assert.deepEqual(users, ['kovan']);
  assert.equal(text.includes('USER root'), false);
  assert.match(text, /org\.opencontainers\.image\.source=https:\/\/github\.com\/celaldrg\/kovan/);
  assert.equal(/ENV\s+KOVAN_HOST=0\.0\.0\.0/.test(text), false);
  assert.match(text, /127\.0\.0\.1:4700:4700/);
  if (process.env.KOVAN_DOCKER_TEST !== '1') return;
  const build = spawnSync('docker', ['build', '-t', 'kovan:ci', '.'], { stdio: 'inherit' });
  assert.equal(build.status, 0);
  const id = spawnSync('docker', ['run', '--rm', '--entrypoint', 'id', 'kovan:ci', '-u'], { encoding: 'utf8' });
  assert.equal(id.status, 0);
  assert.notEqual(id.stdout.trim(), '0');
  const who = spawnSync('docker', ['run', '--rm', '--entrypoint', 'whoami', 'kovan:ci'], { encoding: 'utf8' });
  assert.equal(who.status, 0);
  assert.equal(who.stdout.trim(), 'kovan');
  const inspect = spawnSync('docker', ['inspect', '--format', '{{json .Config.Env}}', 'kovan:ci'], { encoding: 'utf8' });
  assert.equal(inspect.status, 0);
  assert.equal(inspect.stdout.includes('KOVAN_HOST=0.0.0.0'), false);
});
