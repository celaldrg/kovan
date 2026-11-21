// Kovan server: JSON API + server-sent events + the built web app from dist/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, loadCrew } from './config.mjs';
import { createVault } from './vault.mjs';
import { createAI, detectBackend, MODELS, EFFORTS } from './ai.mjs';
import { createHive } from './hive.mjs';
import { listConnectors } from './connectors.mjs';
import { readUsage } from './usage.mjs';
import { parseSchedule } from '../shared/schedule.js';
import { readSkillShelf } from './knowledge.mjs';

const cfg = loadConfig();
const crew = loadCrew();
const vault = createVault(cfg.vaultDir);
const ai = createAI(detectBackend());
const clients = new Set();
const emit = (event, data) => { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
const hive = createHive({ cfg, crew, vault, ai, emit });
let connectors = { items: [], note: 'checking…' };
listConnectors(ai.backend, cfg.connectors).then(c => { connectors = c; emit('connectors', c); });

const DIST = path.join(ROOT, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});

function state() {
  return {
    name: cfg.name, backend: ai.backend, model: cfg.model, models: MODELS, efforts: EFFORTS, swarm: cfg.swarm,
    depts: crew.depts, workers: crew.workers, jobs: hive.jobs(), routines: hive.routines(), connectors,
    notes: vault.size(), skills: readSkillShelf(cfg.vaultDir).map(s => ({ name: s.name, about: s.about, workers: s.workers, depts: s.depts })),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ backend: ai.backend })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === '/api/health') return send(res, 200, { ok: true, backend: ai.backend, notes: vault.size() });
    if (p === '/api/state') return send(res, 200, state());
    if (p === '/api/vault') { vault.scan(); return send(res, 200, vault.graph()); }
    if (p === '/api/note') { const n = vault.note(url.searchParams.get('id') || ''); return n ? send(res, 200, n) : send(res, 404, { error: 'no such note' }); }
    if (p === '/api/usage') return send(res, 200, readUsage(hive.runs()));
    if (p === '/api/parse') return send(res, 200, parseSchedule(url.searchParams.get('text') || '') || {});
    if (p === '/api/connectors' && url.searchParams.get('refresh')) { connectors = await listConnectors(ai.backend, cfg.connectors); return send(res, 200, connectors); }
    let m;
    if ((m = p.match(/^\/api\/chat\/([\w-]+)$/)) && req.method === 'GET') return send(res, 200, hive.chatsFor(m[1]));
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (p === '/api/jobs') {
        const text = String(body.text || '').trim();
        if (!text) return send(res, 400, { error: 'empty task' });
        const sched = body.repeat === false ? null : parseSchedule(text);
        if (sched || body.rule) {
          const r = hive.scheduleRoutine({ text: sched ? sched.task : text, rule: body.rule || sched.rule, dept: body.dept || body.comb || '', model: body.model || '', needsOk: body.needsOk, start: body.start || 0, swarm: !!body.swarm });
          return send(res, 200, { routine: r });
        }
        return send(res, 200, { job: await hive.addJob({ text, dept: body.dept || body.comb || '', model: body.model || '', effort: body.effort || '', swarm: !!body.swarm, at: body.at || null }) });
      }
      if ((m = p.match(/^\/api\/jobs\/([\w-]+)\/(approve|reject|cancel)$/))) {
        if (m[2] === 'cancel') return send(res, 200, hive.cancel(m[1]) || {});
        const job = m[2] === 'approve' ? hive.approve(m[1]) : hive.reject(m[1], body.reason || '');
        job.catch(() => {});
        return send(res, 202, { ok: true });
      }
      if ((m = p.match(/^\/api\/routines\/([\w-]+)\/(run|pause|resume|delete)$/))) return send(res, 200, hive.routineAction(m[1], m[2]) || {});
      if ((m = p.match(/^\/api\/chat\/([\w-]+)$/))) { hive.chat(m[1], String(body.message || '')).catch(() => {}); return send(res, 202, { ok: true }); }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    // static
    let file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('Kovan web app not built yet. Run: npm run build'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(cfg.port, () => {
  console.log(`\n  🐝 Kovan · ${cfg.name}\n  http://localhost:${cfg.port}\n  backend: ${ai.backend}${ai.backend === 'demo' ? ' (simulated work — install Claude Code or set ANTHROPIC_API_KEY for real runs)' : ''}\n  vault: ${cfg.vaultDir} (${vault.size()} notes)\n`);
});
const stop = () => { hive.flush(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
