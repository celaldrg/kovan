// Calendar: finished work, scheduled work and routine runs projected forward. Click a day to plan.
import { occurrences, describeRule } from '../../shared/schedule.js';
import { post } from './api';
import { esc } from './md';
import { icon } from './icons';
import type { State, Rule } from './types';

const DAY = 86400e3;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const key = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function openCalendar(root: HTMLElement, getState: () => State, onPick: (jobId: string) => void) {
  let cursor = new Date(); cursor.setDate(1);
  let filterRoutine = '';
  function render() {
    const st = getState();
    const deptColor = (c: string) => st.depts.find(x => x.id === c)?.color || '#999';
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
    const from = gridStart.getTime(), to = from + 42 * DAY;
    const items = new Map<string, { t: number; label: string; color: string; kind: string; id?: string }[]>();
    const add = (t: number, it: { t: number; label: string; color: string; kind: string; id?: string }) => { const k = key(t); (items.get(k) || items.set(k, []).get(k)!).push(it); };
    for (const j of st.jobs) {
      if (filterRoutine && j.routineId !== filterRoutine) continue;
      const t = j.state === 'scheduled' ? j.at! : j.finished || j.created;
      if (t < from || t >= to || j.state === 'cancelled') continue;
      add(t, { t, label: j.text, color: deptColor(j.dept), kind: j.state, id: j.id });
    }
    for (const r of st.routines) {
      if (r.paused || (filterRoutine && r.id !== filterRoutine)) continue;
      const ts = occurrences(r.rule as never, Math.max(from, Date.now()), to, r.start, 60);
      if ((r.rule as Rule).kind !== 'days') { if (ts.length) for (const day of new Set(ts.map(key))) { const t0 = ts.find(t => key(t) === day)!; add(t0, { t: t0, label: `↻ ${r.text} (${describeRule(r.rule)})`, color: deptColor(r.dept), kind: 'routine' }); } }
      else for (const t of ts) add(t, { t, label: `↻ ${r.text}`, color: deptColor(r.dept), kind: 'routine' });
    }
    const today = key(Date.now());
    const cells: string[] = [];
    for (let i = 0; i < 42; i++) {
      const t = from + i * DAY; const d = new Date(t);
      const list = (items.get(key(t)) || []).sort((a, b) => a.t - b.t);
      cells.push(`<div class="day ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${key(t) === today ? 'today' : ''}" data-t="${t}">
        <div class="dn">${d.getDate()}</div>
        ${list.slice(0, 4).map(it => `<div class="ev ${it.kind}" style="--c:${it.color}" ${it.id ? `data-job="${it.id}"` : ''} title="${esc(it.label)}"><b>${hm(it.t)}</b> ${esc(it.label)}</div>`).join('')}
        ${list.length > 4 ? `<div class="more">+${list.length - 4} more</div>` : ''}</div>`);
    }
    root.innerHTML = `<div class="sheet-head"><h2>Calendar</h2>
        <div class="cal-nav"><button class="ibtn" data-n="-1">${icon('ChevronLeft', 16)}</button><span>${cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span><button class="ibtn" data-n="1">${icon('ChevronRight', 16)}</button><button class="pill" data-n="0">Today</button></div></div>
      <div class="cal-body">
        <aside class="rail"><h3>${icon('Repeat', 13)} Routines</h3>${st.routines.length ? st.routines.map(r => `<div class="rt ${filterRoutine === r.id ? 'on' : ''} ${r.paused ? 'paused' : ''}" data-r="${r.id}" style="--c:${deptColor(r.dept)}">
          <div>${esc(r.text)}</div><small>${describeRule(r.rule)}${r.paused ? ' · paused' : r.next ? ` · next ${new Date(r.next).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}${r.needsOk ? ' · needs OK' : ''}</small></div>`).join('') : '<p class="muted small">No routines yet. Type “every Monday at 9…” in the command bar, or click a day.</p>'}</aside>
        <div class="grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dh">${d}</div>`).join('')}${cells.join('')}</div>
      </div>`;
    root.querySelectorAll<HTMLButtonElement>('.cal-nav button').forEach(b => b.onclick = () => { const n = Number(b.dataset.n); if (!n) { cursor = new Date(); cursor.setDate(1); } else cursor.setMonth(cursor.getMonth() + n); render(); });
    root.querySelectorAll<HTMLElement>('.rt').forEach(el => el.onclick = () => { filterRoutine = filterRoutine === el.dataset.r ? '' : el.dataset.r!; render(); });
    root.querySelectorAll<HTMLElement>('.ev[data-job]').forEach(el => el.onclick = e => { e.stopPropagation(); onPick(el.dataset.job!); });
    root.querySelectorAll<HTMLElement>('.day').forEach(el => el.onclick = () => planDay(Number(el.dataset.t)));
  }

  function planDay(t: number) {
    const st = getState();
    const d = new Date(t);
    const dlg = document.createElement('div');
    dlg.className = 'plan';
    dlg.innerHTML = `<form><h3>Plan for ${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      <textarea name="text" required placeholder="What should happen?"></textarea>
      <div class="row"><select name="dept"><option value="">Any department</option>${st.depts.map(c => `<option value="${c.id}">${c.name} · ${c.tr}</option>`).join('')}</select>
      <input type="time" name="time" value="09:00" required></div>
      <label class="row"><input type="checkbox" name="repeat"> Repeat <select name="cadence"><option value="daily">daily</option><option value="weekdays">weekdays</option><option value="weekly">weekly (this weekday)</option></select></label>
      <div class="row end"><button type="button" class="ghost">Cancel</button><button class="primary">${icon('Sparkles', 14)}Plan it</button></div></form>`;
    root.appendChild(dlg);
    const f = dlg.querySelector('form')!;
    (f.elements.namedItem('text') as HTMLTextAreaElement).focus();
    dlg.querySelector('.ghost')!.addEventListener('click', () => dlg.remove());
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f);
      const [hh, mm] = String(fd.get('time')).split(':').map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
      const text = String(fd.get('text')), dept = String(fd.get('dept'));
      if (fd.get('repeat')) {
        const cad = String(fd.get('cadence'));
        const weekdays = cad === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : cad === 'weekdays' ? [1, 2, 3, 4, 5] : [d.getDay()];
        await post('/api/jobs', { text, dept, repeat: false, rule: { kind: 'days', weekdays, hour: hh, minute: mm }, start: startOfDay(d).getTime() });
      } else await post('/api/jobs', { text, dept, repeat: false, at });
      dlg.remove();
    };
  }
  render();
  return render;
}
