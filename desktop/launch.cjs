// Resolves the Kovan server the desktop shell should start.
// The window always talks to 127.0.0.1. Packaged builds read the extra resources.
const fs = require('node:fs');
const path = require('node:path');

function kovanRoot({ resourcesPath, moduleDir, envRoot } = {}) {
  if (envRoot) return path.resolve(envRoot);
  if (resourcesPath) {
    const packed = path.join(resourcesPath, 'kovan');
    if (fs.existsSync(path.join(packed, 'server', 'index.mjs'))) return packed;
  }
  return path.resolve(moduleDir || __dirname, '..');
}

function serverEnv(base, { port, dataDir, vault } = {}) {
  const env = { ...base };
  env.ELECTRON_RUN_AS_NODE = '1';
  env.KOVAN_HOST = '127.0.0.1';
  env.KOVAN_PORT = String(port || 4700);
  if (dataDir) env.KOVAN_DATA = dataDir;
  if (vault) env.KOVAN_VAULT = vault;
  return env;
}

/** True only for the exact loopback origin the desktop server was started on. */
function isAppUrl(value, port) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol !== 'http:') return false;
  if (url.hostname !== '127.0.0.1') return false;
  const expected = String(Number(port));
  if (!/^\d+$/.test(expected) || expected === 'NaN') return false;
  const actual = url.port || '80';
  return actual === expected;
}

/**
 * New windows are always denied. An https URL may be opened in the system
 * browser. file, javascript, http, and custom schemes are not.
 */
function windowOpenDecision(value) {
  let url;
  try { url = new URL(String(value)); } catch { return { action: 'deny', external: '' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { action: 'deny', external: '' };
  return { action: 'deny', external: url.href };
}

module.exports = { kovanRoot, serverEnv, isAppUrl, windowOpenDecision };
