// Priced usage for sessions, projects, and departments.
// Only reported token buckets are stored. A missing report is not filled in.
import fs from 'node:fs';
import path from 'node:path';
import { projectName } from '../shared/hooks.js';
import { PRICE_TABLE, mergePrices } from '../shared/prices.js';
import { priceUsage, tokensOf } from '../shared/cost.js';
import { budgetLevel, periodLabel, periodStart } from '../shared/budget.js';
import { detectRunaway } from '../shared/runaway.js';

const SCOPES = ['session', 'project', 'department'];
const PERIODS = ['day', 'month', 'session'];
const RANK = { open: 0, ok: 1, warn: 2, high: 3, stop: 4 };

function emptyLimits() {
  return {
    session: { period: 'day', limitUsd: null, byKey: {} },
    project: { period: 'day', limitUsd: null, byKey: {} },
    department: { period: 'month', limitUsd: null, byKey: {} },
  };
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows does not use POSIX modes. */ }
}

export function createLedger({
  file,
  budgetFile,
  now = () => Date.now(),
  priceOverlay = null,
  aliases = null,
  warnAt = 0.75,
  highAt = 0.95,
  runaway = {},
  demo = false,
  persist = !demo,
  configured = null,
  onChange = null,
} = {}) {
  const table = mergePrices(PRICE_TABLE, priceOverlay, aliases || {});
  const entries = [];
  const events = [];
  const seen = new Set();
  let limits = configured ? normalizeLimits(configured) : emptyLimits();
  let demoMode = demo;

  if (persist && budgetFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
      limits = normalizeLimits(saved);
    } catch { /* no saved budgets yet */ }
  }
  if (persist && file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const row of saved.entries || []) remember(row, false);
    } catch { /* no ledger yet */ }
  }

  function remember(row, save) {
    if (!row || !row.buckets) return null;
    if (row.messageId && seen.has(row.messageId)) return null;
    const priced = priceUsage({
      input_tokens: row.buckets.input,
      output_tokens: row.buckets.output,
      cache_read_input_tokens: row.buckets.cacheRead,
      cache_creation: {
        ephemeral_5m_input_tokens: row.buckets.cacheWrite5m,
        ephemeral_1h_input_tokens: row.buckets.cacheWrite1h,
      },
    }, row.model, table);
    const entry = {
      messageId: row.messageId || '',
      at: row.at || now(),
      sessionId: row.sessionId || '',
      project: row.project || '',
      dept: row.dept || '',
      model: row.model || '',
      buckets: priced.buckets,
      usd: priced.ok ? priced.usd : 0,
      priced: priced.ok,
      tokens: tokensOf(priced.buckets),
      source: row.source || 'reported',
    };
    if (entry.messageId) seen.add(entry.messageId);
    entries.push(entry);
    if (entries.length > 20000) {
      const dropped = entries.shift();
      if (dropped?.messageId) seen.delete(dropped.messageId);
    }
    if (entry.priced && entry.usd > 0) {
      events.push({ sessionId: entry.sessionId, project: entry.project, signature: '', at: entry.at, usd: entry.usd });
    }
    if (save && persist && file) writePrivate(file, { entries: entries.map(publicEntry) });
    if (save) onChange?.();
    return entry;
  }

  function ingest(input) {
    if (!input || !input.usage) return null;
    if ((input.source === 'hook' || input.source === 'jsonl') && !input.messageId) return null;
    const priced = priceUsage(input.usage, input.model, table);
    if (!priced.buckets) return null;
    const messageId = input.messageId || '';
    if (messageId && seen.has(messageId)) return null;
    return remember({
      messageId,
      at: input.at || now(),
      sessionId: input.sessionId || '',
      project: input.project || (input.cwd ? projectName(input.cwd) : ''),
      dept: input.dept || '',
      model: input.model || '',
      buckets: priced.buckets,
      source: input.source || 'reported',
    }, true);
  }

  function noteTool(info) {
    if (!info || !info.sessionId || !info.signature) return;
    events.push({
      sessionId: info.sessionId,
      project: info.project || '',
      signature: String(info.signature).slice(0, 180),
      at: info.at || now(),
      usd: typeof info.usd === 'number' ? info.usd : 0,
    });
    const cutoff = now() - 10 * 60e3;
    while (events.length && events[0].at < cutoff) events.shift();
    if (events.length > 2000) events.splice(0, events.length - 2000);
  }

  function spend(scope, key, period) {
    const start = periodStart(period, now());
    let usd = 0;
    let tokens = 0;
    let unpriced = 0;
    for (const entry of entries) {
      if (entry.at < start) continue;
      if (scope === 'session' && entry.sessionId !== key) continue;
      if (scope === 'project' && entry.project !== key) continue;
      if (scope === 'department' && entry.dept !== key) continue;
      tokens += entry.tokens;
      if (entry.priced) usd += entry.usd;
      else unpriced += entry.tokens;
    }
    return { usd, tokens, unpriced };
  }

  function limitFor(scope, key) {
    const spec = limits[scope] || { period: 'day', limitUsd: null, byKey: {} };
    const specific = key && Object.prototype.hasOwnProperty.call(spec.byKey || {}, key) ? spec.byKey[key] : undefined;
    return { period: spec.period || 'day', limitUsd: specific !== undefined ? specific : spec.limitUsd };
  }

  function status(scope, key) {
    const lim = limitFor(scope, key);
    const period = lim.period === 'session' ? 'session' : lim.period;
    const spent = spend(scope, key, period);
    const level = budgetLevel(spent.usd, lim.limitUsd, { warnAt, highAt });
    return { scope, key, period, ...level, tokens: spent.tokens, unpriced: spent.unpriced };
  }

  function worst(list) {
    return list.reduce((best, item) => ((RANK[item.level] || 0) > (RANK[best.level] || 0) ? item : best), list[0]);
  }

  function stopOf(list) {
    const hit = list.find(item => item.level === 'stop');
    if (!hit) return null;
    const pct = Math.round((hit.ratio || 0) * 100);
    const who = hit.key || hit.scope;
    return {
      level: 'stop',
      scope: hit.scope,
      key: hit.key,
      message: `Budget reached for ${who} (${pct}% of $${hit.limitUsd.toFixed(2)} ${periodLabel(hit.period)}). Kovan denied further work. Nothing was allowed.`,
    };
  }

  function blockPermission(session) {
    if (!session) return null;
    return stopOf([status('session', session.id), status('project', session.project)]);
  }

  function blockDepartment(dept) {
    if (!dept) return null;
    const hit = stopOf([status('department', dept)]);
    if (!hit) return null;
    return { ...hit, message: `Stopped: department budget reached for ${dept}.` };
  }

  function decorate(session) {
    const spendDay = spend('session', session.id, 'day');
    const checks = [status('session', session.id), status('project', session.project)];
    const top = worst(checks);
    const flags = detectRunaway(events.filter(event => event.sessionId === session.id), now(), runaway);
    return {
      cost: { usd: spendDay.usd, tokens: spendDay.tokens, unpriced: spendDay.unpriced },
      budget: top && top.level !== 'open' ? { level: top.level, ratio: top.ratio, scope: top.scope, limitUsd: top.limitUsd, period: top.period } : null,
      runaway: flags[0] ? { kind: flags[0].kind, detail: flags[0].detail } : null,
      budgetBlock: checks.some(item => item.level === 'stop'),
    };
  }

  function setBudget(input) {
    const scope = input?.scope;
    const key = String(input?.key || '');
    const period = input?.period;
    if (!SCOPES.includes(scope)) return { error: 'invalid budget' };
    if (period && !PERIODS.includes(period)) return { error: 'invalid budget' };
    if (key && !/^[\w ._-]{1,80}$/.test(key)) return { error: 'invalid budget' };
    const limitUsd = input.limitUsd == null || input.limitUsd === '' ? null : Number(input.limitUsd);
    if (limitUsd != null && !(Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd <= 1e9)) return { error: 'invalid budget' };
    const spec = limits[scope];
    if (period) spec.period = period;
    if (!key) spec.limitUsd = limitUsd;
    else if (limitUsd == null) delete spec.byKey[key];
    else spec.byKey[key] = limitUsd;
    if (persist && budgetFile) writePrivate(budgetFile, limits);
    onChange?.();
    return { ok: true };
  }

  function summary() {
    const start = periodStart('day', now());
    let dayUsd = 0;
    let dayTokens = 0;
    const projects = new Set();
    const sessions = new Set();
    const depts = new Set();
    for (const entry of entries) {
      if (entry.project) projects.add(entry.project);
      if (entry.sessionId) sessions.add(entry.sessionId);
      if (entry.dept) depts.add(entry.dept);
      if (entry.at >= start && entry.priced) { dayUsd += entry.usd; dayTokens += entry.tokens; }
    }
    const alerts = [];
    const pushAlert = (st) => {
      if (!st || st.level === 'open' || st.level === 'ok') return;
      alerts.push({
        level: st.level, scope: st.scope, key: st.key, ratio: st.ratio, limitUsd: st.limitUsd,
        spentUsd: st.spentUsd, period: st.period,
      });
    };
    for (const id of sessions) pushAlert(status('session', id));
    for (const name of projects) pushAlert(status('project', name));
    for (const id of depts) pushAlert(status('department', id));
    for (const spec of SCOPES) {
      if (limits[spec].limitUsd) pushAlert(status(spec, ''));
    }
    const flags = [];
    for (const id of sessions) {
      const found = detectRunaway(events.filter(event => event.sessionId === id), now(), runaway);
      if (found[0]) flags.push({ sessionId: id, kind: found[0].kind, detail: found[0].detail });
    }
    const rows = (scope, keys) => [...keys].slice(0, 40).map(key => {
      const st = status(scope, key);
      return { key, usd: st.spentUsd, tokens: st.tokens, level: st.level, ratio: st.ratio, limitUsd: st.limitUsd, period: st.period };
    });
    return {
      demo: demoMode,
      dated: table.dated,
      source: table.source,
      currency: 'USD',
      dayUsd,
      dayTokens,
      alerts,
      runaway: flags,
      sessions: rows('session', sessions),
      projects: rows('project', projects),
      departments: rows('department', depts),
    };
  }

  function useDemo(at = now()) {
    demoMode = true;
    entries.length = 0;
    events.length = 0;
    seen.clear();
    limits = emptyLimits();
    limits.project.byKey = { 'lighthouse-api': 12, 'northwind-web': 3.8, 'paperkite-cli': 8 };
    limits.department.byKey = { engineering: 12.5, finance: 30 };
    const samples = [
      { messageId: 'demo-light', sessionId: 'ses_lighthouse', project: 'lighthouse-api', model: 'claude-sonnet-4-5', usage: { input_tokens: 500_000, output_tokens: 80_000, cache_read_input_tokens: 200_000 } },
      { messageId: 'demo-north', sessionId: 'ses_north', project: 'northwind-web', model: 'claude-opus-4-5', usage: { input_tokens: 400_000, output_tokens: 40_000 } },
      { messageId: 'demo-kite', sessionId: 'ses_kite', project: 'paperkite-cli', model: 'claude-haiku-4-5', usage: { input_tokens: 80_000, output_tokens: 8_000 } },
      { messageId: 'demo-eng', dept: 'engineering', model: 'claude-sonnet-4-5', usage: { input_tokens: 2_000_000, output_tokens: 400_000 } },
      { messageId: 'demo-fin', dept: 'finance', model: 'claude-haiku-4-5', usage: { input_tokens: 200_000, output_tokens: 40_000 } },
    ];
    for (const sample of samples) ingest({ ...sample, at: at - 2 * 3600e3, source: 'demo' });
    for (let i = 0; i < 6; i++) {
      noteTool({ sessionId: 'ses_kite', project: 'paperkite-cli', signature: 'Bash npm test', at: at - i * 1000 });
    }
  }

  function gate() {
    return { blockPermission, blockDepartment, noteTool, noteUsage: ingest, decorate };
  }

  return {
    ingest, noteTool, spend, status, blockPermission, blockDepartment, decorate, setBudget, summary, useDemo, gate,
    get limits() { return limits; },
    get table() { return table; },
  };
}

function publicEntry(entry) {
  return {
    messageId: entry.messageId,
    at: entry.at,
    sessionId: entry.sessionId,
    project: entry.project,
    dept: entry.dept,
    model: entry.model,
    buckets: entry.buckets,
    source: entry.source,
  };
}

function normalizeLimits(saved) {
  const limits = emptyLimits();
  for (const scope of SCOPES) {
    const spec = saved?.[scope];
    if (!spec || typeof spec !== 'object') continue;
    if (PERIODS.includes(spec.period)) limits[scope].period = spec.period;
    if (typeof spec.limitUsd === 'number' && spec.limitUsd > 0) limits[scope].limitUsd = spec.limitUsd;
    if (spec.byKey && typeof spec.byKey === 'object') {
      for (const [key, value] of Object.entries(spec.byKey)) {
        if (typeof value === 'number' && value > 0 && /^[\w ._-]{1,80}$/.test(key)) limits[scope].byKey[key] = value;
      }
    }
  }
  return limits;
}

