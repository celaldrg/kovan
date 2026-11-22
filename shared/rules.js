// Approval rules. First matching priority wins. Inside one priority, deny beats
// allow. Nothing matches means ask. Patterns are globs, not regular expressions.

const CLIS = new Set(['claude', 'codex', 'gemini', 'opencode', 'aider']);
const ACTIONS = new Set(['allow', 'deny', 'ask']);
const DOC_KEYS = new Set(['version', 'rules']);
const RULE_KEYS = new Set(['id', 'priority', 'action', 'enabled', 'match']);
const MATCH_KEYS = new Set(['cli', 'project', 'tool', 'command', 'path', 'costSoFar']);
const COST_KEYS = new Set(['gte', 'lte', 'gt', 'lt']);
const MAX_RULES = 200;
const MAX_PATTERN = 200;
const MAX_TEXT = 4000;
const MAX_OPS = 250000;

export function globMatch(pattern, text) {
  const pat = String(pattern ?? '');
  const src = String(text ?? '');
  if (!pat || pat.length > MAX_PATTERN || src.length > MAX_TEXT) return false;
  const parts = tokenize(pat);
  let ops = 0;
  const memo = new Uint8Array((parts.length + 1) * (src.length + 1));
  function go(ti, si) {
    if (++ops > MAX_OPS) return false;
    const key = ti * (src.length + 1) + si;
    if (memo[key]) return memo[key] === 1;
    let ok = false;
    if (ti === parts.length) ok = si === src.length;
    else {
      const part = parts[ti];
      if (part.kind === 'lit') ok = src.startsWith(part.text, si) && go(ti + 1, si + part.text.length);
      else if (part.kind === 'one') ok = si < src.length && go(ti + 1, si + 1);
      else if (go(ti + 1, si)) ok = true;
      else {
        for (let k = si; k < src.length; k++) {
          if (go(ti + 1, k + 1)) { ok = true; break; }
        }
      }
    }
    memo[key] = ok ? 1 : 2;
    return ok;
  }
  return go(0, 0);
}

function tokenize(pattern) {
  const parts = [];
  let lit = '';
  let i = 0;
  const flush = () => { if (lit) { parts.push({ kind: 'lit', text: lit }); lit = ''; } };
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      flush();
      while (pattern[i] === '*') i += 1;
      parts.push({ kind: 'star' });
    } else if (ch === '?') {
      flush();
      parts.push({ kind: 'one' });
      i += 1;
    } else {
      lit += ch;
      i += 1;
    }
  }
  flush();
  return parts;
}

function segments(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

function walkSegments(pSeg, tSeg) {
  let ops = 0;
  function walk(pi, ti) {
    if (++ops > MAX_OPS) return false;
    if (pi === pSeg.length) return ti === tSeg.length;
    if (pSeg[pi] === '**') {
      if (walk(pi + 1, ti)) return true;
      for (let k = ti; k < tSeg.length; k++) if (walk(pi + 1, k + 1)) return true;
      return false;
    }
    if (ti >= tSeg.length) return false;
    if (!globMatch(pSeg[pi], tSeg[ti])) return false;
    return walk(pi + 1, ti + 1);
  }
  return walk(0, 0);
}

/** Path glob. `**` is a whole segment. A pattern may match a suffix of the path. */
export function pathMatch(pattern, filePath) {
  const pat = String(pattern ?? '');
  if (!pat || pat.length > MAX_PATTERN) return false;
  const pSeg = segments(pat);
  const tSeg = segments(filePath);
  if (!pSeg.length || !tSeg.length) return false;
  if (pSeg.some(seg => seg.length > MAX_PATTERN)) return false;
  for (let i = 0; i < tSeg.length; i++) {
    if (walkSegments(pSeg, tSeg.slice(i))) return true;
  }
  return false;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function unknownKey(obj, allowed) {
  return Object.keys(obj).find(key => !allowed.has(key)) || '';
}

function cleanPattern(value, label) {
  if (typeof value !== 'string') return { error: label };
  const text = value.trim();
  if (!text || text.length > MAX_PATTERN) return { error: label };
  if (/[\u0000-\u001f]/.test(text)) return { error: label };
  return { value: text };
}

function cleanCost(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { error: 'cost' };
  if (unknownKey(spec, COST_KEYS)) return { error: 'cost' };
  const out = {};
  for (const key of COST_KEYS) {
    if (!hasOwn(spec, key)) continue;
    const n = spec[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9) return { error: 'cost' };
    out[key] = n;
  }
  if (!Object.keys(out).length) return { error: 'cost' };
  if (out.gte != null && out.lte != null && out.gte > out.lte) return { error: 'cost' };
  if (out.gt != null && out.lt != null && out.gt >= out.lt) return { error: 'cost' };
  return { value: out };
}

function cleanMatch(match) {
  if (!match || typeof match !== 'object' || Array.isArray(match)) return { error: 'match' };
  if (unknownKey(match, MATCH_KEYS)) return { error: 'match' };
  const out = {};
  if (hasOwn(match, 'cli')) {
    const list = Array.isArray(match.cli) ? match.cli : [match.cli];
    if (!list.length || list.length > 8) return { error: 'cli' };
    const clis = [];
    for (const item of list) {
      if (typeof item !== 'string' || !CLIS.has(item) || clis.includes(item)) return { error: 'cli' };
      clis.push(item);
    }
    out.cli = clis.length === 1 ? clis[0] : clis;
  }
  for (const key of ['project', 'tool', 'command']) {
    if (!hasOwn(match, key)) continue;
    const cleaned = cleanPattern(match[key], key);
    if (cleaned.error) return cleaned;
    out[key] = cleaned.value;
  }
  if (hasOwn(match, 'path')) {
    const cleaned = cleanPattern(match.path, 'path');
    if (cleaned.error) return cleaned;
    out.path = cleaned.value;
  }
  if (hasOwn(match, 'costSoFar')) {
    const cleaned = cleanCost(match.costSoFar);
    if (cleaned.error) return cleaned;
    out.costSoFar = cleaned.value;
  }
  if (!Object.keys(out).length) return { error: 'match' };
  return { value: out };
}

export function cleanRule(input, { existingId = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'schema' };
  if (unknownKey(input, RULE_KEYS)) return { error: 'schema' };
  let id = input.id;
  if (id == null || id === '') id = `r_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return { error: 'id' };
  if (existingId && (input.id == null || input.id === '')) return { error: 'id' };
  if (!ACTIONS.has(input.action)) return { error: 'action' };
  const priority = input.priority == null ? 0 : input.priority;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < -10000 || priority > 10000) return { error: 'priority' };
  if (input.enabled != null && typeof input.enabled !== 'boolean') return { error: 'enabled' };
  const match = cleanMatch(input.match);
  if (match.error) return { error: match.error };
  const rule = { id, priority, action: input.action, match: match.value };
  if (input.enabled === false) rule.enabled = false;
  return { value: rule };
}

export function validateRules(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'schema' };
  if (unknownKey(doc, DOC_KEYS)) return { error: 'schema' };
  if (doc.version !== 1) return { error: 'version' };
  if (!Array.isArray(doc.rules) || doc.rules.length > MAX_RULES) return { error: 'schema' };
  const rules = [];
  const seen = new Set();
  for (const raw of doc.rules) {
    const cleaned = cleanRule(raw);
    if (cleaned.error) return { error: cleaned.error };
    if (seen.has(cleaned.value.id)) return { error: 'id' };
    seen.add(cleaned.value.id);
    rules.push(cleaned.value);
  }
  return { value: { version: 1, rules } };
}

function cliMatches(spec, cli) {
  if (spec == null) return true;
  const list = Array.isArray(spec) ? spec : [spec];
  return list.includes(cli);
}

function costMatches(spec, value) {
  if (!spec) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.gte != null && value < spec.gte) return false;
  if (spec.gt != null && value <= spec.gt) return false;
  if (spec.lte != null && value > spec.lte) return false;
  if (spec.lt != null && value >= spec.lt) return false;
  return true;
}

export function ruleMatches(rule, event) {
  if (!rule || rule.enabled === false) return false;
  const match = rule.match || {};
  const sample = event && typeof event === 'object' ? event : {};
  if (!cliMatches(match.cli, String(sample.cli || ''))) return false;
  if (match.project && !globMatch(match.project, String(sample.project || ''))) return false;
  if (match.tool && !globMatch(match.tool, String(sample.tool || ''))) return false;
  if (match.command && !globMatch(match.command, String(sample.command || ''))) return false;
  if (match.path && !pathMatch(match.path, String(sample.path || ''))) return false;
  if (match.costSoFar && !costMatches(match.costSoFar, sample.costSoFar)) return false;
  return true;
}

/**
 * Higher priority numbers are checked first. The first tier with a match wins.
 * In that tier, deny beats allow, and allow beats ask. File order picks which
 * rule id is recorded when several rules agree.
 */
export function decideRules(rules, event) {
  const list = Array.isArray(rules) ? rules : [];
  const groups = new Map();
  list.forEach((rule, index) => {
    if (!rule || rule.enabled === false) return;
    if (!groups.has(rule.priority)) groups.set(rule.priority, []);
    groups.get(rule.priority).push({ rule, index });
  });
  const priorities = [...groups.keys()].sort((a, b) => b - a);
  for (const priority of priorities) {
    const matched = groups.get(priority).filter(item => ruleMatches(item.rule, event));
    if (!matched.length) continue;
    const denies = matched.filter(item => item.rule.action === 'deny');
    const allows = matched.filter(item => item.rule.action === 'allow');
    const chosen = denies[0] || allows[0] || matched[0];
    return {
      action: denies.length ? 'deny' : (allows.length ? 'allow' : 'ask'),
      ruleId: chosen.rule.id,
      priority,
      override: denies.length > 0 && allows.length > 0,
      matchedIds: matched.map(item => item.rule.id),
    };
  }
  return { action: 'ask', ruleId: null, priority: null, override: false, matchedIds: [] };
}

export function reorderRules(rules, id, dir) {
  const list = Array.isArray(rules) ? rules.slice() : [];
  const order = list.map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index);
  const pos = order.findIndex(item => item.rule.id === id);
  const next = pos + (dir === 'up' ? -1 : 1);
  if (pos < 0 || next < 0 || next >= order.length) return { error: 'reorder', value: list };
  const a = order[pos];
  const b = order[next];
  if (a.rule.priority !== b.rule.priority) {
    const tmp = a.rule.priority;
    a.rule.priority = b.rule.priority;
    b.rule.priority = tmp;
    return { value: list };
  }
  const ia = list.indexOf(a.rule);
  const ib = list.indexOf(b.rule);
  const tmp = list[ia];
  list[ia] = list[ib];
  list[ib] = tmp;
  return { value: list };
}
