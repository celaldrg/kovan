// Tail Claude Code and Codex session logs. Used only when a session has not
// reported a hook. Demo mode never reads the real home directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reduceClaudeJsonl, reduceCodexJsonl } from '../shared/hooks.js';

function* filesUnder(dir, depth, test) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) yield* filesUnder(full, depth - 1, test);
    else if (entry.isFile() && test(entry.name)) yield full;
  }
}

function recentText(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, mtime: stat.mtimeMs, size: stat.size };
  } catch { return null; }
}

function sessionIdFromName(file) {
  const base = path.basename(file, '.jsonl');
  return /^[A-Za-z0-9_-]{6,}$/.test(base) ? base : '';
}

export function readClaudeSessions(root, { maxBytes = 96 * 1024, maxFiles = 40, since = 0 } = {}) {
  const out = [];
  if (!root) return out;
  const found = [];
  for (const file of filesUnder(root, 3, name => name.endsWith('.jsonl'))) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (since && mtime < since) continue;
    found.push({ file, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of found.slice(0, maxFiles)) {
    const chunk = recentText(file, maxBytes);
    if (!chunk) continue;
    const rec = reduceClaudeJsonl(chunk.text.split('\n'), sessionIdFromName(file));
    if (rec) out.push(rec);
  }
  return out;
}

export function readCodexSessions(root, { maxBytes = 96 * 1024, maxFiles = 20, since = 0 } = {}) {
  const out = [];
  if (!root) return out;
  const found = [];
  for (const file of filesUnder(root, 5, name => name.endsWith('.jsonl'))) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (since && mtime < since) continue;
    found.push({ file, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of found.slice(0, maxFiles)) {
    const chunk = recentText(file, maxBytes);
    if (!chunk) continue;
    const rec = reduceCodexJsonl(chunk.text.split('\n'), sessionIdFromName(file));
    if (rec) out.push(rec);
  }
  return out;
}

export function claudeProjectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

export function codexSessionsDir() {
  return process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'sessions') : path.join(os.homedir(), '.codex', 'sessions');
}

export function startLogTail(live, { demo = false, intervalMs = 4000 } = {}) {
  if (demo || process.env.KOVAN_DEMO === '1') return { stop() {} };
  const tick = () => {
    const since = Date.now() - 36 * 3600e3;
    try {
      for (const rec of readClaudeSessions(claudeProjectsDir(), { since })) live.applyLog(rec);
      for (const rec of readCodexSessions(codexSessionsDir(), { since })) live.applyLog(rec);
    } catch { /* logs are optional */ }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 400);
  return { stop() { clearInterval(timer); } };
}
