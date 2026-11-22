// Approval rules. Every string that reaches innerHTML goes through esc().
import { esc } from './md';
import { icon } from './icons';
import { get, post } from './api';

const CLIS = ['', 'claude', 'codex', 'gemini', 'opencode', 'aider'];

interface RuleMatch { cli?: string | string[]; project?: string; tool?: string; command?: string; path?: string; costSoFar?: { gte?: number; lte?: number; gt?: number; lt?: number } }
interface ApprovalRule { id: string; priority: number; action: 'allow' | 'deny' | 'ask'; enabled?: boolean; match: RuleMatch }
interface RulesBody { version: number; status: string; error: string; rules: ApprovalRule[] }
interface TestBody { action: string; ruleId: string | null; failed: boolean; status: string; error: string; override: boolean }

function matchText(match: RuleMatch) {
  const parts: string[] = [];
  if (match.cli) parts.push(`cli ${Array.isArray(match.cli) ? match.cli.join(', ') : match.cli}`);
  if (match.project) parts.push(`project ${match.project}`);
  if (match.tool) parts.push(`tool ${match.tool}`);
  if (match.command) parts.push(`command ${match.command}`);
  if (match.path) parts.push(`path ${match.path}`);
  if (match.costSoFar) {
    const bits = Object.entries(match.costSoFar).map(([op, value]) => `${op} ${value}`);
    if (bits.length) parts.push(`cost ${bits.join(', ')}`);
  }
  return parts.join(' · ');
}

export async function paintRules(root: HTMLElement) {
  let body: RulesBody;
  try { body = await get<RulesBody>('/api/rules'); }
  catch { root.innerHTML = `<p class="muted">Rules are unavailable.</p>`; return; }
  const broken = body.status === 'invalid';
  root.innerHTML = `<div class="sheet-head"><h2>Rules</h2><span class="muted">Higher priority first. Same priority: deny beats allow. Otherwise Kovan asks.</span></div>
    <div class="rules-scroll">
    ${broken ? `<p class="rules-fail">The rules file could not be read. Kovan will ask. Nothing is auto-allowed.</p>` : ''}
    <div id="rulesList" class="rules-list"></div>
    <form class="rules-form" id="rulesTest">
      <h3>Test a rule</h3>
      <label>CLI<select id="testCli">${CLIS.map(id => `<option value="${esc(id)}">${esc(id || 'Any')}</option>`).join('')}</select></label>
      <label>Project<input id="testProject" maxlength="200"></label>
      <label>Tool<input id="testTool" maxlength="200" placeholder="Bash"></label>
      <label>Command<input id="testCommand" maxlength="200" placeholder="rm -rf build"></label>
      <label>Path<input id="testPath" maxlength="200"></label>
      <label>Cost so far<input id="testCost" inputmode="decimal" placeholder="0.40" maxlength="12"></label>
      <button type="submit">${icon('Shield', 14)}Dry run</button>
      <p id="ruleTestOut" class="rule-result">Dry run does not allow a tool and does not write the audit log.</p>
    </form>
    <form class="rules-form" id="rulesAdd">
      <h3>Add a rule</h3>
      <label>Action<select id="ruleAction"><option value="deny">deny</option><option value="ask" selected>ask</option><option value="allow">allow</option></select></label>
      <label>Priority<input id="rulePriority" inputmode="numeric" placeholder="auto" maxlength="6"></label>
      <label>CLI<select id="ruleCli">${CLIS.map(id => `<option value="${esc(id)}">${esc(id || 'Any')}</option>`).join('')}</select></label>
      <label>Project<input id="ruleProject" maxlength="200" placeholder="light*"></label>
      <label>Tool<input id="ruleTool" maxlength="200" placeholder="Bash"></label>
      <label>Command<input id="ruleCommand" maxlength="200" placeholder="npm test*"></label>
      <label>Path<input id="rulePath" maxlength="200" placeholder="src/**/*.ts"></label>
      <label>Cost<select id="ruleCostOp"><option value="">any</option><option value="gte">at least</option><option value="gt">over</option><option value="lte">at most</option><option value="lt">under</option></select></label>
      <label>USD<input id="ruleCost" inputmode="decimal" placeholder="1.00" maxlength="12"></label>
      <button type="submit" class="primary">${icon('Check', 14)}Add rule</button>
      ${broken ? `<button type="button" id="rulesReset">Replace with an empty file</button>` : ''}
      <p id="rulesError" class="rules-error"></p>
    </form>
    </div>`;
  const list = root.querySelector('#rulesList') as HTMLElement;
  const rules = (body.rules || []).map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .map(item => item.rule);
  list.innerHTML = rules.length ? rules.map(rule => `<article class="rule ${esc(rule.action)}">
      <header><b class="act">${esc(rule.action)}</b><span>${esc(rule.id)}</span><em>priority ${esc(String(rule.priority))}</em></header>
      <p>${esc(matchText(rule.match || {}))}</p>
      <div class="rule-acts">
        <button type="button" data-move="up" data-id="${esc(rule.id)}" title="Move up">${icon('ChevronLeft', 14)}</button>
        <button type="button" data-move="down" data-id="${esc(rule.id)}" title="Move down">${icon('ChevronRight', 14)}</button>
        <button type="button" data-delete="${esc(rule.id)}">Delete</button>
      </div>
    </article>`).join('') : `<p class="muted">No rules yet. Kovan asks.</p>`;
  const error = root.querySelector('#rulesError') as HTMLElement;
  const showError = (err: unknown) => { error.textContent = err instanceof Error ? err.message : 'Could not save the rule.'; };
  list.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(btn => {
    btn.onclick = async () => {
      try { await post('/api/rules', { op: 'reorder', id: btn.dataset.id, dir: btn.dataset.move }); await paintRules(root); }
      catch (err) { showError(err); }
    };
  });
  list.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(btn => {
    btn.onclick = async () => {
      try { await post('/api/rules', { op: 'delete', id: btn.dataset.delete }); await paintRules(root); }
      catch (err) { showError(err); }
    };
  });
  root.querySelector('#rulesReset')?.addEventListener('click', async () => {
    try { await post('/api/rules', { op: 'reset' }); await paintRules(root); }
    catch (err) { showError(err); }
  });
  root.querySelector('#rulesAdd')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const match: RuleMatch = {};
    const cli = (root.querySelector('#ruleCli') as HTMLSelectElement).value;
    const project = (root.querySelector('#ruleProject') as HTMLInputElement).value.trim();
    const tool = (root.querySelector('#ruleTool') as HTMLInputElement).value.trim();
    const command = (root.querySelector('#ruleCommand') as HTMLInputElement).value.trim();
    const filePath = (root.querySelector('#rulePath') as HTMLInputElement).value.trim();
    const costOp = (root.querySelector('#ruleCostOp') as HTMLSelectElement).value;
    const costRaw = (root.querySelector('#ruleCost') as HTMLInputElement).value.trim();
    if (cli) match.cli = cli;
    if (project) match.project = project;
    if (tool) match.tool = tool;
    if (command) match.command = command;
    if (filePath) match.path = filePath;
    if (costOp && costRaw) match.costSoFar = { [costOp]: Number(costRaw) };
    const priorityRaw = (root.querySelector('#rulePriority') as HTMLInputElement).value.trim();
    const rule: { action: string; match: RuleMatch; priority?: number } = {
      action: (root.querySelector('#ruleAction') as HTMLSelectElement).value,
      match,
    };
    if (priorityRaw) rule.priority = Number(priorityRaw);
    try {
      await post('/api/rules', { op: 'add', rule });
      await paintRules(root);
    } catch (err) { showError(err); }
  });
  root.querySelector('#rulesTest')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = root.querySelector('#ruleTestOut') as HTMLElement;
    const costRaw = (root.querySelector('#testCost') as HTMLInputElement).value.trim();
    try {
      const result = await post<TestBody>('/api/rules/test', {
        event: {
          cli: (root.querySelector('#testCli') as HTMLSelectElement).value,
          project: (root.querySelector('#testProject') as HTMLInputElement).value.trim(),
          tool: (root.querySelector('#testTool') as HTMLInputElement).value.trim(),
          command: (root.querySelector('#testCommand') as HTMLInputElement).value.trim(),
          path: (root.querySelector('#testPath') as HTMLInputElement).value.trim(),
          costSoFar: costRaw ? Number(costRaw) : null,
        },
      });
      const who = result.failed ? 'Rules file unreadable. Asking. Nothing was auto-allowed.'
        : result.ruleId ? `${result.action} by ${result.ruleId}${result.override ? ' (deny beat allow)' : ''}`
          : `${result.action} (default)`;
      out.className = `rule-result ${result.failed ? 'ask' : result.action}`;
      out.textContent = who;
    } catch { out.textContent = 'The dry run failed.'; }
  });
}
