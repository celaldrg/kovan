// Board: every department's work as lanes, scheduled → done.
import { esc } from './md';
import { icon } from './icons';
import type { State, JobState } from './types';

const LANES: [string, JobState[], string][] = [['Scheduled', ['scheduled'], 'Clock'], ['Queued', ['queued'], 'Layers'], ['Working', ['working'], 'Sparkles'], ['Needs your OK', ['approval'], 'Hand'], ['Done', ['done', 'failed'], 'CircleCheck']];

export function paintBoard(root: HTMLElement, st: State, onPick: (jobId: string) => void) {
  const deptColor = (c: string) => st.depts.find(x => x.id === c)?.color || '#999';
  const nm = (id: string | null) => st.workers.find(w => w.id === id)?.name || '…';
  root.innerHTML = `<div class="sheet-head"><h2>Board</h2><span class="muted">${st.jobs.length} jobs · ${st.routines.length} routines</span></div>
    <div class="board">${LANES.map(([title, states, ic]) => {
      const list = st.jobs.filter(j => states.includes(j.state)).slice(title === 'Done' ? -24 : -40).reverse();
      const extra = title === 'Scheduled' ? st.routines.filter(r => !r.paused).map(r => `<div class="card routine" style="--c:${deptColor(r.dept)}"><div>${icon('Repeat', 12)} ${esc(r.text)}</div><small>next ${r.next ? new Date(r.next).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</small></div>`).join('') : '';
      return `<section class="lane-${states[0]}"><h3>${icon(ic, 13)}${title} <span>${list.length}</span></h3>${extra}${list.map(j => `<div class="card ${j.state}" data-job="${j.id}" style="--c:${deptColor(j.dept)}">
        <div>${j.swarm ? icon('Users', 12) + ' ' : ''}${esc(j.text)}</div><small><b class="dp">${st.depts.find(d => d.id === j.dept)?.code || '···'}</b> ${nm(j.worker)}${j.modelUsed ? ` · ${j.modelUsed}` : ''}${j.late ? ' · late' : ''}${j.state === 'failed' ? ' · failed' : ''}</small></div>`).join('')}</section>`;
    }).join('')}</div>`;
  root.querySelectorAll<HTMLElement>('.card[data-job]').forEach(el => el.onclick = () => onPick(el.dataset.job!));
}
