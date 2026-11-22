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

module.exports = { kovanRoot, serverEnv };
