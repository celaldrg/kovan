// Merge Kovan's Claude Code hooks into a settings object without dropping
// hooks the user already has. SessionStart is a command hook because Claude
// Code only runs command and mcp_tool handlers for that event; the command
// forwards the same JSON to Kovan. Every other event is an HTTP hook.
// PermissionRequest is never installed with onFailure "block", and a missing
// or timed-out Kovan returns no decision so Claude Code shows its own prompt.
import fs from 'node:fs';
import path from 'node:path';

export const HTTP_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd',
];

export function hookUrl(port) {
  const n = Number(port) || 4700;
  return `http://127.0.0.1:${n}/api/hooks`;
}

export function isKovanHook(hook) {
  if (!hook || typeof hook !== 'object') return false;
  if (hook.kovan === 'live-hive') return true;
  if (hook.type === 'http' && typeof hook.url === 'string' && /127\.0\.0\.1|localhost/.test(hook.url) && /\/api\/hooks\/?$/.test(hook.url)) return true;
  const args = Array.isArray(hook.args) ? hook.args.join(' ') : '';
  if (hook.type === 'command' && /hook-forward\.mjs/.test(`${hook.command || ''} ${args}`)) return true;
  return false;
}

function httpHook(event, port) {
  return {
    type: 'http',
    url: hookUrl(port),
    timeout: event === 'PermissionRequest' ? 120 : 5,
    kovan: 'live-hive',
  };
}

function commandHook(forwarder) {
  return {
    type: 'command',
    command: 'node',
    args: [forwarder],
    timeout: 8,
    kovan: 'live-hive',
  };
}

function stripKovan(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map(group => {
      if (!group || typeof group !== 'object') return group;
      const hooks = Array.isArray(group.hooks) ? group.hooks.filter(h => !isKovanHook(h)) : group.hooks;
      return { ...group, hooks };
    })
    .filter(group => group && Array.isArray(group.hooks) && group.hooks.length);
}

/** Return a new settings object with Kovan hooks merged in. Does not mutate `settings`. */
export function mergeHooks(settings, { port = 4700, forwarder }) {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? structuredClone(settings) : {};
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks) ? base.hooks : {};
  const next = { ...hooks };
  for (const event of HTTP_EVENTS) {
    const kept = stripKovan(next[event]);
    kept.push({ hooks: [httpHook(event, port)] });
    next[event] = kept;
  }
  if (forwarder) {
    const kept = stripKovan(next.SessionStart);
    kept.push({ hooks: [commandHook(forwarder)] });
    next.SessionStart = kept;
  }
  return { ...base, hooks: next };
}

/** Return a new settings object with Kovan hooks removed and other hooks left in place. */
export function removeHooks(settings) {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? structuredClone(settings) : {};
  if (!base.hooks || typeof base.hooks !== 'object') return base;
  const next = {};
  for (const [event, groups] of Object.entries(base.hooks)) {
    const kept = stripKovan(groups);
    if (kept.length) next[event] = kept;
  }
  const out = { ...base };
  if (Object.keys(next).length) out.hooks = next;
  else delete out.hooks;
  return out;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { existed: false, raw: null, json: {} };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error(`Refusing to edit ${file}: it is not valid JSON. Nothing was changed.`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`Refusing to edit ${file}: the root value must be an object.`);
  return { existed: true, raw, json };
}

function backup(file, raw) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.bak-kovan-${stamp}`;
  fs.writeFileSync(dest, raw);
  return dest;
}

function writeAtomic(file, json) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function installHooks({ file, port = 4700, forwarder }) {
  const { existed, raw, json } = readSettings(file);
  const saved = existed ? backup(file, raw) : null;
  const next = mergeHooks(json, { port, forwarder });
  writeAtomic(file, next);
  return { file, backup: saved, created: !existed, url: hookUrl(port) };
}

export function uninstallHooks({ file }) {
  const { existed, raw, json } = readSettings(file);
  if (!existed) return { file, backup: null, removed: false };
  const saved = backup(file, raw);
  const next = removeHooks(json);
  writeAtomic(file, next);
  return { file, backup: saved, removed: true };
}
