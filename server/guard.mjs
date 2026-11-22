// Request guards for the local API: bind address, Host allowlist, Origin,
// JSON bodies, body size, and static files kept inside dist/.
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const WILDCARD = new Set(['0.0.0.0', '::', '*', '']);

// Inline style attributes carry per-zone colors. Scripts stay same-origin only.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function resolveBind(env = process.env) {
  const host = String(env.KOVAN_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  return { host, exposed: !LOOPBACK.has(host) };
}

export function allowedHostnames(env = process.env, bindHost = '127.0.0.1') {
  const names = new Set(LOOPBACK);
  const concrete = String(bindHost || '').trim().toLowerCase();
  if (concrete && !WILDCARD.has(concrete) && !LOOPBACK.has(concrete)) names.add(concrete);
  for (const part of String(env.KOVAN_HOST_ALLOW || '').split(',')) {
    const name = part.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (name && !WILDCARD.has(name)) names.add(name);
  }
  return [...names];
}

export function parseHostHeader(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || /[\s,]/.test(v)) return null;
  if (v.startsWith('[')) {
    const m = v.match(/^\[([0-9a-f:.]+)\](?::(\d+))?$/i);
    if (!m) return null;
    return { host: m[1].toLowerCase(), port: m[2] == null ? null : Number(m[2]) };
  }
  const m = v.match(/^([^:]+)(?::(\d+))?$/);
  if (!m || !m[1]) return null;
  return { host: m[1].toLowerCase(), port: m[2] == null ? null : Number(m[2]) };
}

export function hostAllowed(header, { port, names }) {
  const parsed = parseHostHeader(header);
  if (!parsed) return false;
  if (parsed.port != null && parsed.port !== Number(port)) return false;
  return names.includes(parsed.host);
}

/** Absent Origin is allowed (hooks, curl). Any other value must be this server. */
export function originAllowed(origin, { port, names }) {
  if (origin == null || origin === '') return true;
  if (typeof origin !== 'string' || origin === 'null') return false;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'http:') return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== '/' && url.pathname !== '') return false;
  const originPort = url.port ? Number(url.port) : 80;
  if (originPort !== Number(port)) return false;
  return names.includes(url.hostname.toLowerCase());
}

export function isJsonContentType(header) {
  if (typeof header !== 'string' || !header.trim()) return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

export function contentLength(req) {
  const raw = req.headers['content-length'];
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw) || !/^\d+$/.test(String(raw))) return Number.NaN;
  return Number(raw);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = contentLength(req);
    if (Number.isNaN(declared)) {
      reject(Object.assign(new Error('bad request'), { status: 400 }));
      return;
    }
    if (declared != null && declared > limit) {
      reject(Object.assign(new Error('payload too large'), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error(message), { status }));
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (d) => {
      if (settled) return;
      size += d.length;
      if (size > limit) {
        req.pause();
        fail(413, 'payload too large');
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return done({});
      try { done(JSON.parse(raw)); }
      catch { fail(400, 'bad request'); }
    });
    req.on('error', () => fail(400, 'bad request'));
    req.on('close', () => { if (!settled) fail(400, 'bad request'); });
  });
}

/** Absolute file inside `root`, or null. A sibling such as dist-evil does not pass. */
export function resolveStatic(root, pathname) {
  if (typeof pathname !== 'string' || pathname.includes('\0')) return null;
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const rootResolved = path.resolve(root);
  const stripped = path.normalize(decoded).replace(/^([/\\])+/, '');
  const file = path.resolve(rootResolved, stripped);
  if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) return null;
  const rel = path.relative(rootResolved, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}
