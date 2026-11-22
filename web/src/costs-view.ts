import { esc } from './md';
import { icon } from './icons';
import type { CostSummary, LiveSnap } from './types';

export interface PhoneStatus { enabled: boolean; origin: string }
export interface PhoneDevice { id: string; name: string; created: number; revokedAt: number; push: boolean }

export function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function percent(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

function levelWord(level: string) {
  if (level === 'stop') return 'limit';
  if (level === 'high') return '95%';
  if (level === 'warn') return '75%';
  return level;
}

export function paintMeter(spend: HTMLElement, budget: HTMLElement, costs: CostSummary | null | undefined) {
  spend.textContent = money(costs?.dayUsd || 0);
  const worst = (costs?.alerts || []).slice().sort((a, b) => (b.ratio || 0) - (a.ratio || 0))[0];
  budget.textContent = worst ? percent(worst.ratio) : '—';
  budget.className = worst ? `lvl ${worst.level}` : '';
}

export function paintBanner(root: HTMLElement, costs: CostSummary | null | undefined, live: LiveSnap) {
  const alerts = (costs?.alerts || []).filter(alert => alert.level === 'warn' || alert.level === 'high' || alert.level === 'stop');
  const flags = live.sessions.filter(bee => bee.runaway && bee.kind === 'session');
  const bits = [
    ...alerts.map(alert => `<span class="pill ${esc(alert.level)}">${icon('Coins', 12)} ${esc(alert.key || alert.scope)} · ${percent(alert.ratio)} of ${money(alert.limitUsd)} ${esc(alert.period)} · ${levelWord(alert.level)}</span>`),
    ...flags.map(bee => `<span class="pill runaway">${icon('Activity', 12)} ${esc(bee.project)} · runaway · ${esc(bee.runaway?.detail || '')}</span>`),
  ];
  root.innerHTML = bits.join('');
}

export function paintDrawer(root: HTMLElement, costs: CostSummary | null | undefined, phone: PhoneStatus | null | undefined, devices: PhoneDevice[], pairing: { url: string; svg: string; expires: number } | null) {
  const row = (item: NonNullable<CostSummary['projects']>[number]) => `<li><b>${esc(item.key)}</b><span>${money(item.usd)} · ${item.limitUsd ? `${percent(item.ratio)} of ${money(item.limitUsd)}` : 'no budget'} <i class="${esc(item.level)}">${esc(item.level)}</i></span></li>`;
  const list = (title: string, items: CostSummary['projects']) => `<section><h3>${title}</h3>${items?.length ? `<ul>${items.map(row).join('')}</ul>` : '<p class="muted">No reported usage yet.</p>'}</section>`;
  const phoneBlock = !phone?.enabled
    ? `<p>Phone access is off. Set <code>KOVAN_PHONE=1</code> and <code>KOVAN_PUBLIC_ORIGIN</code> to a LAN address or a tunnel you run, then restart. The desktop stays on loopback until you opt in.</p>`
    : `${pairing?.svg ? `<div class="qr">${pairing.svg}</div><p class="mono">${esc(pairing.url)}</p><p class="muted">Code expires in 5 minutes and works once.</p>` : `<p>${phone.origin ? 'Create a pairing code. The phone opens that URL.' : 'Set KOVAN_PUBLIC_ORIGIN. A phone cannot open 127.0.0.1.'}</p>`}
      <button type="button" id="pairBtn" class="primary">${icon('Bell', 14)} Pair a phone</button>
      <ul class="devices">${devices.filter(device => !device.revokedAt).map(device => `<li><b>${esc(device.name)}</b><button type="button" data-revoke="${esc(device.id)}">Revoke</button></li>`).join('') || '<li class="muted">No paired devices.</li>'}</ul>`;
  root.innerHTML = `
    <header><h2>Costs and phone</h2><button type="button" class="ibtn" id="drawerClose" title="Close">${icon('X', 16)}</button></header>
    <p class="muted">${costs?.demo ? 'Demo figures, priced from explicit token counts. ' : 'Priced only from reported token usage. '}Rate card ${esc(costs?.dated || '—')}.</p>
    <p class="spend">${money(costs?.dayUsd || 0)} <small>today</small></p>
    ${list('Projects', costs?.projects)}
    ${list('Departments', costs?.departments)}
    <form id="budgetForm" class="budget-form">
      <h3>Budget</h3>
      <label>Scope<select name="scope"><option value="project">Project</option><option value="department">Department</option><option value="session">Session</option></select></label>
      <label>Name<input name="key" placeholder="lighthouse-api" maxlength="80" /></label>
      <label>USD<input name="limitUsd" inputmode="decimal" placeholder="25" /></label>
      <label>Period<select name="period"><option value="day">Day</option><option value="month">Month</option><option value="session">Session</option></select></label>
      <button type="submit" class="primary">Save budget</button>
    </form>
    <section><h3>Phone</h3>${phoneBlock}</section>`;
}
