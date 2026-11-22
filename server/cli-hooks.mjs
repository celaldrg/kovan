// Optional hook install for Codex and Gemini CLI. Claude stays in hooks-settings.mjs.
// A missing tool is skipped. A hook that exits without a decision is not an allow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRIVATE = 0o600;

function command(forwarder, port, cli) {
  const quoted = `'${String(forwarder).replace(/'/g, `'\\''`)}'`;
  return `node ${quoted} --port ${Number(port) || 4700} --cli ${cli}`;
}

function isOurs(hook) {
  if (!hook || typeof hook !== 'object') return false;
  if (hook.kovan === 'live-hive') return true;
  const text = `${hook.command || ''} ${Array.isArray(hook.args) ? hook.args.join(' ') : ''}`;
  return /hook-forward\.mjs/.test(text);
}

function strip(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map(group => {
      if (!group || typeof group !== 'object') return group;
      const hooks = Array.isArray(group.hooks) ? group.hooks.filter(hook => !isOurs(hook)) : group.hooks;
      return { ...group, hooks };
    })
    .filter(group => group && Array.isArray(group.hooks) && group.hooks.length);
}

function merge(settings, events) {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? structuredClone(settings) : {};
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks) ? { ...base.hooks } : {};
  for (const [event, hook] of Object.entries(events)) {
    const kept = strip(hooks[event]);
    kept.push({ hooks: [hook] });
    hooks[event] = kept;
  }
  return { ...base, hooks };
}

function remove(settings) {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? structuredClone(settings) : {};
  if (!base.hooks || typeof base.hooks !== 'object') return base;
  const next = {};
  for (const [event, groups] of Object.entries(base.hooks)) {
    const kept = strip(groups);
    if (kept.length) next[event] = kept;
  }
  const out = { ...base };
  if (Object.keys(next).length) out.hooks = next;
  else delete out.hooks;
  return out;
}

export function codexHookPlan(port, forwarder) {
  const hook = (timeout) => ({ type: 'command', command: command(forwarder, port, 'codex'), timeout, kovan: 'live-hive' });
  return {
    SessionStart: hook(10),
    SessionEnd: hook(10),
    UserPromptSubmit: hook(10),
    PreToolUse: hook(10),
    PostToolUse: hook(10),
    Stop: hook(10),
    // Seconds, matching Codex hook config. Empty stdout is not an allow.
    PermissionRequest: hook(120),
  };
}

export function geminiHookPlan(port, forwarder) {
  const hook = (timeout) => ({ type: 'command', command: command(forwarder, port, 'gemini'), timeout, kovan: 'live-hive' });
  return {
    SessionStart: hook(8000),
    SessionEnd: hook(8000),
    Notification: hook(8000),
    AfterTool: hook(8000),
    // Milliseconds, matching Gemini hook config. BeforeTool is held until Allow or Deny.
    BeforeTool: hook(120000),
  };
}

export function mergeCodexHooks(settings, { port = 4700, forwarder }) {
  return merge(settings, codexHookPlan(port, forwarder));
}

export function mergeGeminiHooks(settings, { port = 4700, forwarder }) {
  return merge(settings, geminiHookPlan(port, forwarder));
}

export function removeCliHooks(settings) {
  return remove(settings);
}

function readJson(file) {
  if (!fs.existsSync(file)) return { existed: false, raw: null, json: {} };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error(`Refusing to edit ${file}: it is not valid JSON. Nothing was changed.`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`Refusing to edit ${file}: the root value must be an object.`);
  return { existed: true, raw, json };
}

function writeAtomic(file, json) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', { mode: PRIVATE });
  try { fs.chmodSync(tmp, PRIVATE); } catch { /* ignore */ }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, PRIVATE); } catch { /* ignore */ }
}

function installFile(file, next) {
  const current = readJson(file);
  if (current.existed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${file}.bak-kovan-${stamp}`;
    fs.writeFileSync(dest, current.raw, { mode: PRIVATE });
    try { fs.chmodSync(dest, PRIVATE); } catch { /* ignore */ }
  }
  writeAtomic(file, next);
  return file;
}

export function codexHooksFile(env = process.env) {
  const root = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(root, 'hooks.json');
}

export function geminiSettingsFile(env = process.env) {
  const root = env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
  return path.join(root, 'settings.json');
}

export function cliPresent(env = process.env, exists = fs.existsSync) {
  const codexHome = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const geminiHome = env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
  return { codex: exists(codexHome), gemini: exists(geminiHome) };
}

/** Install into a tool only when its config directory already exists. */
export function installOptionalHooks({ port = 4700, forwarder, env = process.env, exists = fs.existsSync } = {}) {
  const found = cliPresent(env, exists);
  const installed = [];
  if (found.codex) {
    const file = codexHooksFile(env);
    installFile(file, mergeCodexHooks(readJson(file).json, { port, forwarder }));
    installed.push({ cli: 'codex', file });
  }
  if (found.gemini) {
    const file = geminiSettingsFile(env);
    installFile(file, mergeGeminiHooks(readJson(file).json, { port, forwarder }));
    installed.push({ cli: 'gemini', file });
  }
  return { found, installed };
}

export function uninstallOptionalHooks({ env = process.env, exists = fs.existsSync } = {}) {
  const found = cliPresent(env, exists);
  const removed = [];
  for (const [cli, file] of [['codex', codexHooksFile(env)], ['gemini', geminiSettingsFile(env)]]) {
    if (!found[cli] || !exists(file)) continue;
    const current = readJson(file);
    installFile(file, removeCliHooks(current.json));
    removed.push({ cli, file });
  }
  return { removed };
}
