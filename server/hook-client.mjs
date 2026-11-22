// Sends one Claude Code hook payload to the local Kovan API.
// Failure returns an empty string: the caller exits 0 and never invents an allow.
import fs from 'node:fs';
import path from 'node:path';

export function timeoutFor(event, env = {}) {
  const fallback = event === 'PermissionRequest' ? 115000 : 8000;
  const raw = event === 'PermissionRequest' ? (env.KOVAN_PERMISSION_TIMEOUT_MS || fallback) : (env.KOVAN_HOOK_TIMEOUT_MS || fallback);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

/** Loopback /api/hooks only, so the launch token is never posted elsewhere. */
export function hookEndpoint(port, override) {
  if (override) {
    let url;
    try { url = new URL(override); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
    if (!/\/api\/hooks\/?$/.test(url.pathname)) return null;
    return url.href;
  }
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return `http://127.0.0.1:${n}/api/hooks`;
}

export function tokenFileFrom(argv, env, fallback = '') {
  if (flag(argv, '--token-file')) return flag(argv, '--token-file');
  if (env.KOVAN_TOKEN_FILE) return env.KOVAN_TOKEN_FILE;
  if (env.KOVAN_DATA) return path.join(env.KOVAN_DATA, 'token');
  return fallback;
}

export function readHookToken(file) {
  if (!file) return '';
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/i.test(text)) return '';
    return text;
  } catch { return ''; }
}

export async function forwardHook(body, argv = [], env = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const token = readHookToken(tokenFileFrom(argv, env, opts.defaultTokenFile || ''));
  if (!token) return '';
  const url = hookEndpoint(flag(argv, '--port') || env.KOVAN_PORT || '4700', env.KOVAN_HOOK_URL || '');
  if (!url) return '';
  let event = '';
  try { event = JSON.parse(body).hook_event_name || ''; } catch { event = ''; }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kovan-token': token },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutFor(event, env)),
    });
    const text = await res.text();
    if (res.ok && text.trim().startsWith('{')) return text.trim();
  } catch { /* down, slow, or not a decision */ }
  return '';
}
