// Optional, auto-detected readers for Gemini CLI, OpenCode and Aider.
// A missing binary, database or history file is a quiet skip.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGeminiSession, parseOpenCodeSession, parseOpenCodePermission, parseOpenCodeService, parseAiderHistory, openCodeAuthHeader, openCodeReply } from '../shared/agents.js';

function* filesUnder(dir, depth, test) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) yield* filesUnder(full, depth - 1, test);
    else if (entry.isFile() && test(entry.name, full)) yield full;
  }
}

function recent(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } catch { return ''; }
}

export function geminiTmpDir(env = process.env) {
  if (env.GEMINI_TMP_DIR) return env.GEMINI_TMP_DIR;
  const home = env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
  return path.join(home, 'tmp');
}

export function readGeminiSessions(root, { maxFiles = 20, since = 0 } = {}) {
  if (!root) return [];
  const found = [];
  for (const file of filesUnder(root, 4, name => name.endsWith('.jsonl') && (name.startsWith('session-') || name.includes('session')))) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (since && mtime < since) continue;
    found.push({ file, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const { file } of found.slice(0, maxFiles)) {
    const row = parseGeminiSession(recent(file, 128 * 1024).split('\n'));
    if (row) out.push({ ...row, cwd: row.cwd || path.dirname(file) });
  }
  return out;
}

export function openCodeDb(env = process.env) {
  if (env.OPENCODE_DB) return env.OPENCODE_DB;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

export function openCodeServiceFile(env = process.env) {
  if (env.OPENCODE_SERVICE_FILE) return env.OPENCODE_SERVICE_FILE;
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'opencode', 'service.json');
}

const SESSION_SQL = `SELECT id, directory, title, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated, time_busy, time_idle, idle_outcome FROM session_v2 ORDER BY time_updated DESC LIMIT 20`;

export function readOpenCodeSessions(file, exec = spawnSync) {
  if (!file || !fs.existsSync(file)) return [];
  let result;
  try {
    result = exec('sqlite3', ['-json', '-readonly', file, SESSION_SQL], { encoding: 'utf8' });
  } catch { return []; }
  if (!result || result.status !== 0 || !result.stdout) return [];
  let rows;
  try { rows = JSON.parse(result.stdout); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    if (typeof row.model === 'string') {
      try { row.model = JSON.parse(row.model); } catch { /* keep the string */ }
    }
    return parseOpenCodeSession(row);
  }).filter(Boolean);
}

export function aiderHistoryFiles(env = process.env) {
  const files = [];
  if (env.AIDER_CHAT_HISTORY_FILE) files.push(env.AIDER_CHAT_HISTORY_FILE);
  const roots = String(env.KOVAN_AIDER_DIRS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const root of roots) {
    for (const file of filesUnder(root, 2, name => name === '.aider.chat.history.md')) files.push(file);
  }
  return [...new Set(files)].filter(file => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  });
}

export function readAiderSessions(env = process.env) {
  const out = [];
  for (const file of aiderHistoryFiles(env)) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const row of parseAiderHistory(text, file)) out.push({ ...row, cwd: path.dirname(file) });
  }
  return out;
}

function loopback(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch { return false; }
}

export function startAgentWatch(live, { env = process.env, intervalMs = 4000, fetchImpl = globalThis.fetch, demo = false } = {}) {
  if (demo || env.KOVAN_DEMO === '1') return { stop() {} };
  let servicePassword = '';

  async function permissions(service) {
    if (!service || !loopback(service.origin)) return;
    servicePassword = service.password || '';
    let res;
    try {
      res = await fetchImpl(`${service.origin}/api/permission/request`, {
        headers: { accept: 'application/json', ...openCodeAuthHeader(service.password) },
      });
    } catch { return; }
    if (!res.ok) return;
    let body;
    try { body = await res.json(); } catch { return; }
    const list = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : (Array.isArray(body?.data) ? body.data : []));
    const ids = new Set();
    for (const raw of list) {
      const perm = parseOpenCodePermission(raw);
      if (!perm) continue;
      ids.add(perm.id);
      live.holdExternal({
        cli: 'opencode',
        requestId: perm.id,
        sessionId: perm.sessionId,
        cwd: '',
        toolName: perm.tool,
        toolInput: { command: perm.command },
        deliver(decision) {
          const reply = decision && decision.reply ? decision : openCodeReply('deny');
          if (!reply || !loopback(service.origin)) return false;
          fetchImpl(`${service.origin}/api/session/${encodeURIComponent(perm.sessionId)}/permission/${encodeURIComponent(perm.id)}/reply`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...openCodeAuthHeader(servicePassword) },
            body: JSON.stringify(reply),
          }).catch(() => {});
          return true;
        },
      });
    }
    for (const item of live.snapshot().queue) {
      if (item.cli === 'opencode' && item.externalId && !ids.has(item.externalId)) live.releaseExternal(item.externalId);
    }
  }

  const tick = () => {
    const since = Date.now() - 36 * 3600e3;
    try {
      for (const rec of readGeminiSessions(geminiTmpDir(env), { since })) live.applyLog(rec);
      for (const rec of readOpenCodeSessions(openCodeDb(env))) live.applyLog(rec);
      for (const rec of readAiderSessions(env)) live.applyLog(rec);
    } catch { /* optional */ }
    let service = null;
    try {
      if (fs.existsSync(openCodeServiceFile(env))) service = parseOpenCodeService(JSON.parse(fs.readFileSync(openCodeServiceFile(env), 'utf8')));
    } catch { service = null; }
    permissions(service).catch(() => {});
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const first = setTimeout(tick, 500);
  first.unref?.();
  return { stop() { clearInterval(timer); clearTimeout(first); } };
}
