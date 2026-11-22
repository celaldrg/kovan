// Kovan server: JSON API + server-sent events + the built web app from dist/.
import path from 'node:path';
import { loadConfig, loadCrew } from './config.mjs';
import { createVault } from './vault.mjs';
import { createAI, detectBackend } from './ai.mjs';
import { createHive } from './hive.mjs';
import { listConnectors } from './connectors.mjs';
import { createLive } from './live.mjs';
import { startLogTail } from './jsonl-tail.mjs';
import { startLiveDemo } from './live-demo.mjs';
import { createApp } from './app.mjs';
import { allowedHostnames, resolveBind } from './guard.mjs';
import { launchToken } from './token.mjs';

const cfg = loadConfig();
const crew = loadCrew();
const vault = createVault(cfg.vaultDir);
const ai = createAI(detectBackend(), cfg);
const clients = new Set();
const emit = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
const hive = createHive({ cfg, crew, vault, ai, emit });
const demo = process.env.KOVAN_DEMO === '1' || ai.backend === 'demo';
const live = createLive({ emit });
if (demo) startLiveDemo(live);
else startLogTail(live);
let connectors = { items: [], note: 'checking…' };
listConnectors(ai.backend, cfg.connectors).then(c => { connectors = c; emit('connectors', c); });

const bind = resolveBind(process.env);
const token = launchToken(path.join(cfg.dataDir, 'token'));
const server = createApp({
  cfg, crew, vault, ai, hive, live, token, clients,
  allowedHosts: allowedHostnames(process.env, bind.host),
  getConnectors: () => connectors,
  refreshConnectors: async () => {
    connectors = await listConnectors(ai.backend, cfg.connectors);
    emit('connectors', connectors);
    return connectors;
  },
});

const shownHost = bind.host.includes(':') ? `[${bind.host}]` : bind.host;
server.listen(cfg.port, bind.host, () => {
  console.log(`\n  Kovan · ${cfg.name}\n  http://${shownHost}:${cfg.port}\n  live hive: ${demo ? 'demo sessions' : 'hooks + session logs'}\n  backend: ${ai.backend}${ai.backend === 'demo' ? ' (company mode is simulated — install Claude Code or set ANTHROPIC_API_KEY for real runs)' : ''}\n  vault: ${cfg.vaultDir} (${vault.size()} notes)\n  token: 0600 file in the data directory (not printed)\n`);
  if (bind.exposed) {
    console.warn(`  WARNING: Kovan is listening on ${bind.host}, not loopback alone.`);
    console.warn('  The API still requires the launch token. Prefer the default 127.0.0.1.');
    console.warn('  Set KOVAN_HOST_ALLOW to every hostname clients will send.\n');
  }
});
const stop = () => { hive.flush(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
