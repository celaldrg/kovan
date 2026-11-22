// Phone pairing. The device credential is not the launch token.
// Pairing codes and approval tokens are single-use and expire after five minutes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { qrSvg } from '../shared/qr.js';
import { decodeSubscription, generateVapid, sendWebPush } from './webpush.mjs';

const TTL = 5 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sameHash(presented, expectedHex) {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  let b;
  try { b = Buffer.from(String(expectedHex || ''), 'hex'); } catch { return false; }
  if (b.length !== a.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows does not use POSIX modes. */ }
}

export function createPhone({
  file,
  now = () => Date.now(),
  enabled = false,
  publicOrigin = '',
  ttlMs = TTL,
  send = sendWebPush,
} = {}) {
  const pairings = new Map();
  const approvals = new Map();
  let state = { devices: [], vapid: null };
  if (file) {
    try { state = { devices: [], vapid: null, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
    if (!Array.isArray(state.devices)) state.devices = [];
  }

  function save() {
    if (!file) return;
    writePrivate(file, { devices: state.devices, vapid: state.vapid });
  }

  function ensureVapid() {
    if (state.vapid?.publicKey && state.vapid?.privateJwk) return state.vapid;
    state.vapid = generateVapid();
    save();
    return state.vapid;
  }

  function origin() {
    const value = String(publicOrigin || '').trim().replace(/\/$/, '');
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.username || url.password) return '';
      return url.origin;
    } catch { return ''; }
  }

  function startPairing() {
    if (!enabled) return null;
    const code = crypto.randomBytes(32).toString('hex');
    const expires = now() + ttlMs;
    pairings.set(code, { expires, used: false });
    const base = origin();
    const url = base ? `${base}/phone.html#pair=${code}` : '';
    return { code, expires, url, svg: url ? qrSvg(url) : '' };
  }

  function redeemPairing(code, name) {
    const row = pairings.get(String(code || ''));
    if (!row) return { ok: false, reason: 'rejected' };
    if (row.used) return { ok: false, reason: 'used' };
    if (row.expires <= now()) return { ok: false, reason: 'expired' };
    row.used = true;
    const deviceToken = crypto.randomBytes(32).toString('hex');
    const id = `d_${crypto.randomBytes(4).toString('hex')}`;
    const clean = typeof name === 'string' && /^[\w ._-]{1,24}$/.test(name.trim()) ? name.trim() : 'Phone';
    state.devices.push({ id, name: clean, secretHash: sha256(deviceToken), created: now(), revokedAt: 0, push: null });
    ensureVapid();
    save();
    return { ok: true, deviceId: id, deviceToken, vapidPublicKey: state.vapid.publicKey };
  }

  function findDevice(deviceToken) {
    return state.devices.find(device => sameHash(deviceToken, device.secretHash)) || null;
  }

  function deviceFromToken(deviceToken) {
    const device = findDevice(deviceToken);
    if (!device || device.revokedAt) return null;
    return { id: device.id, name: device.name };
  }

  function revoke(id) {
    const device = state.devices.find(item => item.id === id);
    if (!device) return false;
    device.revokedAt = now();
    device.push = null;
    save();
    return true;
  }

  function listDevices() {
    return state.devices.map(device => ({
      id: device.id,
      name: device.name,
      created: device.created,
      revokedAt: device.revokedAt || 0,
      push: !!device.push,
    }));
  }

  function mintApproval(requestId) {
    const id = String(requestId || '');
    if (!id) return null;
    for (const row of approvals.values()) {
      if (row.requestId === id && !row.used && row.expires > now()) return { token: row.token, expires: row.expires };
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = now() + ttlMs;
    approvals.set(token, { token, requestId: id, expires, used: false });
    return { token, expires };
  }

  function redeemApproval({ deviceToken, requestId, token }) {
    const device = findDevice(deviceToken);
    if (!device) return { ok: false, reason: 'unpaired' };
    if (device.revokedAt) return { ok: false, reason: 'revoked' };
    const row = approvals.get(String(token || ''));
    if (!row) return { ok: false, reason: 'rejected' };
    if (row.used) return { ok: false, reason: 'used' };
    if (row.expires <= now()) return { ok: false, reason: 'expired' };
    if (row.requestId !== String(requestId || '')) return { ok: false, reason: 'scope' };
    row.used = true;
    return { ok: true, deviceId: device.id };
  }

  function setPush(deviceToken, body) {
    const device = findDevice(deviceToken);
    if (!device || device.revokedAt) return { ok: false, reason: 'unpaired' };
    const sub = decodeSubscription(body);
    if (!sub) return { ok: false, reason: 'rejected' };
    device.push = sub;
    ensureVapid();
    save();
    return { ok: true };
  }

  async function pushAll(payload) {
    if (!enabled || !state.vapid) return;
    for (const device of state.devices) {
      if (device.revokedAt || !device.push) continue;
      try {
        await send({ subscription: device.push, payload, vapid: state.vapid });
      } catch { /* a failed push is not an approval */ }
    }
  }

  return {
    get enabled() { return !!enabled; },
    get origin() { return origin(); },
    startPairing,
    redeemPairing,
    deviceFromToken,
    revoke,
    listDevices,
    mintApproval,
    redeemApproval,
    setPush,
    pushAll,
    status: () => ({ enabled: !!enabled, origin: origin() }),
    vapidPublic: () => (state.vapid ? state.vapid.publicKey : ''),
  };
}
