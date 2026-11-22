// Hash chain for the local approval audit log. The hash covers a fixed field
// list, so an edited line no longer matches the next record or the head.

import { createHash } from 'node:crypto';

export const AUDIT_ACTORS = ['rule', 'desktop', 'phone', 'timeout', 'budget', 'retention'];
export const AUDIT_DECISIONS = ['allow', 'deny', 'unanswered', 'anchor'];
export const AUDIT_FIELDS = [
  'v', 'seq', 'at', 'actor', 'decision', 'behavior', 'ruleId', 'rulesStatus',
  'cli', 'project', 'sessionId', 'tool', 'command', 'path', 'costSoFar', 'reason',
  'dropped', 'previousHead', 'retainedFrom', 'prev',
];

const FIELD_SET = new Set(AUDIT_FIELDS);
const ALLOWED = new Set([...AUDIT_FIELDS, 'hash']);

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function canonicalAudit(record) {
  const src = record && typeof record === 'object' ? record : {};
  const body = {
    v: 1,
    seq: src.seq,
    at: src.at,
    actor: src.actor,
    decision: src.decision,
    behavior: typeof src.behavior === 'string' ? src.behavior : '',
    ruleId: typeof src.ruleId === 'string' && src.ruleId ? src.ruleId : null,
    rulesStatus: typeof src.rulesStatus === 'string' ? src.rulesStatus : '',
    cli: typeof src.cli === 'string' ? src.cli : '',
    project: typeof src.project === 'string' ? src.project : '',
    sessionId: typeof src.sessionId === 'string' ? src.sessionId : '',
    tool: typeof src.tool === 'string' ? src.tool : '',
    command: typeof src.command === 'string' ? src.command : '',
    path: typeof src.path === 'string' ? src.path : '',
    costSoFar: num(src.costSoFar),
    reason: typeof src.reason === 'string' ? src.reason : '',
    dropped: num(src.dropped),
    previousHead: typeof src.previousHead === 'string' && src.previousHead ? src.previousHead : null,
    retainedFrom: num(src.retainedFrom),
    prev: typeof src.prev === 'string' ? src.prev : '',
  };
  return JSON.stringify(body);
}

export function auditHash(record) {
  return createHash('sha256').update(canonicalAudit(record)).digest('hex');
}

export function sealAudit(record) {
  const src = record && typeof record === 'object' ? record : {};
  const sealed = JSON.parse(canonicalAudit(src));
  sealed.hash = auditHash(sealed);
  return sealed;
}

function unexpectedField(record) {
  return Object.keys(record).find(key => !ALLOWED.has(key)) || '';
}

export function verifyChain(records, head) {
  const list = Array.isArray(records) ? records : [];
  let prev = '';
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const seq = row && typeof row.seq === 'number' ? row.seq : i + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, error: 'unreadable line', seq, checked: i };
    if (unexpectedField(row)) return { ok: false, error: 'unexpected field', seq, checked: i };
    if (!FIELD_SET.has('prev') || row.v !== 1) return { ok: false, error: 'hash mismatch', seq, checked: i };
    if (!AUDIT_ACTORS.includes(row.actor) || !AUDIT_DECISIONS.includes(row.decision)) {
      return { ok: false, error: 'hash mismatch', seq, checked: i };
    }
    const expect = auditHash(row);
    if (row.hash !== expect) return { ok: false, error: 'hash mismatch', seq, checked: i };
    if ((row.prev || '') !== prev) return { ok: false, error: 'chain break', seq, checked: i };
    prev = row.hash;
  }
  if (!list.length) {
    if (head) return { ok: false, error: 'head mismatch', seq: 0, checked: 0 };
    return { ok: true, error: '', seq: 0, checked: 0, head: '' };
  }
  const last = list[list.length - 1];
  if (!head || head.hash !== prev || head.seq !== last.seq || head.count !== list.length) {
    return { ok: false, error: 'head mismatch', seq: last.seq, checked: list.length };
  }
  return { ok: true, error: '', seq: last.seq, checked: list.length, head: prev };
}

export function sinceMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterAudit(records, filter = {}) {
  const list = Array.isArray(records) ? records : [];
  const q = String(filter.q || '').trim().toLowerCase();
  const actor = String(filter.actor || '').trim();
  const decision = String(filter.decision || '').trim();
  const cli = String(filter.cli || '').trim();
  const project = String(filter.project || '').trim();
  const since = sinceMs(filter.since);
  return list.filter(row => {
    if (!row || typeof row !== 'object') return false;
    if (actor && row.actor !== actor) return false;
    if (decision && row.decision !== decision) return false;
    if (cli && row.cli !== cli) return false;
    if (project && row.project !== project) return false;
    if (since != null && (!(typeof row.at === 'number') || row.at < since)) return false;
    if (!q) return true;
    const hay = `${row.tool || ''} ${row.command || ''} ${row.project || ''} ${row.reason || ''} ${row.ruleId || ''} ${row.cli || ''}`.toLowerCase();
    return hay.includes(q);
  });
}
