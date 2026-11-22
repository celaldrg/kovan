// Web Push (RFC 8291 + VAPID) with a key generated on this machine.
// There is no third-party account. A failed send never approves anything.
import crypto from 'node:crypto';
import net from 'node:net';

const CONTACT = 'https://github.com/celaldrg/kovan';

export function generateVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return {
    publicKey: Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url'),
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

export function encryptPush(userPublicKey, userAuth, payload, random = crypto.randomBytes) {
  const salt = random(16);
  const local = crypto.createECDH('prime256v1');
  local.generateKeys();
  const shared = local.computeSecret(userPublicKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), userPublicKey, local.getPublicKey()]);
  const ikm = hkdf(userAuth, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const padded = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const pub = local.getPublicKey();
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([pub.length]), pub, ciphertext]);
}

/** Test helper. Confirms a payload round-trips with the subscriber's private key. */
export function decryptPush(body, subscriberPrivate) {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(subscriberPrivate.privateKey);
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
  const ikm = hkdf(subscriberPrivate.auth, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(data), decipher.final()]);
  const marker = padded.lastIndexOf(2);
  return padded.subarray(0, marker);
}

export function subscriberKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey(), auth: crypto.randomBytes(16) };
}

function isPrivateV4(host) {
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const n = match.slice(1).map(Number);
  if (n.some(part => part > 255)) return false;
  if (n[0] === 10 || n[0] === 127 || n[0] === 0) return true;
  if (n[0] === 169 && n[1] === 254) return true;
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  return false;
}

/** ULA (fc00::/7), link-local (fe80::/10), loopback, and IPv4-mapped private addresses. */
function isPrivateV6(host) {
  const lower = host.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  return false;
}

function isPrivateHost(host) {
  const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true;
  // Only IP literals. A hostname such as fcm.googleapis.com is not a ULA address.
  if (net.isIP(name) === 4) return isPrivateV4(name);
  if (net.isIP(name) === 6) return isPrivateV6(name);
  return false;
}

export function pushEndpointAllowed(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return !isPrivateHost(url.hostname.toLowerCase());
}

export function decodeSubscription(body) {
  if (!body || typeof body !== 'object') return null;
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : null;
  if (!keys || !pushEndpointAllowed(endpoint)) return null;
  let p256dh;
  let auth;
  try {
    p256dh = Buffer.from(String(keys.p256dh || ''), 'base64url');
    auth = Buffer.from(String(keys.auth || ''), 'base64url');
  } catch { return null; }
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint, p256dh: p256dh.toString('base64url'), auth: auth.toString('base64url') };
}

function vapidJwt(endpoint, privateJwk, publicKey) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud, exp, sub: CONTACT }));
  const data = Buffer.from(`${header}.${payload}`);
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
  return { jwt: `${header}.${payload}.${b64url(sig)}`, publicKey };
}

export async function sendWebPush({ subscription, payload, vapid, fetchImpl = fetch }) {
  if (!subscription || !pushEndpointAllowed(subscription.endpoint) || !vapid?.privateJwk) return { ok: false, error: 'rejected' };
  const p256dh = Buffer.from(subscription.p256dh, 'base64url');
  const auth = Buffer.from(subscription.auth, 'base64url');
  const body = encryptPush(p256dh, auth, Buffer.from(JSON.stringify(payload)));
  const { jwt, publicKey } = vapidJwt(subscription.endpoint, vapid.privateJwk, vapid.publicKey);
  let res;
  try {
    res = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${jwt}, k=${publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '120',
      },
      body,
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  return { ok: !!(res && res.ok), status: res?.status || 0 };
}
