import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPhone } from './phone.mjs';

function clocked() {
  let now = 1_700_000_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-phone-'));
  const phone = createPhone({
    file: path.join(dir, 'phone.json'),
    now: () => now,
    enabled: true,
    publicOrigin: 'https://tunnel.example',
    send: async () => { throw new Error('push down'); },
  });
  return { phone, dir, advance: ms => { now += ms; } };
}

test('pairing is single-use and expires', () => {
  const { phone, dir, advance } = clocked();
  const first = phone.startPairing();
  assert.match(first.url, /^https:\/\/tunnel\.example\/phone\.html#pair=[a-f0-9]{64}$/);
  assert.match(first.svg, /^<svg/);
  assert.equal(first.svg.includes('<script'), false);
  const device = phone.redeemPairing(first.code);
  assert.equal(device.ok, true);
  assert.match(device.deviceToken, /^[a-f0-9]{64}$/);
  assert.notEqual(device.deviceToken, first.code);
  assert.equal(phone.redeemPairing(first.code).reason, 'used');

  const second = phone.startPairing();
  advance(5 * 60 * 1000 + 1);
  assert.equal(phone.redeemPairing(second.code).reason, 'expired');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'phone.json')).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('approval tokens are single-use, scoped, and expire; revoked and unpaired devices are rejected', () => {
  const { phone, dir, advance } = clocked();
  const paired = phone.redeemPairing(phone.startPairing().code);
  const minted = phone.mintApproval('req-1');
  assert.equal(phone.mintApproval('req-1').token, minted.token);
  const ok = phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-1', token: minted.token });
  assert.equal(ok.ok, true);
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-1', token: minted.token }).reason, 'used');

  const again = phone.mintApproval('req-2');
  advance(5 * 60 * 1000 + 1);
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-2', token: again.token }).reason, 'expired');

  const scoped = phone.mintApproval('req-3');
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'other', token: scoped.token }).reason, 'scope');
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-3', token: scoped.token }).ok, true);
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-3', token: scoped.token }).reason, 'used');

  const fresh = phone.mintApproval('req-4');
  assert.equal(phone.redeemApproval({ deviceToken: 'not-a-device', requestId: 'req-4', token: fresh.token }).reason, 'unpaired');
  assert.equal(phone.redeemApproval({ deviceToken: paired.deviceToken, requestId: 'req-4', token: fresh.token }).ok, true);

  const other = phone.redeemPairing(phone.startPairing().code, 'Pocket');
  phone.revoke(other.deviceId);
  const after = phone.mintApproval('req-5');
  assert.equal(phone.redeemApproval({ deviceToken: other.deviceToken, requestId: 'req-5', token: after.token }).reason, 'revoked');
  assert.equal(phone.deviceFromToken(other.deviceToken), null);
  assert.equal(phone.listDevices().some(device => device.id === other.deviceId && device.revokedAt), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a push failure does not approve, and phone access can stay off', async () => {
  const { phone, dir } = clocked();
  const paired = phone.redeemPairing(phone.startPairing().code);
  const sub = {
    endpoint: 'https://push.example/send/abc',
    keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) },
  };
  // Keys above are the wrong length on purpose for the negative path. A valid subscribe is covered in webpush tests.
  assert.equal((await phone.setPush(paired.deviceToken, { endpoint: 'http://127.0.0.1/push', keys: { p256dh: 'aa', auth: 'bb' } })).reason, 'rejected');
  assert.equal(phone.setPush('nope', sub).reason, 'unpaired');
  let sent = 0;
  const quiet = createPhone({
    enabled: true,
    publicOrigin: 'https://tunnel.example',
    send: async () => { sent += 1; throw new Error('down'); },
  });
  const dev = quiet.redeemPairing(quiet.startPairing().code);
  const keys = (await import('./webpush.mjs')).subscriberKeys();
  assert.equal(quiet.setPush(dev.deviceToken, {
    endpoint: 'https://push.example/send/abc',
    keys: { p256dh: keys.publicKey.toString('base64url'), auth: keys.auth.toString('base64url') },
  }).ok, true);
  await quiet.pushAll({ type: 'permission', id: 'req', token: 'nope' });
  assert.equal(sent, 1);
  const off = createPhone({ enabled: false });
  assert.equal(off.startPairing(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
