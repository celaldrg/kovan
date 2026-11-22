import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptPush, encryptPush, pushEndpointAllowed, sendWebPush, subscriberKeys } from './webpush.mjs';

test('a web push payload round-trips without a third-party account', () => {
  const keys = subscriberKeys();
  const payload = Buffer.from(JSON.stringify({ type: 'permission', id: 'req-1', token: 'abc' }));
  const body = encryptPush(keys.publicKey, keys.auth, payload);
  const back = decryptPush(body, keys);
  assert.equal(back.toString(), payload.toString());
});

test('push endpoints must be https and must not target loopback', async () => {
  assert.equal(pushEndpointAllowed('https://push.example/send/1'), true);
  assert.equal(pushEndpointAllowed('http://push.example/send/1'), false);
  assert.equal(pushEndpointAllowed('https://127.0.0.1/push'), false);
  assert.equal(pushEndpointAllowed('https://localhost/push'), false);
  assert.equal(pushEndpointAllowed('https://10.1.2.3/push'), false);
  const keys = subscriberKeys();
  let called = 0;
  const result = await sendWebPush({
    subscription: { endpoint: 'http://127.0.0.1/push', p256dh: keys.publicKey.toString('base64url'), auth: keys.auth.toString('base64url') },
    payload: { type: 'budget' },
    vapid: { publicKey: 'aa', privateJwk: {} },
    fetchImpl: async () => { called += 1; return { ok: true, status: 201 }; },
  });
  assert.equal(result.ok, false);
  assert.equal(called, 0);
});
