// Replay and search. Every string that reaches innerHTML goes through esc().
import { esc } from './md';
import { icon } from './icons';
import { cliLabel } from './cli-label';
import { get } from './api';
import type { ReplayEvent } from './types';

const CLIS = ['', 'claude', 'codex', 'gemini', 'opencode', 'aider'];
const STATUSES = ['', 'working', 'idle', 'stuck', 'needs-you', 'allowed', 'denied', 'timeout', 'priced', 'unknown', 'done'];

function when(at: number) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
}

export async function paintReplay(root: HTMLElement) {
  root.innerHTML = `<div class="sheet-head"><h2>Replay</h2><span class="muted">Local timelines. Secrets are redacted before they are stored.</span></div>
    <form class="replay-bar" id="replayForm">
      <input id="replayQ" type="search" placeholder="Search prompts, tools, projects" autocomplete="off">
      <select id="replayCli">${CLIS.map(id => `<option value="${esc(id)}">${esc(id ? cliLabel(id) : 'Any CLI')}</option>`).join('')}</select>
      <input id="replayProject" type="text" placeholder="Project" autocomplete="off">
      <input id="replayFrom" type="date">
      <input id="replayTo" type="date">
      <select id="replayStatus">${STATUSES.map(id => `<option value="${esc(id)}">${esc(id || 'Any status')}</option>`).join('')}</select>
      <button type="submit" class="primary">${icon('Search', 14)}Search</button>
    </form>
    <div class="replay-layout"><div id="replayHits" class="replay-hits"></div><div id="replayStage" class="replay-stage"></div></div>`;
  const form = root.querySelector('#replayForm') as HTMLFormElement;
  const run = () => search(root);
  form.addEventListener('submit', (event) => { event.preventDefault(); run(); });
  await run();
}

async function search(root: HTMLElement) {
  const q = (root.querySelector('#replayQ') as HTMLInputElement).value.trim();
  const cli = (root.querySelector('#replayCli') as HTMLSelectElement).value;
  const project = (root.querySelector('#replayProject') as HTMLInputElement).value.trim();
  const from = (root.querySelector('#replayFrom') as HTMLInputElement).value;
  const to = (root.querySelector('#replayTo') as HTMLInputElement).value;
  const status = (root.querySelector('#replayStatus') as HTMLSelectElement).value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cli) params.set('cli', cli);
  if (project) params.set('project', project);
  if (from) params.set('from', from);
  if (to) params.set('to', `${to}T23:59:59.999Z`);
  if (status) params.set('status', status);
  const hits = root.querySelector('#replayHits') as HTMLElement;
  const stage = root.querySelector('#replayStage') as HTMLElement;
  let body: { enabled: boolean; events: ReplayEvent[] };
  try { body = await get(`/api/replay?${params.toString()}`); }
  catch { hits.innerHTML = `<p class="muted">Search is unavailable.</p>`; return; }
  if (!body.enabled) {
    hits.innerHTML = `<p class="muted">Recording is off. Set replay.enabled or leave KOVAN_REPLAY unset.</p>`;
    stage.innerHTML = '';
    return;
  }
  const events = body.events || [];
  if (!events.length) {
    hits.innerHTML = `<p class="muted">No matching lines.</p>`;
    stage.innerHTML = '';
    return;
  }
  hits.innerHTML = events.slice().reverse().map(ev => `<button type="button" class="replay-hit" data-session="${esc(ev.sessionId)}" data-id="${esc(ev.id)}">
      <b>${esc(cliLabel(ev.cli))}</b><span>${esc(ev.project || 'session')}</span>
      <em>${esc(ev.kind)} · ${esc(ev.status || '')}</em>
      <small>${esc(when(ev.at))}</small>
      <p>${esc(ev.text || ev.tool || 'quiet')}</p>
    </button>`).join('');
  hits.querySelectorAll<HTMLButtonElement>('.replay-hit').forEach(btn => {
    btn.onclick = () => openSession(stage, btn.dataset.session || '', btn.dataset.id || '');
  });
}

async function openSession(stage: HTMLElement, sessionId: string, focusId: string) {
  let body: { events: ReplayEvent[] };
  try { body = await get(`/api/replay/session?id=${encodeURIComponent(sessionId)}`); }
  catch { stage.innerHTML = `<p class="muted">This timeline could not be read.</p>`; return; }
  const events = body.events || [];
  if (!events.length) { stage.innerHTML = `<p class="muted">No stored lines for this session.</p>`; return; }
  let index = events.findIndex(ev => ev.id === focusId);
  if (index < 0) index = events.length - 1;
  stage.innerHTML = `<div class="replay-card">
    <header><b></b><span></span><em></em></header>
    <p class="replay-kind"></p>
    <p class="replay-text"></p>
    <label class="replay-scrub">Scrub<input type="range" min="0" max="${events.length - 1}" value="${index}"></label>
    <small></small>
  </div>`;
  const title = stage.querySelector('header b') as HTMLElement;
  const project = stage.querySelector('header span') as HTMLElement;
  const time = stage.querySelector('header em') as HTMLElement;
  const kind = stage.querySelector('.replay-kind') as HTMLElement;
  const text = stage.querySelector('.replay-text') as HTMLElement;
  const pos = stage.querySelector('small') as HTMLElement;
  const range = stage.querySelector('input') as HTMLInputElement;
  const paint = () => {
    const ev = events[index];
    title.textContent = cliLabel(ev.cli);
    project.textContent = ev.project || '';
    time.textContent = when(ev.at);
    kind.textContent = `${ev.kind} · ${ev.status || 'recorded'}${ev.tool ? ` · ${ev.tool}` : ''}`;
    text.textContent = ev.text || 'No text on this line.';
    pos.textContent = `${index + 1} / ${events.length}`;
    range.value = String(index);
  };
  range.addEventListener('input', () => { index = Number(range.value) || 0; paint(); });
  paint();
}
