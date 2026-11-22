// Sends one hook payload to the local Kovan API.
// Claude Code and Codex print nothing and exit 0 when Kovan does not answer.
// That is not an allow: Claude shows its own prompt, and Codex PermissionRequest
// falls through to its normal approval flow.
// Gemini BeforeTool is different. Exit 0 with no decision, and a hook timeout,
// both let the tool run. A missing answer therefore exits 2 with an explicit deny,
// and the installed Gemini timeout is longer than this wait so Gemini does not
// kill the process first.
import fs from 'node:fs';
import path from 'node:path';
import { explicitGeminiDecision, geminiDenyBody } from '../shared/agents.js';

/** How long the forwarder waits for Kovan on a Gemini BeforeTool. */
export const GEMINI_FORWARD_TIMEOUT_MS = 120000;
/** Installed Gemini hook timeout. Must stay above the forwarder wait. Gemini's own timeout continues the tool. */
export const GEMINI_HOOK_TIMEOUT_MS = 130000;
/** Kovan holds a Gemini BeforeTool for less than the forwarder wait, then denies. */
export const GEMINI_SERVER_WAIT_MS = 110000;

export function timeoutFor(event, env = {}) {
  const fallback = event === 'BeforeTool' ? GEMINI_FORWARD_TIMEOUT_MS : (event === 'PermissionRequest' ? 115000 : 8000);
  const raw = event === 'BeforeTool' || event === 'PermissionRequest'
    ? (env.KOVAN_PERMISSION_TIMEOUT_MS || fallback)
    : (env.KOVAN_HOOK_TIMEOUT_MS || fallback);
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
    const cli = flag(argv, '--cli') || 'claude';
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kovan-token': token,
        'x-kovan-cli': cli === 'codex' || cli === 'gemini' ? cli : 'claude',
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutFor(event, env)),
    });
    const text = await res.text();
    if (res.ok && text.trim().startsWith('{')) return text.trim();
  } catch { /* down, slow, or not a decision */ }
  return '';
}

function hookCli(argv) {
  const cli = flag(argv, '--cli') || 'claude';
  return cli === 'codex' || cli === 'gemini' ? cli : 'claude';
}

/**
 * What the forwarder process should print and which status it should exit with.
 * Gemini BeforeTool with no explicit allow or deny exits 2 and writes a deny.
 */
export async function resolveHook(body, argv = [], env = {}, opts = {}) {
  let event = '';
  try { event = JSON.parse(body).hook_event_name || ''; } catch { event = ''; }
  const cli = hookCli(argv);
  let out = '';
  try { out = await forwardHook(body, argv, env, opts); } catch { out = ''; }
  if (cli === 'gemini' && event === 'BeforeTool' && !explicitGeminiDecision(out)) {
    const deny = geminiDenyBody();
    return { stdout: `${JSON.stringify(deny)}\n`, stderr: `${deny.reason}\n`, exitCode: 2 };
  }
  return { stdout: out, stderr: '', exitCode: 0 };
}
