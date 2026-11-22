// HTTP API and the built web app. index.mjs wires the hive and calls listen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { modelChoices, EFFORTS } from './ai.mjs';
import { parseSchedule } from '../shared/schedule.js';
import { readSkillShelf } from './knowledge.mjs';
import { readUsage } from './usage.mjs';
import { checkDept, checkEffort, checkModel, checkRule } from './input.mjs';
import { tokenMatches } from './token.mjs';
import {
  CONTENT_SECURITY_POLICY, hostAllowed, isJsonContentType, originAllowed, parseHostHeader, readBody, resolveStatic,
} from './guard.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const KNOWN = new Set(['invalid model', 'invalid rule', 'invalid effort', 'invalid department', 'bad request', 'empty task']);

function clientError(e) {
  if (!e) return null;
  if (e.status === 413) return { status: 413, error: 'payload too large' };
  if (e.status === 400 && KNOWN.has(e.message)) return { status: 400, error: e.message };
  if (e.status === 400) return { status: 400, error: 'bad request' };
  return null;
}

function phoneOpen(pathname, method) {
  if (method === 'POST' && (pathname === '/api/phone/pair' || pathname === '/api/phone/approve' || pathname === '/api/phone/push')) return true;
  if (method === 'GET' && pathname === '/api/phone/pending') return true;
  return false;
}

function loopbackHost(header) {
  const parsed = parseHostHeader(header);
  return !!parsed && (parsed.host === '127.0.0.1' || parsed.host === 'localhost' || parsed.host === '::1');
}

export function createApp({
  cfg, crew, vault, ai, hive, live, token, allowedHosts,
  clients = new Set(),
  distDir = path.join(ROOT, 'dist'),
  limits = { json: 1_000_000, hook: 2_000_000 },
  getConnectors = () => ({ items: [], note: '' }),
  refreshConnectors = async () => getConnectors(),
  phone = null,
  ledger = null,
  reach = null,
}) {
  const baseHeaders = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store',
  };
  const send = (res, code, body) => {
    res.writeHead(code, { ...baseHeaders, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  function state() {
    return {
      name: cfg.name, backend: ai.backend, mode: cfg.mode || 'live', model: cfg.model, models: modelChoices(cfg), efforts: EFFORTS, swarm: cfg.swarm,
      live: live.snapshot(),
      depts: crew.depts, workers: crew.workers, jobs: hive.jobs(), routines: hive.routines(), connectors: getConnectors(),
      notes: vault.size(), skills: readSkillShelf(cfg.vaultDir).map(s => ({ name: s.name, about: s.about, workers: s.workers, depts: s.depts })),
      costs: ledger ? ledger.summary() : null,
      phone: phone ? phone.status() : { enabled: false, origin: '' },
    };
  }

  function boundPort() {
    const addr = server.address();
    return addr && typeof addr === 'object' ? addr.port : cfg.port;
  }

  function guard(req) {
    const port = boundPort();
    const names = allowedHosts;
    const extraHosts = reach ? [reach.host] : [];
    const extraOrigins = reach ? [reach.origin] : [];
    if (!hostAllowed(req.headers.host, { port, names, extraHosts })) return { status: 403, error: 'forbidden' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req.headers.origin, { port, names, extraOrigins })) return { status: 403, error: 'forbidden' };
    return null;
  }

  function serveStatic(req, res, pathname) {
    let file = resolveStatic(distDir, pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
    if (!file.startsWith(path.resolve(distDir) + path.sep) && file !== path.join(distDir, 'index.html')) {
      res.writeHead(404, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(503, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Kovan web app not built yet. Run: npm run build');
    }
    if (path.extname(file) === '.html') {
      let html = fs.readFileSync(file, 'utf8');
      const phonePage = html.includes('name="kovan-phone"');
      if (!phonePage && loopbackHost(req.headers.host) && !html.includes('name="kovan-token"') && /^[a-f0-9]{64}$/i.test(token)) {
        const meta = `<meta name="kovan-token" content="${token}" />`;
        html = html.includes('<head>') ? html.replace('<head>', `<head>\n  ${meta}`) : `${meta}${html}`;
      }
      res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CONTENT_SECURITY_POLICY });
      return res.end(html);
    }
    res.writeHead(200, { ...baseHeaders, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  function deviceHeader(req) {
    const raw = req.headers['x-kovan-device'];
    return typeof raw === 'string' ? raw.trim() : '';
  }

  function phoneQueue(req) {
    if (!phone.deviceFromToken(deviceHeader(req))) return { status: 401, body: { error: 'unpaired' } };
    const snap = live.snapshot();
    const summary = ledger ? ledger.summary() : { alerts: [], runaway: [] };
    const requests = snap.queue.map(card => {
      const minted = phone.mintApproval(card.id);
      return {
        id: card.id, project: card.project, tool: card.tool, command: card.command, since: card.since,
        token: minted?.token || '', expires: minted?.expires || 0,
      };
    });
    return { status: 200, body: { requests, alerts: summary.alerts || [], runaway: summary.runaway || [] } };
  }

  function acceptPair(body) {
    const result = phone.redeemPairing(body.code, body.name);
    if (!result.ok) return { status: 401, body: { error: result.reason || 'rejected' } };
    return { status: 200, body: { deviceId: result.deviceId, deviceToken: result.deviceToken, vapidPublicKey: result.vapidPublicKey } };
  }

  function answerFromPhone(res, req, body) {
    const behavior = body.behavior === 'deny' ? 'deny' : body.behavior === 'allow' ? 'allow' : '';
    if (!behavior) return send(res, 400, { error: 'bad request' });
    const requestId = String(body.requestId || '');
    if (!/^[\w-]{1,80}$/.test(requestId)) return send(res, 400, { error: 'bad request' });
    const redeemed = phone.redeemApproval({ deviceToken: deviceHeader(req), requestId, token: body.token });
    if (!redeemed.ok) {
      const status = redeemed.reason === 'unpaired' || redeemed.reason === 'revoked' ? 401 : 403;
      return send(res, status, { error: redeemed.reason });
    }
    let actual = behavior;
    const card = live.snapshot().queue.find(item => item.id === requestId);
    if (actual === 'allow' && card && ledger?.blockPermission?.({ id: card.sessionId, project: card.project })?.level === 'stop') actual = 'deny';
    const ok = live.answer(requestId, actual);
    if (!ok) return send(res, 409, { error: 'request closed' });
    return send(res, 200, { ok: true, behavior: actual });
  }

  function pushSubscribe(res, req, body) {
    const saved = phone.setPush(deviceHeader(req), body.subscription || body);
    if (!saved.ok) {
      const status = saved.reason === 'unpaired' || saved.reason === 'revoked' ? 401 : 400;
      return send(res, status, { error: saved.reason });
    }
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://local').pathname;
    } catch { return send(res, 400, { error: 'bad request' }); }
    const url = new URL(req.url || '/', 'http://local');
    const p = pathname;
    try {
      if (req.method === 'OPTIONS') return send(res, 405, { error: 'method not allowed' });
      const blocked = guard(req);
      if (blocked) return send(res, blocked.status, { error: blocked.error });
      if (p.startsWith('/api/')) {
        if (p.startsWith('/api/phone') && !phone?.enabled) return send(res, 404, { error: 'not found' });
        const openPhone = !!(phone?.enabled && phoneOpen(p, req.method));
        if (!openPhone) {
          const presented = req.headers['x-kovan-token'];
          if (typeof presented !== 'string' || !tokenMatches(presented, token)) return send(res, 401, { error: 'unauthorized' });
        }
        const writing = req.method !== 'GET' && req.method !== 'HEAD';
        if (writing && !isJsonContentType(req.headers['content-type'])) return send(res, 415, { error: 'unsupported media type' });
        if (p === '/api/stream' && req.method === 'GET') {
          res.writeHead(200, { ...baseHeaders, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          res.write(`event: hello\ndata: ${JSON.stringify({ backend: ai.backend })}\n\n`);
          clients.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
          req.on('close', () => { clearInterval(ping); clients.delete(res); });
          return;
        }
        if (p === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, backend: ai.backend, notes: vault.size(), mode: cfg.mode || 'live' });
        if (p === '/api/state' && req.method === 'GET') return send(res, 200, state());
        if (p === '/api/live' && req.method === 'GET') return send(res, 200, live.snapshot());
        if (p === '/api/vault' && req.method === 'GET') { vault.scan(); return send(res, 200, vault.graph()); }
        if (p === '/api/note' && req.method === 'GET') { const n = vault.note(url.searchParams.get('id') || ''); return n ? send(res, 200, n) : send(res, 404, { error: 'no such note' }); }
        if (p === '/api/usage' && req.method === 'GET') return send(res, 200, readUsage(hive.runs()));
        if (p === '/api/costs' && req.method === 'GET') return send(res, 200, ledger ? ledger.summary() : {});
        if (p === '/api/phone/pending' && req.method === 'GET') {
          const pending = phoneQueue(req);
          return send(res, pending.status, pending.body);
        }
        if (p === '/api/phone/devices' && req.method === 'GET') return send(res, 200, { devices: phone.listDevices() });
        if (p === '/api/parse' && req.method === 'GET') return send(res, 200, parseSchedule(url.searchParams.get('text') || '') || {});
        if (p === '/api/connectors' && req.method === 'GET' && url.searchParams.get('refresh')) return send(res, 200, await refreshConnectors());
        let m;
        if ((m = p.match(/^\/api\/chat\/([\w-]+)$/)) && req.method === 'GET') return send(res, 200, hive.chatsFor(m[1]));
        if (req.method === 'POST') {
          let body;
          try { body = await readBody(req, p === '/api/hooks' ? limits.hook : limits.json); }
          catch (e) {
            const mapped = clientError(e) || { status: 400, error: 'bad request' };
            send(res, mapped.status, { error: mapped.error });
            // Drain the rest of the body. Destroying the socket here makes Node 20
            // drop the response, so the client sees a reset instead of 413.
            req.resume();
            return;
          }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'bad request' });
          if (p === '/api/phone/pair') {
            const paired = acceptPair(body);
            return send(res, paired.status, paired.body);
          }
          if (p === '/api/phone/approve') return answerFromPhone(res, req, body);
          if (p === '/api/phone/push') return pushSubscribe(res, req, body);
          if (p === '/api/phone/pairing') {
            const started = phone.startPairing();
            return send(res, started ? 200 : 404, started || { error: 'not found' });
          }
          if (p === '/api/budgets') {
            if (!ledger) return send(res, 404, { error: 'not found' });
            const saved = ledger.setBudget(body);
            if (saved.error) return send(res, 400, { error: saved.error });
            return send(res, 200, ledger.summary());
          }
          const deviceRoute = p.match(/^\/api\/phone\/devices\/([\w-]+)\/revoke$/);
          if (deviceRoute) {
            const ok = phone.revoke(deviceRoute[1]);
            return send(res, ok ? 200 : 404, { ok });
          }
          if (p === '/api/hooks') {
            const ac = new AbortController();
            req.on('close', () => { if (!res.writableEnded) ac.abort(); });
            const out = await live.handleHook(body, { signal: ac.signal });
            return send(res, 200, out || {});
          }
          if (p === '/api/live/answer') {
            const id = String(body.id || '');
            const behavior = String(body.behavior || '');
            const ok = live.answer(id, behavior);
            return send(res, ok ? 200 : 404, { ok });
          }
          if (p === '/api/jobs') {
            const text = String(body.text || '').trim();
            if (!text) return send(res, 400, { error: 'empty task' });
            const model = checkModel(body.model || '', cfg);
            if (model.error) return send(res, 400, { error: model.error });
            const effort = checkEffort(body.effort);
            if (effort.error) return send(res, 400, { error: effort.error });
            const dept = checkDept(body.dept || body.comb || '', crew);
            if (dept.error) return send(res, 400, { error: dept.error });
            const sched = body.repeat === false ? null : parseSchedule(text);
            const needsOk = typeof body.needsOk === 'boolean' ? body.needsOk : undefined;
            if (sched || body.rule) {
              const rule = checkRule(body.rule || (sched && sched.rule));
              if (rule.error) return send(res, 400, { error: rule.error });
              const routine = hive.scheduleRoutine({
                text: sched ? sched.task : text, rule: rule.value, dept: dept.value, model: model.value,
                needsOk, start: Number.isFinite(body.start) ? body.start : 0, swarm: !!body.swarm,
              });
              return send(res, 200, { routine });
            }
            const job = await hive.addJob({
              text, dept: dept.value, model: model.value, effort: effort.value, swarm: !!body.swarm,
              at: Number.isFinite(body.at) ? body.at : null,
            });
            return send(res, 200, { job });
          }
          if ((m = p.match(/^\/api\/jobs\/([\w-]+)\/(approve|reject|cancel)$/))) {
            if (m[2] === 'cancel') return send(res, 200, hive.cancel(m[1]) || {});
            const job = m[2] === 'approve' ? hive.approve(m[1]) : hive.reject(m[1], String(body.reason || ''));
            Promise.resolve(job).catch(() => {});
            return send(res, 202, { ok: true });
          }
          if ((m = p.match(/^\/api\/routines\/([\w-]+)\/(run|pause|resume|delete)$/))) {
            try { return send(res, 200, hive.routineAction(m[1], m[2]) || {}); }
            catch { return send(res, 404, { error: 'not found' }); }
          }
          if ((m = p.match(/^\/api\/chat\/([\w-]+)$/))) {
            Promise.resolve(hive.chat(m[1], String(body.message || ''))).catch(() => {});
            return send(res, 202, { ok: true });
          }
        }
        return send(res, 404, { error: 'not found' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, p);
    } catch (e) {
      console.error('kovan request failed', req.method, p);
      console.error(e && e.stack ? e.stack : e);
      if (res.headersSent) { try { res.end(); } catch { /* already closed */ } return; }
      const mapped = clientError(e);
      if (mapped) return send(res, mapped.status, { error: mapped.error });
      return send(res, 500, { error: 'request failed' });
    }
  });

  return server;
}

export { CONTENT_SECURITY_POLICY };
