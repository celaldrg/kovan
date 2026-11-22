// Append-only approval audit log. Each line includes the previous hash.
// Files are mode 0600. Retention starts a new chain and records the old head.
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../shared/redact.js';
import { redactPaths } from '../shared/hooks.js';
import { filterAudit, sealAudit, sinceMs, verifyChain } from '../shared/audit.js';

const PRIVATE = 0o600;
const ACTORS = new Set(['rule', 'desktop', 'phone', 'timeout', 'budget']);

function tighten(file) {
  try { fs.chmodSync(file, PRIVATE); } catch { /* Windows does not use POSIX modes. */ }
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* ignore */ }
}

function clip(value, max) {
  return redactSecrets(redactPaths(value ?? '')).slice(0, max);
}

function readRaw(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { records: [], error: '' };
    return { records: [], error: 'unreadable' };
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { records, error: 'unreadable line' };
      records.push(row);
    } catch {
      return { records, error: 'unreadable line' };
    }
  }
  return { records, error: '' };
}

function readHead(file) {
  if (!file) return null;
  try {
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!row || typeof row !== 'object') return { invalid: true };
    return row;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return { invalid: true };
  }
}

function writeHead(file, head) {
  ensureDir(file);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(head)}\n`, { mode: PRIVATE });
  tighten(tmp);
  fs.renameSync(tmp, file);
  tighten(file);
}

export function createAudit({ file, headFile, retentionDays = 90, now = () => Date.now() } = {}) {
  function read() {
    return readRaw(file);
  }

  function writeAll(records) {
    ensureDir(file);
    const body = records.length ? `${records.map(row => JSON.stringify(row)).join('\n')}\n` : '';
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body, { mode: PRIVATE });
    tighten(tmp);
    fs.renameSync(tmp, file);
    tighten(file);
    const last = records[records.length - 1];
    if (last) writeHead(headFile, { hash: last.hash, seq: last.seq, count: records.length });
    else if (headFile) {
      try { fs.rmSync(headFile); } catch { /* no head for an empty log */ }
    }
  }

  function append(event) {
    if (!file) return null;
    const src = event && typeof event === 'object' ? event : {};
    if (!ACTORS.has(src.actor)) return null;
    const decision = src.decision === 'allow' || src.decision === 'deny' || src.decision === 'unanswered' ? src.decision : '';
    if (!decision) return null;
    const current = read();
    const rows = current.records;
    const prevRow = rows.length ? rows[rows.length - 1] : null;
    const sealed = sealAudit({
      seq: prevRow && typeof prevRow.seq === 'number' ? prevRow.seq + 1 : 1,
      at: typeof src.at === 'number' ? src.at : now(),
      actor: src.actor,
      decision,
      behavior: typeof src.behavior === 'string' ? src.behavior : '',
      ruleId: typeof src.ruleId === 'string' ? src.ruleId : '',
      rulesStatus: typeof src.rulesStatus === 'string' ? src.rulesStatus : '',
      cli: clip(src.cli, 32),
      project: clip(src.project, 120),
      sessionId: String(src.sessionId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80),
      tool: clip(src.tool, 80),
      command: clip(src.command, 500),
      path: clip(src.path, 240),
      costSoFar: typeof src.costSoFar === 'number' && Number.isFinite(src.costSoFar) ? src.costSoFar : null,
      reason: clip(src.reason, 200),
      prev: prevRow && typeof prevRow.hash === 'string' ? prevRow.hash : '',
    });
    ensureDir(file);
    fs.appendFileSync(file, `${JSON.stringify(sealed)}\n`, { mode: PRIVATE });
    tighten(file);
    writeHead(headFile, { hash: sealed.hash, seq: sealed.seq, count: rows.length + 1 });
    return sealed;
  }

  function verify() {
    const current = read();
    if (current.error) return { ok: false, error: current.error, checked: current.records.length };
    const head = readHead(headFile);
    if (head && head.invalid) return { ok: false, error: 'head mismatch', checked: current.records.length };
    return verifyChain(current.records, head);
  }

  function search(filter) {
    return filterAudit(read().records, filter || {});
  }

  function exportSince(since) {
    const at = sinceMs(since);
    if (at == null) return { error: 'since' };
    return { records: filterAudit(read().records, { since: at }) };
  }

  function purge() {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days < 0) return 0;
    const current = read();
    if (current.error || !current.records.length) return 0;
    const cutoff = now() - days * 86400e3;
    const kept = days === 0 ? [] : current.records.filter(row => typeof row.at === 'number' && row.at >= cutoff && row.actor !== 'retention');
    const dropped = current.records.length - kept.length;
    if (!dropped) return 0;
    const previousHead = current.records[current.records.length - 1].hash || '';
    const anchor = sealAudit({
      seq: 1,
      at: now(),
      actor: 'retention',
      decision: 'anchor',
      reason: 'retention',
      dropped,
      previousHead,
      retainedFrom: cutoff,
      prev: '',
    });
    const next = [anchor];
    for (const row of kept) {
      const prev = next[next.length - 1];
      next.push(sealAudit({ ...row, seq: prev.seq + 1, prev: prev.hash }));
    }
    writeAll(next);
    return dropped;
  }

  return { append, verify, search, exportSince, purge, read };
}
