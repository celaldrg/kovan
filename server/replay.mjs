// Local session timeline. Files live under the gitignored data directory, mode 0600.
// Recording can be turned off. Retention drops events older than the configured window.
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../shared/redact.js';
import { redactPaths } from '../shared/hooks.js';
import { searchTimeline, retainEvents } from '../shared/replay.js';

const PRIVATE = 0o600;

function safeId(id) {
  const clean = String(id || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  return clean || 'session';
}

function tighten(file) {
  try { fs.chmodSync(file, PRIVATE); } catch { /* Windows does not use POSIX modes. */ }
}

export function redactEvent(event) {
  const src = event && typeof event === 'object' ? event : {};
  const text = redactSecrets(redactPaths(src.text || ''));
  const tool = redactSecrets(redactPaths(src.tool || ''));
  return {
    id: String(src.id || `e_${Math.random().toString(36).slice(2, 10)}`),
    at: typeof src.at === 'number' ? src.at : Date.now(),
    sessionId: safeId(src.sessionId),
    cli: String(src.cli || 'claude').slice(0, 32),
    project: redactSecrets(redactPaths(src.project || '')).slice(0, 120),
    status: String(src.status || '').slice(0, 32),
    kind: String(src.kind || 'note').slice(0, 32),
    tool: tool.slice(0, 80),
    text: text.slice(0, 2000),
  };
}

function readEvents(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') out.push(row);
    } catch { /* skip a torn line */ }
  }
  return out;
}

export function createReplay({ dir, enabled = true, retentionDays = 30, now = () => Date.now() } = {}) {
  function fileFor(sessionId) {
    return path.join(dir, `${safeId(sessionId)}.jsonl`);
  }

  function append(event) {
    if (!enabled || !dir) return null;
    const clean = redactEvent(event);
    fs.mkdirSync(dir, { recursive: true });
    try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
    const file = fileFor(clean.sessionId);
    fs.appendFileSync(file, JSON.stringify(clean) + '\n', { mode: PRIVATE });
    tighten(file);
    return clean;
  }

  function all() {
    if (!dir) return [];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const events = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      events.push(...readEvents(path.join(dir, name)));
    }
    events.sort((a, b) => (a.at || 0) - (b.at || 0));
    return events;
  }

  function purge() {
    if (!enabled || !dir) return 0;
    const keptAt = now();
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return 0; }
    let dropped = 0;
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      const kept = retainEvents(readEvents(file), keptAt, retentionDays);
      const before = readEvents(file).length;
      dropped += before - kept.length;
      if (!kept.length) {
        try { fs.rmSync(file); } catch { /* ignore */ }
        continue;
      }
      if (kept.length !== before) {
        fs.writeFileSync(file, kept.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: PRIVATE });
        tighten(file);
      }
    }
    return dropped;
  }

  function search(filter) {
    return searchTimeline(all(), filter || {});
  }

  function timeline(sessionId) {
    return readEvents(fileFor(sessionId));
  }

  return { append, search, timeline, purge, redactEvent, get enabled() { return enabled; } };
}
