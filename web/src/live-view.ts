// Live hive panels: project zones, session bees, and the Needs you approval card.
import { esc } from './md';
import { icon } from './icons';
import type { Dept, Worker, LiveSnap, LiveBee, LiveQueueItem } from './types';

export function liveCrew(snap: LiveSnap): { depts: Dept[]; workers: Worker[] } {
  const depts: Dept[] = snap.zones.map(z => ({
    id: z.id,
    name: z.name,
    tr: z.source === 'codex' ? 'Codex' : 'Claude Code',
    code: z.name.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'SES',
    color: z.color,
    icon: 'Folder',
    mission: '',
  }));
  const workers: Worker[] = [];
  const leads = new Set<string>();
  for (const bee of snap.sessions) {
    const lead = bee.kind === 'session' && !leads.has(bee.zone);
    if (lead) leads.add(bee.zone);
    workers.push({
      id: bee.id, dept: bee.zone, lead, name: bee.name,
      role: bee.kind === 'subagent' ? 'subagent' : (bee.model || bee.role),
      does: bee.activity, model: bee.model,
    });
  }
  return { depts, workers };
}

const waited = (since: number) => {
  const s = Math.max(0, (Date.now() - since) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

function diffHtml(diff: string) {
  if (!diff) return '';
  const lines = diff.split('\n').slice(0, 80).map(line => {
    const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    return `<span class="${cls}">${esc(line)}</span>`;
  });
  return `<pre class="diff">${lines.join('\n')}</pre>`;
}

export function permitCard(item: LiveQueueItem, bee?: LiveBee) {
  const who = esc(bee?.name || item.name);
  const project = esc(item.project);
  return `<article class="permit-card" data-permit="${esc(item.id)}" data-bee="${esc(item.beeId)}">
    <header>${icon('Hand', 14)}<b>Needs you</b>${typeof Notification !== 'undefined' && Notification.permission === 'default' ? `<button type="button" data-alerts title="Turn on browser notifications">${icon('Bell', 13)} Alerts</button>` : ''}<span>${project} · ${esc(who)} · waited ${waited(item.since)}</span></header>
    <p class="permit-tool"><code>${esc(item.tool)}</code> ${item.file ? `<em>${esc(item.file)}</em>` : ''}</p>
    ${item.command ? `<p class="permit-cmd">${esc(item.command)}</p>` : ''}
    ${diffHtml(item.diff)}
    <div class="permit-acts">
      <button type="button" data-go="allow" class="ok">${icon('Check', 13, 2.2)}Allow</button>
      <button type="button" data-go="deny">${icon('X', 13)}Deny</button>
      <button type="button" data-go="always">${icon('ShieldCheck', 13)}Always allow</button>
    </div>
  </article>`;
}

const seenPermits = new Set<string>();
let audioCtx: AudioContext | null = null;

function chime() {
  try {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  const ctx = audioCtx;
  const start = ctx.currentTime;
  [660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = start + i * 0.12;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.start(t);
    osc.stop(t + 0.3);
  });
  } catch { /* browsers block audio until a gesture */ }
}

function notify(item: LiveQueueItem) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const body = `${item.project}: ${item.tool}${item.command ? ' ' + item.command : ''}`.slice(0, 160);
  try { new Notification('Kovan · needs you', { body }); } catch { /* the page may be hidden or notifications blocked */ }
}

function bindAlerts(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('[data-alerts]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(p => { if (p === 'granted') btn.remove(); }).catch(() => {});
  });
}

export function noteNewPermits(queue: LiveQueueItem[]) {
  for (const item of queue) {
    if (seenPermits.has(item.id)) continue;
    seenPermits.add(item.id);
    chime();
    notify(item);
  }
}

export function paintQueue(root: HTMLElement, snap: LiveSnap, filter: string, onAnswer: (id: string, behavior: 'allow' | 'deny' | 'always') => void, onOpen: (beeId: string) => void) {
  const bees = new Map(snap.sessions.map(s => [s.id, s]));
  const match = (bee: LiveBee) => filter === 'needs' ? bee.state === 'needs-you' : filter === 'working' ? bee.state === 'working' : filter === 'stuck' ? bee.state === 'stuck' : bee.state === 'idle';
  const cards = filter === 'needs'
    ? snap.queue.map(item => permitCard(item, bees.get(item.beeId))).join('')
    : snap.sessions.filter(match).map(bee => `<button class="job live-row ${bee.state}" data-bee="${esc(bee.id)}" style="--c:${esc(snap.zones.find(z => z.id === bee.zone)?.color || '#888')}">
        <span class="hexav" style="--c:${esc(snap.zones.find(z => z.id === bee.zone)?.color || '#888')}">${esc((bee.name[0] || '?').toUpperCase())}</span>
        <span class="job-main"><span class="top"><span class="who">${esc(bee.name)}</span><i class="tag">${esc(bee.project)}</i><span class="t">${esc(bee.state)}</span></span><span class="txt">${esc(bee.activity || bee.role)}</span></span>
      </button>`).join('');
  const empty = filter === 'needs'
    ? `<div class="empty">${icon('Hand', 28, 1.25)}<p>Nobody is waiting on you.</p><small>${snap.source === 'logs' ? 'Watching session logs. Install hooks for exact state and approvals.' : snap.sessions.length ? 'Sessions are working on their own.' : 'No sessions yet. Run npx kovan hooks install, then start Claude Code.'}</small></div>`
    : `<div class="empty">${icon('Hexagon', 28, 1.25)}<p>Nothing in this lane.</p></div>`;
  root.innerHTML = cards || empty;
  root.querySelectorAll<HTMLElement>('[data-go]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const card = btn.closest<HTMLElement>('[data-permit]');
    if (card?.dataset.permit) onAnswer(card.dataset.permit, btn.dataset.go as 'allow' | 'deny' | 'always');
  });
  root.querySelectorAll<HTMLElement>('[data-bee]').forEach(el => {
    if (el.dataset.permit) return;
    el.onclick = () => { if (el.dataset.bee) onOpen(el.dataset.bee); };
  });
  bindAlerts(root);
}

export function paintPermit(root: HTMLElement, snap: LiveSnap, onAnswer: (id: string, behavior: 'allow' | 'deny' | 'always') => void, onOpen: (beeId: string) => void) {
  const item = snap.queue[0];
  if (!item) { root.classList.remove('on'); root.innerHTML = ''; return; }
  const bee = snap.sessions.find(s => s.id === item.beeId);
  root.classList.add('on');
  const html = permitCard(item, bee);
  if (root.dataset.id === item.id && root.innerHTML) {
    const since = root.querySelector('header span');
    if (since) since.textContent = `${item.project} · ${bee?.name || item.name} · waited ${waited(item.since)}`;
    return;
  }
  root.dataset.id = item.id;
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>('[data-go]').forEach(btn => btn.onclick = () => onAnswer(item.id, btn.dataset.go as 'allow' | 'deny' | 'always'));
  root.querySelector('header')?.addEventListener('click', () => onOpen(item.beeId));
  bindAlerts(root);
}

export function paintSessions(root: HTMLElement, snap: LiveSnap, onOpen: (id: string) => void) {
  const counts = { working: 0, 'needs-you': 0, stuck: 0, idle: 0 };
  for (const bee of snap.sessions) counts[bee.state] += 1;
  const head = `<div class="sheet-head"><h2>Sessions</h2><span class="muted">${snap.sessions.length} bees · <b class="c-work">${counts.working} working</b> · <b class="c-appr">${counts['needs-you']} need you</b> · ${counts.stuck} stuck · ${counts.idle} idle</span></div>`;
  const card = (bee: LiveBee) => {
    const color = snap.zones.find(z => z.id === bee.zone)?.color || '#888';
    const label = bee.state === 'working' ? '<i class="spin"></i>Working' : bee.state === 'needs-you' ? `${icon('Hand', 11)}Needs you` : bee.state === 'stuck' ? 'Stuck' : 'Idle';
    return `<article class="acard ${bee.state === 'needs-you' ? 'approval' : bee.state}" data-bee="${esc(bee.id)}" style="--c:${color}">
      <header><span class="hexav" style="--c:${color};width:36px;height:36px">${esc((bee.name[0] || '?').toUpperCase())}</span><div class="an"><b>${esc(bee.name)}</b><span>${esc(bee.role)}</span></div><em class="ast ${bee.state === 'needs-you' ? 'approval' : bee.state}">${label}</em></header>
      <div class="arow"><i class="tag dp">${esc(bee.project)}</i><span class="chip-m">${icon('Cpu', 11)}${esc(bee.source === 'codex' ? 'Codex' : 'Claude')}</span></div>
      <p class="anow">${esc(bee.activity || 'quiet')}</p>
    </article>`;
  };
  const body = snap.zones.map(z => `<section class="agroup" style="--c:${z.color}"><h3><i></i>${esc(z.name)}<small>${z.source === 'codex' ? 'Codex' : 'Claude Code'}</small></h3><div class="acards">${snap.sessions.filter(s => s.zone === z.id).map(card).join('') || ''}</div></section>`).join('');
  root.innerHTML = `${head}<div class="agrid">${body || `<div class="empty">${icon('Hexagon', 28)}<p>No live sessions.</p><small>npx kovan hooks install</small></div>`}</div>`;
  root.querySelectorAll<HTMLElement>('[data-bee]').forEach(el => el.onclick = () => { if (el.dataset.bee) onOpen(el.dataset.bee); });
}
