// Approval audit log. Every string that reaches innerHTML goes through esc().
import { esc } from './md';
import { icon } from './icons';
import { cliLabel } from './cli-label';
import { get } from './api';

const ACTORS = ['', 'rule', 'desktop', 'phone', 'timeout', 'budget', 'retention'];
const DECISIONS = ['', 'allow', 'deny', 'unanswered', 'anchor'];
const CLIS = ['', 'claude', 'codex', 'gemini', 'opencode', 'aider'];

interface AuditEvent {
  seq: number; at: number; actor: string; decision: string; behavior: string; ruleId: string | null;
  cli: string; project: string; tool: string; command: string; reason: string; rulesStatus: string;
}
interface AuditBody { ok: boolean; events: AuditEvent[] }

function when(at: number) {
  if (!at) return '';
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

export async function paintAudit(root: HTMLElement) {
  root.innerHTML = `<div class="sheet-head"><h2>Audit</h2><span class="muted">Append-only hash chain. Secrets are redacted the same way as replay.</span></div>
    <div class="rules-scroll">
    <form class="replay-bar" id="auditForm">
      <input id="auditQ" type="search" placeholder="Tool, command, rule" autocomplete="off">
      <select id="auditActor">${ACTORS.map(id => `<option value="${esc(id)}">${esc(id || 'Any actor')}</option>`).join('')}</select>
      <select id="auditDecision">${DECISIONS.map(id => `<option value="${esc(id)}">${esc(id || 'Any decision')}</option>`).join('')}</select>
      <select id="auditCli">${CLIS.map(id => `<option value="${esc(id)}">${esc(id ? cliLabel(id) : 'Any CLI')}</option>`).join('')}</select>
      <input id="auditProject" type="text" placeholder="Project" autocomplete="off">
      <input id="auditSince" type="date">
      <button type="submit" class="primary">${icon('Search', 14)}Filter</button>
      <button type="button" id="auditVerify">${icon('ShieldCheck', 14)}Verify chain</button>
    </form>
    <p id="auditStatus" class="rule-result"></p>
    <div id="auditList" class="rules-list"></div>
    </div>`;
  const form = root.querySelector('#auditForm') as HTMLFormElement;
  form.addEventListener('submit', (event) => { event.preventDefault(); void load(root); });
  root.querySelector('#auditVerify')?.addEventListener('click', () => void verify(root));
  await load(root);
}

async function load(root: HTMLElement) {
  const params = new URLSearchParams();
  const q = (root.querySelector('#auditQ') as HTMLInputElement).value.trim();
  const actor = (root.querySelector('#auditActor') as HTMLSelectElement).value;
  const decision = (root.querySelector('#auditDecision') as HTMLSelectElement).value;
  const cli = (root.querySelector('#auditCli') as HTMLSelectElement).value;
  const project = (root.querySelector('#auditProject') as HTMLInputElement).value.trim();
  const since = (root.querySelector('#auditSince') as HTMLInputElement).value;
  if (q) params.set('q', q);
  if (actor) params.set('actor', actor);
  if (decision) params.set('decision', decision);
  if (cli) params.set('cli', cli);
  if (project) params.set('project', project);
  if (since) params.set('since', since);
  const list = root.querySelector('#auditList') as HTMLElement;
  let body: AuditBody;
  try { body = await get<AuditBody>(`/api/audit?${params.toString()}`); }
  catch { list.innerHTML = `<p class="muted">The audit log is unavailable.</p>`; return; }
  const events = (body.events || []).slice().reverse();
  if (!events.length) { list.innerHTML = `<p class="muted">No matching decisions.</p>`; return; }
  list.innerHTML = events.map(event => `<article class="rule ${esc(event.decision)}">
      <header><b class="act">${esc(event.decision)}</b><span>${esc(event.actor)}${event.ruleId ? ` · ${esc(event.ruleId)}` : ''}</span><em>${esc(when(event.at))}</em></header>
      <p>${esc([event.cli && cliLabel(event.cli), event.project, event.tool, event.command].filter(Boolean).join(' · ') || event.reason || 'recorded')}</p>
    </article>`).join('');
}

async function verify(root: HTMLElement) {
  const status = root.querySelector('#auditStatus') as HTMLElement;
  try {
    const result = await get<{ ok: boolean; error: string; checked: number }>(`/api/audit/verify`);
    status.className = `rule-result ${result.ok ? 'allow' : 'deny'}`;
    status.textContent = result.ok ? `Chain ok. ${result.checked} records.` : `Chain broken. ${result.error || 'mismatch'}.`;
  } catch { status.textContent = 'Verify failed.'; }
}
