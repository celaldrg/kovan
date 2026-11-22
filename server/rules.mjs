// Local approval rules. A file that does not parse fails closed: decisions ask,
// and nothing is auto-allowed. The file is mode 0600.
import fs from 'node:fs';
import path from 'node:path';
import { cleanRule, decideRules, reorderRules, validateRules } from '../shared/rules.js';

const PRIVATE = 0o600;

function tighten(file) {
  try { fs.chmodSync(file, PRIVATE); } catch { /* Windows does not use POSIX modes. */ }
}

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* ignore */ }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: PRIVATE });
  tighten(tmp);
  fs.renameSync(tmp, file);
  tighten(file);
}

export function createRules({ file } = {}) {
  function load() {
    if (!file) return { status: 'invalid', error: 'schema', doc: null };
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (err) {
      if (err && err.code === 'ENOENT') return { status: 'absent', error: '', doc: { version: 1, rules: [] } };
      return { status: 'invalid', error: 'parse', doc: null };
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return { status: 'invalid', error: 'parse', doc: null }; }
    const cleaned = validateRules(parsed);
    if (cleaned.error) return { status: 'invalid', error: cleaned.error, doc: null };
    return { status: 'ok', error: '', doc: cleaned.value };
  }

  function evaluate(event) {
    let loaded;
    try { loaded = load(); }
    catch { return { action: 'ask', ruleId: null, failed: true, status: 'invalid', error: 'parse', override: false, matchedIds: [] }; }
    if (loaded.status === 'invalid' || !loaded.doc) {
      return { action: 'ask', ruleId: null, failed: true, status: 'invalid', error: loaded.error || 'parse', override: false, matchedIds: [] };
    }
    try {
      const decision = decideRules(loaded.doc.rules, event);
      return { ...decision, failed: false, status: loaded.status, error: '' };
    } catch {
      return { action: 'ask', ruleId: null, failed: true, status: 'invalid', error: 'schema', override: false, matchedIds: [] };
    }
  }

  function save(doc) {
    const cleaned = validateRules(doc);
    if (cleaned.error) return { error: cleaned.error };
    writePrivate(file, `${JSON.stringify(cleaned.value, null, 2)}\n`);
    return { ok: true, ...publicView(load()) };
  }

  function mutate(input) {
    const op = input && input.op;
    if (op === 'reset') return save({ version: 1, rules: [] });
    if (op === 'replace') return save({ version: 1, rules: Array.isArray(input.rules) ? input.rules : null });
    const loaded = load();
    if (loaded.status === 'invalid') return { error: 'rules file is invalid' };
    const rules = loaded.doc.rules.slice();
    if (op === 'add') {
      const cleaned = cleanRule(input.rule || {});
      if (cleaned.error) return { error: cleaned.error };
      if (rules.some(rule => rule.id === cleaned.value.id)) return { error: 'id' };
      if (input.rule && input.rule.priority == null) {
        cleaned.value.priority = rules.reduce((max, rule) => Math.max(max, rule.priority), 0) + 10;
      }
      rules.push(cleaned.value);
      return save({ version: 1, rules });
    }
    if (op === 'update') {
      const cleaned = cleanRule(input.rule || {}, { existingId: true });
      if (cleaned.error) return { error: cleaned.error };
      const index = rules.findIndex(rule => rule.id === cleaned.value.id);
      if (index < 0) return { error: 'id' };
      rules[index] = cleaned.value;
      return save({ version: 1, rules });
    }
    if (op === 'delete') {
      const id = String(input.id || '');
      if (!rules.some(rule => rule.id === id)) return { error: 'id' };
      return save({ version: 1, rules: rules.filter(rule => rule.id !== id) });
    }
    if (op === 'reorder') {
      if (input.dir !== 'up' && input.dir !== 'down') return { error: 'reorder' };
      const moved = reorderRules(rules, String(input.id || ''), input.dir);
      if (moved.error) return { error: moved.error };
      return save({ version: 1, rules: moved.value });
    }
    return { error: 'schema' };
  }

  return { load, evaluate, mutate, save };
}

export function publicView(loaded) {
  return {
    version: 1,
    status: loaded.status,
    error: loaded.error || '',
    rules: loaded.doc ? loaded.doc.rules : [],
  };
}
