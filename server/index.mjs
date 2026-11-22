// Kovan server: JSON API + server-sent events + the built web app from dist/.
import path from 'node:path';
import { loadConfig, loadCrew } from './config.mjs';
import { createVault } from './vault.mjs';
import { createAI, detectBackend } from './ai.mjs';
import { createHive } from './hive.mjs';
import { listConnectors } from './connectors.mjs';
import { createLive } from './live.mjs';
import { startLogTail } from './jsonl-tail.mjs';
import { startAgentWatch } from './agents-watch.mjs';
import { startLiveDemo } from './live-demo.mjs';
import { createReplay } from './replay.mjs';
import { createApp } from './app.mjs';
import { allowedHostnames, publicReach, resolveBind } from './guard.mjs';
import { launchToken } from './token.mjs';
import { createLedger } from './ledger.mjs';
import { createPhone } from './phone.mjs';
import { collectUsageEntries } from './usage.mjs';

const cfg = loadConfig();
const crew = loadCrew();
const vault = createVault(cfg.vaultDir);
const ai = createAI(detectBackend(), cfg);
const clients = new Set();
const emit = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
const demo = process.env.KOVAN_DEMO === '1' || ai.backend === 'demo';
const phoneEnabled = process.env.KOVAN_PHONE === '1' || cfg.phone?.enabled === true;
const reach = phoneEnabled ? publicReach(process.env.KOVAN_PUBLIC_ORIGIN || cfg.phone?.origin || '') : null;
let phone;
let lastAlerts = '';
const ledger = createLedger({
  file: path.join(cfg.dataDir, 'costs.json'),
  budgetFile: path.join(cfg.dataDir, 'budgets.json'),
  priceOverlay: cfg.prices || null,
  aliases: cfg.modelIds || null,
  configured: cfg.budgets || null,
  demo,
  onChange() {
    const summary = ledger.summary();
    emit('costs', summary);
    const key = JSON.stringify((summary.alerts || []).map(alert => [alert.level, alert.scope, alert.key]));
    if (key === lastAlerts) return;
    const first = lastAlerts === '';
    lastAlerts = key;
    if (!first) phone?.pushAll?.({ type: 'budget', alerts: summary.alerts });
  },
});
phone = createPhone({
  file: path.join(cfg.dataDir, 'phone.json'),
  enabled: phoneEnabled,
  publicOrigin: reach?.origin || '',
});
if (demo) ledger.useDemo();
const hive = createHive({ cfg, crew, vault, ai, emit, costs: ledger });
const seenPermits = new Set();
const emitAll = (event, data) => {
  emit(event, data);
  if (event !== 'live' || !phone.enabled) return;
  for (const card of data.queue || []) {
    if (seenPermits.has(card.id)) continue;
    seenPermits.add(card.id);
    const minted = phone.mintApproval(card.id);
    phone.pushAll({
      type: 'permission', id: card.id, project: card.project, tool: card.tool,
      command: String(card.command || '').slice(0, 180), token: minted?.token || '', expires: minted?.expires || 0,
    });
  }
};
const replayOn = process.env.KOVAN_REPLAY === '0' ? false : cfg.replay?.enabled !== false;
const replayDays = Number(process.env.KOVAN_REPLAY_DAYS || cfg.replay?.retentionDays || 30);
const replay = createReplay({
  dir: path.join(cfg.dataDir, 'replay'),
  enabled: replayOn,
  retentionDays: replayDays,
});
if (replayOn) replay.purge();
const live = createLive({
  emit: emitAll,
  gate: ledger.gate(),
  onRecord(event) { replay.append(event); },
});
if (demo) {
  startLiveDemo(live, replay);
  const keep = setInterval(() => {
    const at = Date.now();
    for (let i = 0; i < 6; i++) ledger.noteTool({ sessionId: 'ses_kite', project: 'paperkite-cli', signature: 'Bash npm test', at: at - i * 1000 });
  }, 20000);
  keep.unref?.();
} else {
  startLogTail(live);
  startAgentWatch(live);
  const pull = () => {
    try {
      for (const row of collectUsageEntries()) ledger.ingest({ ...row, source: 'jsonl' });
    } catch { /* logs are optional */ }
  };
  const scan = setInterval(pull, 20000);
  scan.unref?.();
  const first = setTimeout(pull, 800);
  first.unref?.();
}
let connectors = { items: [], note: 'checking…' };
listConnectors(ai.backend, cfg.connectors).then(c => { connectors = c; emit('connectors', c); });

const bind = resolveBind(process.env);
const token = launchToken(path.join(cfg.dataDir, 'token'));
const server = createApp({
  cfg, crew, vault, ai, hive, live, token, clients,
  phone, ledger, replay, reach,
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
  console.log(`\n  Kovan · ${cfg.name}\n  http://${shownHost}:${cfg.port}\n  live hive: ${demo ? 'demo sessions' : 'hooks + session logs'}\n  backend: ${ai.backend}${ai.backend === 'demo' ? ' (company mode is simulated — install Claude Code or set ANTHROPIC_API_KEY for real runs)' : ''}\n  vault: ${cfg.vaultDir} (${vault.size()} notes)\n  token: 0600 file in the data directory (not printed)\n  costs: rate card ${ledger.table.dated}\n  phone: ${phone.enabled ? 'opt-in on' : 'off'}\n`);
  if (phone.enabled && !phone.origin) {
    console.warn('  Phone pairing is on, but KOVAN_PUBLIC_ORIGIN is empty.');
    console.warn('  A phone cannot open 127.0.0.1. Set the origin to a LAN address or a tunnel you run.\n');
  }
  if (phone.enabled && !bind.exposed && reach && !['127.0.0.1', 'localhost', '::1'].includes(reach.host)) {
    console.warn('  Kovan is still bound to loopback.');
    console.warn('  Reach it from a phone through a tunnel that forwards to this port, or set KOVAN_HOST.\n');
  }
  if (bind.exposed) {
    console.warn(`  WARNING: Kovan is listening on ${bind.host}, not loopback alone.`);
    console.warn('  The API still requires the launch token. Prefer the default 127.0.0.1.');
    console.warn('  Set KOVAN_HOST_ALLOW to every hostname clients will send.\n');
  }
});
const stop = () => { hive.flush(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
