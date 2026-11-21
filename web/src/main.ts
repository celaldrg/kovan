import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/space-grotesk/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './style.css';
import { Hive } from './scene';
import { get, post } from './api';
import { md, esc } from './md';
import { openGraph } from './graph';
import { openCalendar } from './calendar';
import { paintBoard } from './board';
import { icon } from './icons';
import { mark, wordmark } from './brand';
import { parseSchedule, describeRule, isOutbound, detectSwarm } from '../../shared/schedule.js';
import { pickDepartment, guessDepartment } from '../../shared/departments.js';
import { liveCrew, paintQueue, paintPermit, paintSessions, noteNewPermits, permitCard } from './live-view';
import type { State, Job, ChatMsg, Pulse, Routine, Dept, LiveSnap } from './types';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="splash" id="splash"><div class="splash-grid"></div><div class="splash-in">
    <div class="sp-brand">${mark(44, 'sp')}<div class="splash-word">${wordmark()}</div><span class="sp-ver">v0.1</span></div>
    <div class="sp-kicker">Live hive for coding agents</div>
    <h1 class="sp-title">Every session,<br><em>in one living hive.</em></h1>
    <ul class="sp-steps" id="spSteps"><li style="--i:0"><i></i><span>Indexing the knowledge vault</span></li><li style="--i:1"><i></i><span>Bringing agents online</span></li><li style="--i:2"><i></i><span>Routing engine ready</span></li></ul>
    <div class="splash-bar"><i></i></div>
  </div></div>
  <div id="stage"></div><div class="vignette"></div><div id="labels"></div>
  <header class="topbar glass">
    <div class="brand">${mark(30, 'tb')}${wordmark()}<span class="sep"></span><span class="biz" id="bizname"></span><span class="status" id="backend"><i></i><b></b></span></div>
    <nav class="seg" id="nav">
      <span class="seg-ind"></span>
      <button data-view="hive" class="on">${icon('Hexagon', 15)}<span>Overview</span></button>
      <button data-view="agents">${icon('Bot', 15)}<span>Agents</span><kbd>A</kbd></button>
      <button data-view="departments">${icon('Building2', 15)}<span>Departments</span><kbd>D</kbd></button>
      <button data-view="vault">${icon('Network', 15)}<span>Knowledge Vault</span><kbd>V</kbd></button>
      <button data-view="calendar">${icon('CalendarDays', 15)}<span>Schedule</span><kbd>K</kbd></button>
      <button data-view="board">${icon('KanbanSquare', 15)}<span>Board</span><kbd>B</kbd></button>
    </nav>
    <div class="right">
      <button class="modebtn" id="modeBtn" type="button" title="Switch between the live hive and company mode">Company</button>
      <div class="meter" id="meter" title="Token usage">${icon('Gauge', 15)}<div><b id="m5">0</b><small>5h</small></div><div><b id="m7">0</b><small>7d</small></div></div>
      <button class="ibtn" data-k="t" title="Theme (T)">${icon('SunMoon', 17)}</button>
      <button class="ibtn" data-k="f" title="Focus mode (F)">${icon('Focus', 17)}</button>
    </div>
  </header>
  <aside class="activity glass">
    <div class="pane-head"><h2>${icon('Activity', 15)} <span id="paneTitle">Needs you</span></h2><span class="live"><i></i><b id="liveCount">0</b> live</span></div>
    <div class="filters" id="chips"></div>
    <div id="jobs" class="jobs timeline"></div>
    <div class="links" id="links"></div>
  </aside>
  <aside class="pulse glass" id="pulse">
    <div class="stat"><small id="lab1">${icon('Loader', 11)}Working</small><b data-n="busy">0</b><em id="mBusy">—</em><div class="spark" id="busyBar"><i></i></div></div>
    <div class="stat"><small id="lab2">${icon('Hand', 11)}Needs you</small><b data-n="today">0</b><em id="mToday">—</em></div>
    <div class="stat"><small id="lab3">${icon('Timer', 11)}Stuck</small><b id="mLat">—</b><em id="mP95">—</em></div>
    <div class="stat"><small id="lab4">${icon('Coins', 11)}Idle</small><b id="mTok">0</b><em id="mCost" title="Estimated from per-model list prices; real billing may differ">—</em></div>
    <div class="stat"><small id="lab5">${icon('ShieldCheck', 11)}Projects</small><b id="mOk">—</b><em id="mGate">—</em></div>
  </aside>
  <form class="cmd" id="cmd">
    <div class="cmd-glow"></div>
    <div class="cmd-inner">
      <div class="cmd-row">
        <div class="dpick" id="dpick"><button type="button" class="dpick-btn" id="dpickBtn" title="Department (Tab to cycle)"><i class="dot"></i><span>Auto-route</span>${icon('ChevronDown', 14)}</button><div class="dmenu glass" id="dmenu"></div></div>
        <textarea id="task" rows="1" placeholder="Describe a task, and Kovan routes it to the right agent…"></textarea>
        <button class="send" id="go" title="Send (Enter)">${icon('ArrowUp', 18, 2.2)}</button>
      </div>
      <div class="cmd-foot">
        <button type="button" id="swarm" class="tog" title="Swarm: the department head splits the task across the team">${icon('Users', 14)}<span>Swarm</span></button>
        <label class="pick sm">${icon('Cpu', 14)}<select id="model" title="Model"></select></label>
        <label class="pick sm">${icon('Zap', 14)}<select id="effort" title="Effort"></select></label>
        <div class="hint" id="hint"></div>
      </div>
    </div>
  </form>
  <aside class="chat glass" id="chat"></aside>
  <aside class="permit glass" id="permit"></aside>
  <aside class="dfocus glass" id="dfocus"></aside>
  <div class="sheet glass" id="sheet"><button class="ibtn close" id="sheetClose" title="Close (Esc)">${icon('X', 18)}</button><div id="sheetBody"></div></div>
  <div class="toasts" id="toasts"></div>
  <div class="tip" id="tip"></div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let st: State;
let hive: Hive;
let mode: 'live' | 'company' = 'live';
let liveSnap: LiveSnap = { source: 'none', hooked: false, sessions: [], queue: [], zones: [] };
let liveFilter = 'needs';
let hiveSig = '';
let filter = 'active';
let chatWith: string | null = null;
let swarm = false;
let sheet: { kind: string; refresh?: () => void; stop?: () => void } | null = null;
const seen = new Set<string>();
const lastState = new Map<string, string>();

const workerName = (id?: string | null) => st.workers.find(w => w.id === id)?.name || '…';
const deptOf = (id: string) => st.depts.find(c => c.id === id);
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 45 ? 'now' : s < 3600 ? `${Math.floor(s / 60) || 1}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
const hexAvatar = (name: string, color: string, size = 28) => `<span class="hexav" style="--c:${color};width:${size}px;height:${size}px">${esc(name[0] || '?')}</span>`;

/** Count smoothly from the element's current value to `to`. */
function tween(el: Element | null, to: number) {
  if (!el) return;
  const from = Number((el as HTMLElement).dataset.v || 0);
  if (from === to) { el.textContent = String(to); return; }
  (el as HTMLElement).dataset.v = String(to);
  const t0 = performance.now(), dur = 650;
  const step = (now: number) => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.textContent = String(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  el.classList.remove('bump'); void (el as HTMLElement).offsetWidth; el.classList.add('bump');
}

function crewSig(depts: Dept[], workers: { id: string; dept: string }[]) {
  return depts.map(d => d.id).join(',') + '|' + workers.map(w => `${w.id}@${w.dept}`).join(',');
}
function ensureHive(depts: Dept[], workers: State['workers'], core: string) {
  const sig = crewSig(depts, workers);
  if (sig !== hiveSig) { hive.syncPopulation(depts, workers); hiveSig = sig; }
  hive.setCoreLabel(core);
}

async function boot() {
  const t0 = performance.now();
  st = await get<State>('/api/state');
  liveSnap = st.live || liveSnap;
  const saved = sessionStorage.getItem('kovan-mode');
  mode = saved === 'company' || saved === 'live' ? saved : (st.mode === 'company' ? 'company' : 'live');
  document.title = `Kovan · ${st.name}`;
  $('bizname').textContent = mode === 'live' ? 'Live hive' : st.name;
  const b = $('backend');
  b.querySelector('b')!.textContent = st.backend === 'claude-cli' ? 'Online · CLI' : st.backend === 'api' ? 'Online · API' : 'Demo';
  b.className = `status ${st.backend === 'demo' ? 'demo' : 'live'}`;
  b.title = st.backend === 'demo' ? 'Simulated work. Install & log in to Claude Code, or set ANTHROPIC_API_KEY, then restart.' : 'Real runs on your own login.';
  renderDeptMenu();
  $('model').innerHTML = st.models.map(m => `<option ${m === st.model ? 'selected' : ''}>${m}</option>`).join('');
  $('effort').innerHTML = st.efforts.map(e => `<option value="${e}">${e || 'auto'}</option>`).join('');
  const steps = $('spSteps')?.querySelectorAll('li span');
  if (steps?.length === 3 && mode === 'live') {
    steps[0].textContent = liveSnap.sessions.length ? `Found ${liveSnap.sessions.length} sessions` : 'Waiting for Claude Code sessions';
    steps[1].textContent = `${liveSnap.zones.length} project zone${liveSnap.zones.length === 1 ? '' : 's'}`;
    steps[2].textContent = st.backend === 'demo' ? 'Demo hive ready' : (liveSnap.hooked ? 'Hooks connected' : 'Watching session logs');
  } else if (steps?.length === 3) { steps[0].textContent = `Indexing ${st.notes} knowledge notes`; steps[1].textContent = `Bringing ${st.workers.length} agents online across ${st.depts.length} departments`; steps[2].textContent = `Routing engine ready · ${st.backend === 'demo' ? 'demo mode' : 'live'}`; }
  if (!st.swarm?.enabled) $('swarm').style.display = 'none';
  st.jobs.forEach(j => { seen.add(j.id); lastState.set(j.id, j.state); });

  const pop = mode === 'live' ? liveCrew(liveSnap) : { depts: st.depts, workers: st.workers };
  hive = new Hive($('stage'), $('labels'), pop.depts, pop.workers, mode === 'live' ? Math.max(liveSnap.sessions.length, 1) : st.notes);
  hiveSig = crewSig(pop.depts, pop.workers);
  hive.setCoreLabel(mode === 'live' ? 'LIVE HIVE' : 'KNOWLEDGE VAULT');
  (window as unknown as { kovan: unknown }).kovan = { hive, get mode() { return mode; }, setMode, get live() { return liveSnap; } };
  hive.onBeeClick = id => (mode === 'live' ? openLiveBee(id) : openChat(id));
  hive.onDeptClick = id => (mode === 'live' ? flyToProject(id) : flyToDept(id));
  hive.onBeeHover = showTip;
  applyModeChrome();
  hive.onReady = () => setTimeout(() => { $('splash').classList.add('out'); document.body.classList.add('ready'); hive.startIntro(); setTimeout(() => document.body.classList.add('ui-on'), 3200); setTimeout(() => $('splash').remove(), 900); }, Math.max(0, 2600 - (performance.now() - t0)));
  if (localStorage.getItem('kovan-theme') === 'light') toggleTheme();

  renderAll();
  connectStream();
  refreshUsage(); setInterval(refreshUsage, 60e3);
  setInterval(() => { if (mode === 'live') renderLive(); else renderJobs(); }, 5000);
}

function showTip(id: string | null, x: number, y: number) {
  if (mode === 'live') { showLiveTip(id, x, y); return; }
  const tip = $('tip');
  if (!id) { tip.classList.remove('on'); return; }
  const w = st.workers.find(x => x.id === id)!; const c = deptOf(w.dept)!;
  const job = st.jobs.filter(j => (j.worker === id || j.pieces?.some(p => p.worker === id && p.state === 'working')) && ['working', 'approval'].includes(j.state)).pop();
  tip.classList.add('on');
  tip.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
  if (tip.dataset.id === id + (job?.id || '') + job?.state) return;
  tip.dataset.id = id + (job?.id || '') + job?.state;
  tip.innerHTML = `<div class="tip-h">${hexAvatar(w.name, c.color, 22)}<div><b>${esc(w.name)}</b><span>${esc(w.role)}${w.lead ? ' · department head' : ''} · ${esc(w.model || st.model)}</span></div></div>${job ? `<em class="${job.state}">${job.state === 'approval' ? icon('Hand', 12) + ' waiting for your OK' : icon('Sparkles', 12) + ' ' + esc(job.text.slice(0, 64))}</em>` : '<em class="idle">idle · click to open</em>'}`;
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('jobs', e => { st.jobs = JSON.parse((e as MessageEvent).data); renderAll(); });
  es.addEventListener('routines', e => { st.routines = JSON.parse((e as MessageEvent).data); renderAll(); });
  es.addEventListener('connectors', e => { st.connectors = JSON.parse((e as MessageEvent).data); renderLinks(); });
  es.addEventListener('pulse', e => { const p: Pulse = JSON.parse((e as MessageEvent).data); hive.pulse(p); if (p.type === 'write' && p.note) st.notes++; });
  es.addEventListener('chat', e => { const { worker, msg } = JSON.parse((e as MessageEvent).data); if (worker === chatWith) appendMsg(msg); });
  es.addEventListener('live', e => { liveSnap = JSON.parse((e as MessageEvent).data); st.live = liveSnap; if (mode === 'live') renderLive(); });
}

function renderAll() {
  if (mode === 'live') { renderLive(); return; }
  ensureHive(st.depts, st.workers, 'KNOWLEDGE VAULT');
  const states: Record<string, 'working' | 'approval'> = {};
  for (const j of st.jobs) {
    if (j.state === 'working') { if (j.worker) states[j.worker] = 'working'; j.pieces?.forEach(p => { if (p.state === 'working') states[p.worker] = 'working'; }); }
    if (j.state === 'approval' && j.worker) states[j.worker] = 'approval';
  }
  hive?.setStates(states);
  // transitions → toasts + floor ripple
  for (const j of st.jobs) {
    const prev = lastState.get(j.id);
    if (prev !== j.state) {
      if (!prev) hive?.ripple();
      if (prev && j.state === 'done') toast(j, 'done');
      if (prev && j.state === 'approval') toast(j, 'approval');
      lastState.set(j.id, j.state);
    }
  }
  // HUD
  const busy = Object.keys(states).length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  tween(document.querySelector('[data-n="busy"]'), st.jobs.filter(j => j.state === 'working' || j.state === 'queued').length);
  tween(document.querySelector('[data-n="today"]'), st.jobs.filter(j => j.state === 'done' && (j.finished || 0) >= today.getTime()).length);
  renderMetrics(today.getTime());
  $('mBusy').textContent = `${busy} of ${st.workers.length} agents busy`;
  ($('busyBar').firstElementChild as HTMLElement).style.width = `${(busy / Math.max(1, st.workers.length)) * 100}%`;
  for (const d of st.depts) {
    const s = deptStats(d.id, states);
    hive?.setDeptLoad(d.id, { working: s.working, queued: s.queued, approval: s.approval, size: s.team.length });
  }
  renderJobs(); renderLinks();
  if (sheet?.kind === 'board') paintBoard($('sheetBody'), st, pickJob);
  if (sheet?.kind === 'departments') paintDepartments($('sheetBody'));
  if (sheet?.kind === 'agents') paintAgents($('sheetBody'));
  if (hive?.focusedDept) renderDeptFocus(hive.focusedDept);
  if (sheet?.kind === 'calendar') sheet.refresh?.();
  if (chatWith) renderChatHeader();
}

function toast(j: Job, kind: 'done' | 'approval') {
  const w = st.workers.find(x => x.id === j.worker); if (!w || !document.body.classList.contains('ui-on')) return;
  const c = deptOf(w.dept)!;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${hexAvatar(w.name, c.color, 26)}<div><b>${esc(w.name)}</b> ${kind === 'done' ? 'finished' : 'needs your OK'}<span>${esc(j.text.slice(0, 70))}</span></div>${kind === 'done' ? icon('CircleCheck', 16) : icon('Hand', 16)}`;
  el.onclick = () => openChat(w.id, j.id);
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}

// ---------- activity ----------
const BUCKETS: Record<string, (j: Job) => boolean> = {
  active: j => ['working', 'queued'].includes(j.state),
  approval: j => j.state === 'approval',
  scheduled: j => j.state === 'scheduled',
  done: j => ['done', 'failed'].includes(j.state),
};
function renderJobs() {
  if (mode === 'live') return;
  const counts = Object.fromEntries(Object.entries(BUCKETS).map(([k, f]) => [k, st.jobs.filter(f).length]));
  const sched = counts.scheduled + st.routines.filter(r => !r.paused).length;
  const defs: [string, string, number][] = [['active', 'In flight', counts.active], ['approval', 'Approval', counts.approval], ['scheduled', 'Scheduled', sched], ['done', 'Completed', counts.done]];
  const chips = $('chips');
  if (!chips.children.length) {
    chips.innerHTML = defs.map(([k, l]) => `<button class="flt" data-f="${k}"><span>${l}</span><b data-v="0">0</b></button>`).join('');
    chips.querySelectorAll<HTMLElement>('.flt').forEach(c => c.onclick = () => { filter = c.dataset.f!; renderJobs(); });
  }
  defs.forEach(([k, , n]) => {
    const btn = chips.querySelector(`[data-f="${k}"]`)!;
    btn.classList.toggle('on', filter === k); btn.classList.toggle('alert', k === 'approval' && n > 0);
    tween(btn.querySelector('b'), n);
  });
  tween($('liveCount'), counts.active);
  const list = st.jobs.filter(BUCKETS[filter]).slice().reverse().slice(0, 50);
  let html = '';
  if (filter === 'scheduled') html += st.routines.map(routineCard).join('');
  html += list.map(jobCard).join('');
  if (filter === 'active') {
    const recent = st.jobs.filter(j => j.state === 'approval' || (j.state === 'done' && !(j as Job & { seeded?: boolean }).seeded)).slice().reverse().slice(0, 10);
    if (recent.length) html += `<div class="divider"><span>Just now</span></div>` + recent.map(jobCard).join('');
    recent.forEach(j => seen.add(j.id));
  }
  if (!html) html = `<div class="empty">${icon('Hexagon', 28, 1.25)}<p>${filter === 'active' ? 'All agents are idle.' : 'Nothing here yet.'}</p><small>${filter === 'active' ? 'Assign a task below.' : ''}</small></div>`;
  $('jobs').innerHTML = html;
  list.forEach(j => seen.add(j.id));
  $('jobs').querySelectorAll<HTMLElement>('[data-job]').forEach(el => el.onclick = e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) { e.stopPropagation(); jobAction(el.dataset.job!, act); return; }
    pickJob(el.dataset.job!);
  });
  $('jobs').querySelectorAll<HTMLElement>('[data-routine]').forEach(el => el.onclick = e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act; if (act) post(`/api/routines/${el.dataset.routine}/${act}`);
  });
}
function pickJob(id: string) { const j = st.jobs.find(x => x.id === id); if (sheet) closeSheet(); if (j?.worker) openChat(j.worker, id); }
function jobCard(j: Job) {
  const c = deptOf(j.dept);
  const fresh = !seen.has(j.id) ? ' enter' : '';
  const time = j.state === 'scheduled' && j.at ? new Date(j.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ago(j.finished || j.started || j.created);
  const acts = j.state === 'approval' ? `<div class="acts"><button data-act="approve" class="ok">${icon('Check', 13, 2.2)}Approve</button><button data-act="reject">${icon('RotateCcw', 13)}Rework</button></div>`
    : ['scheduled', 'queued'].includes(j.state) ? `<div class="acts"><button data-act="cancel">${icon('X', 13)}Cancel</button></div>` : '';
  const stateIcon = j.state === 'done' ? icon('CircleCheck', 13) : j.state === 'approval' ? icon('Hand', 13) : j.state === 'working' ? '<i class="spin"></i>' : icon('Clock', 13);
  return `<div class="job ${j.state}${fresh}" data-job="${j.id}" style="--c:${c?.color || '#888'}">
    ${j.worker ? hexAvatar(workerName(j.worker), c?.color || '#888') : '<span class="hexav ghost">·</span>'}
    <div class="job-main">
      <div class="top"><span class="who">${j.worker ? esc(workerName(j.worker)) : 'routing…'}</span>${c ? `<i class="tag dp" title="${esc(c.name)}${j.routed === 'auto' ? ' · auto-routed' : ''}">${esc(c.code)}</i>` : ''}${j.swarm ? `<i class="tag sw">${icon('Users', 11)}swarm</i>` : ''}${j.routineId ? `<i class="tag">${icon('Repeat', 11)}</i>` : ''}${j.late ? '<i class="tag late">late</i>' : ''}<span class="t">${time}</span><span class="st">${stateIcon}</span></div>
      <div class="txt">${esc(j.text)}</div>
      ${j.pieces ? `<div class="pieces">${j.pieces.map(p => `<span class="${p.state}">${esc(workerName(p.worker))}</span>`).join('')}</div>` : ''}
      ${jobMeta(j)}${j.state === 'working' ? '<div class="bar"><i></i></div>' : ''}${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}${acts}
    </div></div>`;
}
function routineCard(r: Routine) {
  const c = deptOf(r.dept);
  return `<div class="job routine" data-routine="${r.id}" style="--c:${c?.color || '#888'}">
    <span class="hexav ghost">${icon('Repeat', 13)}</span>
    <div class="job-main">
      <div class="top"><span class="who">${esc(c?.name || 'Auto')}</span>${r.needsOk ? `<i class="tag">${icon('Hand', 11)}OK</i>` : ''}${r.paused ? '<i class="tag">paused</i>' : ''}<span class="t">${describeRule(r.rule)}</span></div>
      <div class="txt">${esc(r.text)}</div>
      <div class="sub">${r.paused ? 'paused' : r.next ? 'next ' + new Date(r.next).toLocaleString([], { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
      <div class="acts"><button data-act="run">${icon('Play', 12)}Run</button>${r.paused ? `<button data-act="resume">${icon('Play', 12)}Resume</button>` : `<button data-act="pause">${icon('Pause', 12)}Pause</button>`}<button data-act="delete">${icon('Trash2', 12)}</button></div>
    </div></div>`;
}
async function jobAction(id: string, act: string) {
  if (act === 'reject') {
    const reason = prompt('What should change? (saved as a lesson for this agent)') ?? '';
    await post(`/api/jobs/${id}/reject`, { reason });
  } else await post(`/api/jobs/${id}/${act}`);
}

// ---------- command bar ----------
const task = $<HTMLTextAreaElement>('task');
const PLACEHOLDERS = ['Describe a task, and Kovan routes it to the right agent…', 'every weekday at 9am, triage new support tickets', 'as a team, plan the launch week for opportunity scoring v2', '@engineering review PR 482: rate limiter for the public API', 'reconcile October invoices against bank receipts'];
let ph = 0;
setInterval(() => { if (document.activeElement !== task && !task.value) { ph = (ph + 1) % PLACEHOLDERS.length; task.placeholder = PLACEHOLDERS[ph]; } }, 4000);
// ---------- department picker ----------
let deptChoice = '';
function renderDeptMenu() {
  const busy = (id: string) => deptStats(id).busyBees;
  $('dmenu').innerHTML = `<button type="button" data-d="" class="${deptChoice ? '' : 'on'}"><span class="di auto">${icon('Sparkles', 15)}</span><span class="dn"><b>Auto-route</b><small>the best-fit agent for the request</small></span></button>`
    + st.depts.map((d, i) => `<button type="button" data-d="${d.id}" class="${deptChoice === d.id ? 'on' : ''}" style="--c:${d.color}"><span class="di">${icon(d.icon, 15)}</span><span class="dn"><b>${esc(d.name)}</b><small>${esc(d.tr)} · ${esc(headOf(d.id)?.name || '')}</small></span><span class="dl">${busy(d.id) ? `<i></i>${busy(d.id)}` : ''}</span><kbd>${i + 1}</kbd></button>`).join('');
  $('dmenu').querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => { setDeptChoice(b.dataset.d!); $('dpick').classList.remove('open'); task.focus(); });
}
function setDeptChoice(id: string) {
  deptChoice = id;
  const d = deptOf(id);
  const btn = $('dpickBtn');
  btn.style.setProperty('--c', d?.color || 'var(--amber)');
  btn.classList.toggle('set', !!d);
  btn.querySelector('span')!.textContent = d ? d.name : 'Auto-route';
  renderDeptMenu(); refreshCommandHint();
}
$('dpickBtn').onclick = e => { e.stopPropagation(); renderDeptMenu(); $('dpick').classList.toggle('open'); };
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#dpick')) $('dpick').classList.remove('open'); });

function refreshCommandHint() {
  const text = task.value.trim();
  task.style.height = 'auto'; task.style.height = Math.min(150, task.scrollHeight) + 'px';
  const parts: string[] = [];
  if (text) {
    const sw = detectSwarm(text);
    const sched = parseSchedule(sw.task);
    const picked = pickDepartment(text, st?.depts || []);
    const target = picked?.dept || deptChoice;
    const guess = !target && st ? guessDepartment(text, st.depts, st.workers) : '';
    const d = deptOf(target || guess);
    if (d) parts.push(`<span class="h d" style="--c:${d.color}">${icon('ArrowUpRight', 12)} ${target ? '' : 'auto · '}${esc(d.name)}</span>`);
    if (sched) parts.push(`<span class="h s">${icon('Repeat', 12)} ${describeRule(sched.rule)}</span>`);
    if (sw.swarm || swarm) parts.push(`<span class="h w">${icon('Users', 12)} swarm</span>`);
    if (isOutbound(text)) parts.push(`<span class="h o">${icon('Hand', 12)} waits for your OK</span>`);
  }
  $('hint').innerHTML = parts.join('') || '<span class="keys"><kbd>↵</kbd> send <kbd>⇧↵</kbd> new line <kbd>/</kbd> focus</span>';
  $('cmd').classList.toggle('has-text', !!text);
}
task.addEventListener('input', refreshCommandHint);
task.addEventListener('focus', () => $('cmd').classList.add('focus'));
task.addEventListener('blur', () => $('cmd').classList.remove('focus'));
task.addEventListener('keydown', e => { if (e.key === 'Tab' && st) { e.preventDefault(); const ids = ['', ...st.depts.map(d => d.id)]; setDeptChoice(ids[(ids.indexOf(deptChoice) + (e.shiftKey ? ids.length - 1 : 1)) % ids.length]); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $<HTMLFormElement>('cmd').requestSubmit(); } if (e.key === 'Escape') task.blur(); });
$('swarm').onclick = () => { swarm = !swarm; $('swarm').classList.toggle('on', swarm); refreshCommandHint(); };
$('cmd').addEventListener('submit', async e => {
  e.preventDefault();
  const text = task.value.trim(); if (!text) return;
  $('go').setAttribute('disabled', '');
  try {
    const r = await post<{ job?: Job; routine?: Routine }>('/api/jobs', { text, dept: deptChoice, model: ($('model') as HTMLSelectElement).value, effort: ($('effort') as HTMLSelectElement).value, swarm });
    task.value = ''; refreshCommandHint();
    $('cmd').classList.remove('sent'); void $('cmd').offsetWidth; $('cmd').classList.add('sent');
    filter = r.routine ? 'scheduled' : 'active'; renderJobs();
  } catch (err) { alert(String(err)); }
  $('go').removeAttribute('disabled');
});
refreshCommandHint();

// ---------- links + usage ----------
function renderLinks() {
  const c = st.connectors;
  $('links').innerHTML = `<span class="lh">${icon('Plug', 13)} Links</span>` + (c.items.length ? c.items.map(i => `<span class="lk ${i.usable ? 'ok' : 'off'}" title="${esc(i.name)} — ${esc(i.status)}">${esc(i.name.slice(0, 2).toUpperCase())}</span>`).join('') : `<span class="none">${esc(c.note || 'none')}</span>`);
}
async function refreshUsage() {
  try {
    const u = await get<{ source: string; session: number; week: number; kovan: { session: number; week: number } }>('/api/usage');
    $('m5').textContent = fmtTokens(u.session); $('m7').textContent = fmtTokens(u.week);
    $('meter').title = u.source === 'claude-code-logs' ? `Tokens recorded by Claude Code on this machine (Kovan: ${fmtTokens(u.kovan.session)} / ${fmtTokens(u.kovan.week)})` : 'Tokens used by Kovan runs (no Claude Code logs found)';
  } catch {}
}

// ---------- chat ----------
async function openChat(id: string, jobId?: string) {
  chatWith = id;
  $('dfocus').classList.remove('open'); document.body.classList.remove('dept-focus');
  hive.focusBee(id);
  const el = $('chat');
  el.innerHTML = '';
  renderChatHeader();
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('chatting');
  const msgs = await get<ChatMsg[]>(`/api/chat/${id}`);
  const box = el.querySelector('.msgs')!;
  box.innerHTML = '';
  if (!msgs.length) appendMsg({ from: 'system', text: `Direct line to ${workerName(id)}. Start with **revise:** to rework the last deliverable; the correction is saved as a standing rule.`, t: Date.now() });
  msgs.slice(-40).forEach(appendMsg);
  if (jobId) box.querySelector(`[data-j="${jobId}"]`)?.scrollIntoView({ block: 'start' });
}
function renderChatHeader() {
  const w = st.workers.find(x => x.id === chatWith)!; const c = deptOf(w.dept)!;
  const el = $('chat');
  if (!el.querySelector('.msgs')) {
    el.innerHTML = `<div class="ch-head"></div><div class="ch-rt"></div><div class="msgs"></div>
      <form class="ch-in"><textarea rows="1" placeholder="Message ${esc(w.name)}…  (revise: …)"></textarea><button class="send sm">${icon('Send', 15)}</button></form>`;
    const f = el.querySelector('form')!; const ta = f.querySelector('textarea')!;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    f.onsubmit = async e => { e.preventDefault(); const m = ta.value.trim(); if (!m || !chatWith) return; ta.value = ''; await post(`/api/chat/${chatWith}`, { message: m }); };
  }
  const skills = st.skills.filter(s => s.workers.includes(w.id) || s.depts.includes(w.dept)).map(s => s.name);
  const busy = st.jobs.find(j => j.worker === w.id && j.state === 'working');
  el.querySelector('.ch-head')!.innerHTML = `${hexAvatar(w.name, c.color, 44)}<div class="who"><b>${esc(w.name)}</b>${w.lead ? '<i class="lead">head</i>' : ''}<span>${esc(w.role)} · <em style="color:${c.color}">${esc(c.name)}</em></span></div><button class="ibtn x" title="Close (Esc)">${icon('X', 17)}</button>
    <p class="does">${esc(w.does)}</p>
    <div class="chips2">${busy ? `<span class="c busy"><i class="spin"></i>working</span>` : '<span class="c">idle</span>'}${skills.map(s => `<span class="c">${icon('BookOpen', 11)}${esc(s)}</span>`).join('')}${(w.skills || []).slice(0, 3).map(s => `<span class="c dim">${esc(s)}</span>`).join('')}</div>`;
  el.querySelector('.x')!.addEventListener('click', closeChat);
  const rts = st.routines.filter(r => st.jobs.some(j => j.routineId === r.id && j.worker === w.id));
  el.querySelector('.ch-rt')!.innerHTML = rts.map(r => `<span>${icon('Repeat', 12)} ${esc(r.text.slice(0, 40))} · ${describeRule(r.rule)}</span>`).join('');
  const waiting = st.jobs.filter(j => j.worker === w.id && j.state === 'approval');
  el.querySelectorAll('.msg [data-appr]').forEach(b => { if (!waiting.some(j => j.id === (b as HTMLElement).dataset.appr)) b.parentElement?.remove(); });
}
function appendMsg(m: ChatMsg) {
  const box = $('chat').querySelector('.msgs'); if (!box) return;
  const d = document.createElement('div');
  d.className = `msg ${m.from}`;
  if (m.job) d.dataset.j = m.job;
  const job = m.job ? st.jobs.find(j => j.id === m.job) : undefined;
  d.innerHTML = `<div class="md">${md(m.text)}</div>${job?.state === 'approval' ? `<div class="appr"><button data-appr="${job.id}" class="ok">${icon('Check', 13, 2.2)}Approve & run</button><button data-rej="${job.id}">${icon('RotateCcw', 13)}Rework</button></div>` : ''}<small>${new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${job?.note ? ` · <a class="wl">${icon('BookOpen', 11)} saved to vault</a>` : ''}</small>`;
  d.querySelector('[data-appr]')?.addEventListener('click', () => jobAction(job!.id, 'approve'));
  d.querySelector('[data-rej]')?.addEventListener('click', () => jobAction(job!.id, 'reject'));
  d.querySelectorAll<HTMLElement>('a.wl').forEach(a => a.addEventListener('click', () => openSheet('vault')));
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}
function closeChat() { chatWith = null; $('chat').classList.remove('open'); document.body.classList.remove('chatting'); leaveDept(); }

// ---------- sheets + nav ----------
function setNav(view: string) {
  const nav = $('nav');
  nav.querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const on = nav.querySelector<HTMLElement>('button.on')!;
  const ind = nav.querySelector<HTMLElement>('.seg-ind')!;
  ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`;
}
async function openSheet(kind: string) {
  sheet?.stop?.();
  const body = $('sheetBody');
  body.innerHTML = '';
  $('sheet').classList.add('open');
  $('sheet').dataset.kind = kind;
  sheet = { kind };
  setNav(kind);
  if (kind === 'vault') sheet.stop = await openGraph(body, st, () => {});
  if (kind === 'calendar') sheet.refresh = openCalendar(body, () => st, pickJob);
  if (kind === 'board') paintBoard(body, st, pickJob);
  if (kind === 'departments') paintDepartments(body);
  if (kind === 'agents') { if (mode === 'live') paintSessions(body, liveSnap, id => { closeSheet(); openLiveBee(id); }); else paintAgents(body); }
}
function closeSheet() { sheet?.stop?.(); sheet = null; $('sheet').classList.remove('open'); setNav('hive'); setTimeout(() => { if (!sheet) $('sheetBody').innerHTML = ''; }, 300); }
$('sheetClose').onclick = closeSheet;
$('nav').querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => (b.dataset.view === 'hive' ? closeSheet() : sheet?.kind === b.dataset.view ? closeSheet() : openSheet(b.dataset.view!)));
addEventListener('resize', () => setNav(sheet?.kind || 'hive'));
requestAnimationFrame(() => setNav('hive'));

function toggleTheme() {
  const light = document.body.classList.toggle('light');
  localStorage.setItem('kovan-theme', light ? 'light' : 'dark');
  hive?.applyTheme(light ? 'light' : 'dark');
}
let focusMode = false;
function toggleFocus() { focusMode = !focusMode; document.body.classList.toggle('focus', focusMode); hive.setDim(focusMode); }

document.querySelectorAll<HTMLButtonElement>('.topbar [data-k]').forEach(b => b.onclick = () => key(b.dataset.k!));
function key(k: string) {
  if (mode === 'live' && (k === 'v' || k === 'k' || k === 'b' || k === 'd')) return;
  if (k === 'v') return sheet?.kind === 'vault' ? closeSheet() : openSheet('vault');
  if (k === 'k') return sheet?.kind === 'calendar' ? closeSheet() : openSheet('calendar');
  if (k === 'b') return sheet?.kind === 'board' ? closeSheet() : openSheet('board');
  if (k === 'd') return sheet?.kind === 'departments' ? closeSheet() : openSheet('departments');
  if (k === 'a') return sheet?.kind === 'agents' ? closeSheet() : openSheet('agents');
  if (k === 't') return toggleTheme();
  if (k === 'f') return toggleFocus();
}
addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
  if (e.key === 'Escape') {
    if (document.querySelector('.plan')) document.querySelector('.plan')!.remove();
    else if (sheet) closeSheet();
    else if (chatWith || $('chat').classList.contains('open')) closeChat();
    else leaveDept();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !st) return;
  if (e.key === '/') { e.preventDefault(); task.focus(); return; }
  const n = Number(e.key);
  if ($('dpick').classList.contains('open') && n >= 0 && n <= st.depts.length) { setDeptChoice(n ? st.depts[n - 1].id : ''); $('dpick').classList.remove('open'); task.focus(); return; }
  const zones = mode === 'live' ? liveCrew(liveSnap).depts : st.depts;
  if (n >= 1 && n <= zones.length) { (mode === 'live' ? flyToProject : flyToDept)(zones[n - 1].id); return; }
  if (e.key === '0') { leaveDept(); return; }
  key(e.key.toLowerCase());
});

// ---------- departments ----------
type WS = Record<string, 'working' | 'approval'>;
function liveStates(): WS {
  const states: WS = {};
  for (const j of st.jobs) {
    if (j.state === 'working') { if (j.worker) states[j.worker] = 'working'; j.pieces?.forEach(p => { if (p.state === 'working') states[p.worker] = 'working'; }); }
    if (j.state === 'approval' && j.worker) states[j.worker] = 'approval';
  }
  return states;
}
const headOf = (id: string) => st.workers.find(w => w.dept === id && w.lead) || st.workers.find(w => w.dept === id);
function deptStats(id: string, states: WS = liveStates()) {
  const team = st.workers.filter(w => w.dept === id).sort((a, b) => Number(!!b.lead) - Number(!!a.lead));
  const jobs = st.jobs.filter(j => j.dept === id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = jobs.filter(j => j.state === 'done');
  return {
    team, head: headOf(id), states,
    busyBees: team.filter(w => states[w.id] === 'working').length,
    working: jobs.filter(j => j.state === 'working').length,
    queued: jobs.filter(j => j.state === 'queued' || j.state === 'scheduled').length + st.routines.filter(r => r.dept === id && !r.paused).length,
    approval: jobs.filter(j => j.state === 'approval').length,
    done: done.length,
    doneToday: done.filter(j => (j.finished || 0) >= today.getTime()).length,
    recent: done.slice().sort((a, b) => (b.finished || 0) - (a.finished || 0)).slice(0, 2),
  };
}
function memberDot(w: State['workers'][number], d: Dept, states: WS) {
  const s = states[w.id] || 'idle';
  return `<button class="mem ${s}" data-w="${w.id}" title="${esc(w.name)} — ${esc(w.role)} · ${s}">${hexAvatar(w.name, d.color, 30)}</button>`;
}
function deptCardHTML(d: Dept, compact = false) {
  const s = deptStats(d.id);
  const h = s.head!;
  const hs = s.states[h.id] || 'idle';
  const load = Math.round((s.busyBees / Math.max(1, s.team.length)) * 100);
  return `<article class="dcard${compact ? ' compact' : ''}" data-dept="${d.id}" style="--c:${d.color}">
    <header><span class="dtile">${icon(d.icon, 20)}</span><div class="dtitle"><b>${esc(d.name)}</b><span>${esc(d.tr)}</span></div><code>${esc(d.code)}</code></header>
    ${compact ? '' : `<p class="mission">${esc(d.mission)}</p>`}
    <div class="dhead" data-w="${h.id}">${hexAvatar(h.name, d.color, 40)}<div><small>${icon('Crown', 11)} Department head</small><b>${esc(h.name)}</b><span>${esc(h.role)}</span></div><em class="st ${hs}">${hs === 'working' ? '<i class="spin"></i>working' : hs === 'approval' ? 'needs OK' : 'idle'}</em></div>
    <div class="dteam"><small>Team · ${s.team.length - 1}<span>${load}% busy</span></small><div>${s.team.filter(w => w !== h).map(w => memberDot(w, d, s.states)).join('')}</div></div>
    <div class="dstats">
      <div><b data-v="0" data-k="working">${s.working}</b><small>Active</small></div>
      <div><b data-v="0" data-k="queued">${s.queued}</b><small>Queued</small></div>
      <div class="${s.approval ? 'alert' : ''}"><b data-v="0" data-k="approval">${s.approval}</b><small>Needs OK</small></div>
      <div><b data-v="0" data-k="done">${s.done}</b><small>Done</small></div>
    </div>
    <div class="dload"><i style="width:${load}%"></i></div>
    ${compact ? '' : `<div class="drecent"><small>Recent output</small>${s.recent.length ? s.recent.map(j => `<button class="out" data-job="${j.id}">${icon('CircleCheck', 12)}<span>${esc(j.text)}</span><em>${esc(workerName(j.worker))} · ${ago(j.finished || j.created)}</em></button>`).join('') : '<p class="none">Nothing delivered yet.</p>'}</div>`}
    <footer><button class="dbtn fly" data-fly="${d.id}">${icon('LocateFixed', 14)}${compact ? 'Overview' : 'Fly to department'}</button><button class="dbtn ask" data-ask="${d.id}">${icon('Send', 13)}Assign a task</button></footer>
  </article>`;
}
function wireDeptCard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-w]').forEach(el => el.onclick = e => { e.stopPropagation(); if (sheet) closeSheet(); openChat(el.dataset.w!); });
  root.querySelectorAll<HTMLElement>('[data-job]').forEach(el => el.onclick = e => { e.stopPropagation(); pickJob(el.dataset.job!); });
  root.querySelectorAll<HTMLElement>('[data-fly]').forEach(el => el.onclick = e => { e.stopPropagation(); if (el.closest('.dfocus')) leaveDept(); else flyToDept(el.dataset.fly!); });
  root.querySelectorAll<HTMLElement>('[data-ask]').forEach(el => el.onclick = e => { e.stopPropagation(); if (sheet) closeSheet(); setDeptChoice(el.dataset.ask!); task.focus(); });
}
function paintDepartments(root: HTMLElement) {
  const totals = st.depts.map(d => deptStats(d.id));
  const head = `<div class="sheet-head"><h2>Departments</h2><span class="muted">${st.depts.length} departments · ${st.workers.length} agents · ${totals.reduce((a, s) => a + s.working, 0)} active now</span></div>`;
  if (!root.querySelector('.dgrid')) {
    root.innerHTML = `${head}<div class="dgrid">${st.depts.map(d => deptCardHTML(d)).join('')}</div>`;
    root.querySelectorAll<HTMLElement>('.dcard').forEach(el => el.onclick = () => flyToDept(el.dataset.dept!));
    wireDeptCard(root);
    return;
  }
  // live refresh: replace the inner parts but keep the cards (so hover and entry animations stay calm)
  root.querySelector('.sheet-head')!.outerHTML = head;
  for (const d of st.depts) {
    const card = root.querySelector<HTMLElement>(`.dcard[data-dept="${d.id}"]`)!;
    const tmp = document.createElement('div'); tmp.innerHTML = deptCardHTML(d);
    const fresh = tmp.firstElementChild as HTMLElement;
    for (const sel of ['.dhead', '.dteam', '.dload', '.drecent']) card.querySelector(sel)!.replaceWith(fresh.querySelector(sel)!);
    card.querySelectorAll<HTMLElement>('.dstats b').forEach(b => tween(b, Number(fresh.querySelector<HTMLElement>(`.dstats b[data-k="${b.dataset.k}"]`)!.textContent)));
    card.querySelector('.dstats > div:nth-child(3)')!.classList.toggle('alert', deptStats(d.id).approval > 0);
    wireDeptCard(card);
  }
}
function renderDeptFocus(id: string) {
  const d = deptOf(id); if (!d) return;
  const el = $('dfocus');
  el.innerHTML = deptCardHTML(d, true);
  wireDeptCard(el);
}
function flyToDept(id: string) {
  if (sheet) closeSheet();
  if (chatWith) { chatWith = null; $('chat').classList.remove('open'); document.body.classList.remove('chatting'); }
  hive.focusDept(id);
  renderDeptFocus(id);
  $('dfocus').classList.add('open');
  document.body.classList.add('dept-focus');
}
function leaveDept() {
  $('dfocus').classList.remove('open');
  document.body.classList.remove('dept-focus');
  hive?.focusDept(null);
}

// ---------- metrics ----------
/** Rough blended list price per 1M tokens, used only for the "est." cost hint. */
const RATE: Record<string, number> = { haiku: 2, sonnet: 6, opus: 30 };
const fmtDur = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : ms < 60e3 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60e3)}m ${String(Math.round((ms % 60e3) / 1000)).padStart(2, '0')}s`;
const latencyOf = (j: Job) => j.started && j.finished && j.finished >= j.started ? j.finished - j.started : null;
function jobStats(list: Job[]) {
  const lat = list.map(latencyOf).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return { avg: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null, p95: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : null, n: lat.length };
}
function renderMetrics(todayStart: number) {
  const done = st.jobs.filter(j => j.state === 'done');
  const lastHour = done.filter(j => (j.finished || 0) >= Date.now() - 3600e3).length;
  $('mToday').textContent = `+${lastHour} in the last hour`;
  const recent = done.slice().sort((a, b) => (b.finished || 0) - (a.finished || 0)).slice(0, 40);
  const s = jobStats(recent);
  $('mLat').textContent = s.avg === null ? '—' : fmtDur(s.avg);
  $('mP95').textContent = s.p95 === null ? 'no runs yet' : `p95 ${fmtDur(s.p95)} · last ${s.n}`;
  const todayJobs = st.jobs.filter(j => (j.started || j.created) >= todayStart);
  const tok = todayJobs.reduce((a, j) => a + (j.tokens || 0), 0);
  const cost = todayJobs.reduce((a, j) => a + (j.tokens || 0) / 1e6 * (RATE[j.modelUsed || st.model] ?? RATE.sonnet), 0);
  $('mTok').textContent = fmtTokens(tok);
  $('mCost').textContent = `≈ $${cost.toFixed(2)} est.`;
  const ended = st.jobs.filter(j => j.state === 'done' || j.state === 'failed').slice(-100);
  const failed = ended.filter(j => j.state === 'failed').length;
  $('mOk').textContent = ended.length ? `${((1 - failed / ended.length) * 100).toFixed(1)}%` : '—';
  $('mGate').textContent = `${st.jobs.filter(j => j.state === 'approval').length} awaiting approval`;
}
function jobMeta(j: Job) {
  const bits: string[] = [];
  if (j.modelUsed) bits.push(`${icon('Cpu', 10)}${esc(j.modelUsed)}${j.effortUsed ? ' · ' + esc(j.effortUsed) : ''}`);
  const l = latencyOf(j); if (l !== null && j.state === 'done') bits.push(`${icon('Timer', 10)}${fmtDur(l)}`);
  if (j.tokens) bits.push(`${icon('Coins', 10)}${fmtTokens(j.tokens)} tok`);
  return bits.length ? `<div class="meta">${bits.map(b => `<span>${b}</span>`).join('')}</div>` : '';
}

// ---------- agents ----------
function paintAgents(root: HTMLElement) {
  const states = liveStates();
  const counts = { working: 0, approval: 0, idle: 0 };
  for (const w of st.workers) counts[(states[w.id] || 'idle') as keyof typeof counts]++;
  const head = `<div class="sheet-head"><h2>Agents</h2><span class="muted">${st.workers.length} agents · <b class="c-work">${counts.working} working</b> · <b class="c-appr">${counts.approval} awaiting approval</b> · ${counts.idle} idle</span></div>`;
  const card = (w: State['workers'][number]) => {
    const d = deptOf(w.dept)!; const s = states[w.id] || 'idle';
    const mine = st.jobs.filter(j => j.worker === w.id || j.pieces?.some(p => p.worker === w.id));
    const cur = mine.filter(j => ['working', 'approval'].includes(j.state)).pop();
    const done = mine.filter(j => j.state === 'done');
    const last = done.slice().sort((a, b) => (b.finished || 0) - (a.finished || 0))[0];
    const js = jobStats(done.slice(-20));
    const tok = mine.reduce((a, j) => a + (j.tokens || 0), 0);
    const label = s === 'working' ? '<i class="spin"></i>Working' : s === 'approval' ? `${icon('Hand', 11)}Awaiting approval` : 'Idle';
    return `<article class="acard ${s}" data-w="${w.id}" style="--c:${d.color}">
      <header>${hexAvatar(w.name, d.color, 36)}<div class="an"><b>${esc(w.name)}</b><span>${esc(w.role)}</span></div><em class="ast ${s}">${label}</em></header>
      <div class="arow"><i class="tag dp">${esc(d.code)}</i>${w.lead ? `<i class="tag">${icon('Crown', 10)}head</i>` : ''}<span class="chip-m">${icon('Cpu', 11)}${esc(w.model || st.model)}<small>${esc(w.effort || 'auto')}</small></span></div>
      <p class="anow">${cur ? `${icon('Sparkles', 11)}${esc(cur.text)}` : last ? `<span class="muted">Last:</span> ${esc(last.text)}` : '<span class="muted">No tasks yet</span>'}</p>
      <footer><div><b>${done.length}</b><small>completed</small></div><div><b>${js.avg === null ? '—' : fmtDur(js.avg)}</b><small>avg latency</small></div><div><b>${fmtTokens(tok)}</b><small>tokens</small></div></footer>
    </article>`;
  };
  const body = `${st.depts.map(d => `<section class="agroup" style="--c:${d.color}"><h3><i></i>${esc(d.name)}<small>${esc(d.mission)}</small></h3><div class="acards">${st.workers.filter(w => w.dept === d.id).sort((a, b) => Number(!!b.lead) - Number(!!a.lead)).map(card).join('')}</div></section>`).join('')}`;
  const grid = root.querySelector('.agrid');
  if (grid) { root.querySelector('.sheet-head')!.outerHTML = head; grid.innerHTML = body; }
  else root.innerHTML = `${head}<div class="agrid">${body}</div>`;
  root.querySelectorAll<HTMLElement>('.acard').forEach(el => el.onclick = () => { closeSheet(); openChat(el.dataset.w!); });
}

function applyModeChrome() {
  document.body.classList.toggle('mode-live', mode === 'live');
  document.body.classList.toggle('mode-company', mode === 'company');
  $('modeBtn').textContent = mode === 'live' ? 'Company' : 'Live hive';
  $('paneTitle').textContent = mode === 'live' ? 'Needs you' : 'Activity timeline';
  const agents = document.querySelector('#nav button[data-view="agents"] span');
  if (agents) agents.textContent = mode === 'live' ? 'Sessions' : 'Agents';
  const labs = mode === 'live'
    ? ['Working', 'Needs you', 'Stuck', 'Idle', 'Projects']
    : ['In flight', 'Completed today', 'Avg latency', 'Tokens today', 'Success rate'];
  labs.forEach((label, i) => {
    const el = document.getElementById('lab' + (i + 1));
    if (!el) return;
    const ic = el.querySelector('svg');
    el.textContent = '';
    if (ic) el.append(ic, ' ' + label);
  });
  $('bizname').textContent = mode === 'live' ? 'Live hive' : st.name;
  $('chips').innerHTML = '';
  $('chips').dataset.mode = '';
}
function setMode(next: 'live' | 'company') {
  if (next === mode) return;
  mode = next;
  sessionStorage.setItem('kovan-mode', next);
  if (sheet) closeSheet();
  if (chatWith) closeChat();
  leaveDept();
  applyModeChrome();
  renderAll();
}
function showLiveTip(id: string | null, x: number, y: number) {
  const tip = $('tip');
  if (!id) { tip.classList.remove('on'); return; }
  const bee = liveSnap.sessions.find(s => s.id === id);
  if (!bee) { tip.classList.remove('on'); return; }
  const color = liveSnap.zones.find(z => z.id === bee.zone)?.color || '#f5b13d';
  tip.classList.add('on');
  tip.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
  const key = id + bee.state + bee.activity;
  if (tip.dataset.id === key) return;
  tip.dataset.id = key;
  const line = bee.state === 'needs-you' ? 'needs you' : bee.state;
  tip.innerHTML = `<div class="tip-h">${hexAvatar(bee.name, color, 22)}<div><b>${esc(bee.name)}</b><span>${esc(bee.project)} · ${esc(line)}</span></div></div><em class="${bee.state === 'needs-you' ? 'approval' : bee.state}">${esc((bee.activity || bee.role).slice(0, 80))}</em>`;
}
async function answerPermit(id: string, behavior: 'allow' | 'deny' | 'always') {
  try { await post('/api/live/answer', { id, behavior }); } catch { /* the hook may already have timed out */ }
  try { liveSnap = await get<LiveSnap>('/api/live'); } catch { /* keep the last snapshot */ }
  if (mode === 'live') renderLive();
}
function renderLive() {
  const pop = liveCrew(liveSnap);
  ensureHive(pop.depts, pop.workers, 'LIVE HIVE');
  const states: Record<string, 'working' | 'approval' | 'stuck'> = {};
  for (const bee of liveSnap.sessions) if (bee.state !== 'idle') states[bee.id] = bee.state === 'needs-you' ? 'approval' : bee.state;
  hive?.setStates(states);
  for (const zone of liveSnap.zones) {
    const bees = liveSnap.sessions.filter(s => s.zone === zone.id);
    hive?.setDeptLoad(zone.id, {
      working: bees.filter(b => b.state === 'working').length,
      stuck: bees.filter(b => b.state === 'stuck').length,
      queued: 0,
      approval: bees.filter(b => b.state === 'needs-you').length,
      size: Math.max(1, bees.length),
    });
  }
  noteNewPermits(liveSnap.queue);
  const counts = {
    needs: liveSnap.queue.length,
    working: liveSnap.sessions.filter(s => s.state === 'working').length,
    stuck: liveSnap.sessions.filter(s => s.state === 'stuck').length,
    idle: liveSnap.sessions.filter(s => s.state === 'idle').length,
  };
  const chips = $('chips');
  if (chips.dataset.mode !== 'live') {
    chips.dataset.mode = 'live';
    chips.innerHTML = ([['needs', 'Needs you'], ['working', 'Working'], ['stuck', 'Stuck'], ['idle', 'Idle']] as const).map(([k, l]) => `<button class="flt" data-f="${k}"><span>${l}</span><b data-v="0">0</b></button>`).join('');
    chips.querySelectorAll<HTMLElement>('.flt').forEach(c => c.onclick = () => { liveFilter = c.dataset.f || 'needs'; renderLive(); });
  }
  ([['needs', counts.needs], ['working', counts.working], ['stuck', counts.stuck], ['idle', counts.idle]] as const).forEach(([k, n]) => {
    const btn = chips.querySelector(`[data-f="${k}"]`);
    if (!btn) return;
    btn.classList.toggle('on', liveFilter === k);
    btn.classList.toggle('alert', k === 'needs' && n > 0);
    tween(btn.querySelector('b'), n);
  });
  tween($('liveCount'), counts.working + counts.needs);
  paintQueue($('jobs'), liveSnap, liveFilter, answerPermit, openLiveBee);
  paintPermit($('permit'), liveSnap, answerPermit, openLiveBee);
  tween(document.querySelector('[data-n="busy"]'), counts.working);
  tween(document.querySelector('[data-n="today"]'), counts.needs);
  $('mLat').textContent = String(counts.stuck);
  $('mTok').textContent = String(counts.idle);
  $('mOk').textContent = String(liveSnap.zones.length);
  $('mBusy').textContent = liveSnap.hooked ? 'hooks' : liveSnap.source === 'logs' ? 'from session logs' : st.backend === 'demo' ? 'simulated' : 'quiet';
  $('mToday').textContent = 'sorted by wait';
  $('mP95').textContent = counts.stuck ? 'rate limit or error' : 'none';
  $('mCost').textContent = st.backend === 'demo' ? 'demo sessions' : (liveSnap.hooked ? 'exact, from hooks' : 'inferred from logs');
  $('mGate').textContent = counts.needs ? `${counts.needs} waiting` : 'clear';
  const busyBees = counts.working + counts.needs;
  ($('busyBar').firstElementChild as HTMLElement).style.width = `${(busyBees / Math.max(1, liveSnap.sessions.length)) * 100}%`;
  if (sheet?.kind === 'agents') paintSessions($('sheetBody'), liveSnap, id => { closeSheet(); openLiveBee(id); });
  const open = $('chat');
  if (open.classList.contains('open') && open.dataset.bee) {
    const bee = liveSnap.sessions.find(s => s.id === open.dataset.bee);
    const mark = (bee?.state || '') + (bee?.permission?.id || '');
    if (bee && open.dataset.state !== mark) openLiveBee(bee.id);
  }
}
function openLiveBee(id: string) {
  const bee = liveSnap.sessions.find(s => s.id === id);
  if (!bee) return;
  chatWith = null;
  hive?.focusBee(id);
  const color = liveSnap.zones.find(z => z.id === bee.zone)?.color || '#f5b13d';
  const permit = liveSnap.queue.find(q => q.beeId === id);
  const el = $('chat');
  el.innerHTML = `<div class="ch-head">${hexAvatar(bee.name, color, 44)}<div class="who"><b>${esc(bee.name)}</b><span>${esc(bee.role)} · <em style="color:${color}">${esc(bee.project)}</em></span></div><button class="ibtn x" title="Close (Esc)">${icon('X', 17)}</button>
    <p class="does">${esc(bee.activity || 'Quiet')}</p>
    <div class="chips2"><span class="c">${esc(bee.state)}</span><span class="c dim">${esc(bee.source === 'codex' ? 'Codex' : 'Claude Code')}</span></div></div>
    <div class="msgs">${permit ? permitCard(permit, bee) : `<div class="msg system"><div class="md">${esc(bee.attention || 'This session is not waiting on you.')}</div></div>`}</div>`;
  el.dataset.bee = id;
  el.dataset.state = bee.state + (permit?.id || '');
  el.classList.add('open');
  document.body.classList.add('chatting');
  el.querySelector('.x')!.addEventListener('click', closeChat);
  el.querySelectorAll<HTMLElement>('[data-go]').forEach(btn => btn.onclick = () => { if (permit) answerPermit(permit.id, btn.dataset.go as 'allow' | 'deny' | 'always'); });
}
function flyToProject(id: string) {
  if (sheet) closeSheet();
  if ($('chat').classList.contains('open')) closeChat();
  hive.focusDept(id);
  const zone = liveSnap.zones.find(z => z.id === id);
  if (!zone) return;
  const bees = liveSnap.sessions.filter(s => s.zone === id);
  $('dfocus').innerHTML = `<article class="dcard compact" style="--c:${zone.color}"><header><span class="dtile">${icon('Folder', 20)}</span><div class="dtitle"><b>${esc(zone.name)}</b><span>${zone.source === 'codex' ? 'Codex' : 'Claude Code'}</span></div></header>
    <p class="mission">${bees.length} session${bees.length === 1 ? '' : 's'} in this project.</p>
    <div class="dteam"><div>${bees.map(b => `<button class="mem ${b.state === 'needs-you' ? 'approval' : b.state}" data-bee="${esc(b.id)}" title="${esc(b.name)}">${hexAvatar(b.name, zone.color, 30)}</button>`).join('')}</div></div>
    <footer><button class="dbtn fly" id="leaveLive">${icon('LocateFixed', 14)}Overview</button></footer></article>`;
  $('dfocus').classList.add('open');
  document.body.classList.add('dept-focus');
  $('dfocus').querySelectorAll<HTMLElement>('[data-bee]').forEach(el => el.onclick = () => openLiveBee(el.dataset.bee || ''));
  document.getElementById('leaveLive')?.addEventListener('click', leaveDept);
}
$('modeBtn').onclick = () => setMode(mode === 'live' ? 'company' : 'live');

boot().catch(err => { $('splash')?.remove(); app.insertAdjacentHTML('beforeend', `<div class="fatal">${mark(48, 'ft')}<p>Could not reach the Kovan server.</p><code>npm start</code><small>${esc(String(err))}</small></div>`); });
