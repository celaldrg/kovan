import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLive } from './live.mjs';

const bashAsk = {
  session_id: 'ses_lighthouse',
  cwd: '/work/lighthouse-api',
  permission_mode: 'default',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm test', description: 'Run the suite' },
  permission_suggestions: [{
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
    behavior: 'allow',
    destination: 'localSettings',
  }],
};

test('permission allow, deny and always round-trip to the hook body', async () => {
  const live = createLive({ permissionWaitMs: 2000 });
  live.handleHook({ session_id: 'ses_lighthouse', cwd: '/work/lighthouse-api', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-sonnet-4-5' });
  const pending = live.handleHook(bashAsk);
  const card = live.snapshot().queue[0];
  assert.ok(card);
  assert.equal(card.tool, 'Bash');
  assert.equal(card.command, 'npm test');
  assert.equal(card.project, 'lighthouse-api');
  assert.equal(live.snapshot().sessions.find(s => s.id === 'ses_lighthouse').state, 'needs-you');
  assert.equal(JSON.stringify(live.snapshot()).includes('/work/'), false);

  assert.equal(live.answer(card.id, 'allow'), true);
  const allowed = await pending;
  assert.equal(allowed.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(allowed.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(allowed.hookSpecificOutput.decision.updatedPermissions, undefined);
  assert.equal(live.snapshot().queue.length, 0);
  assert.equal(live.snapshot().sessions[0].state, 'working');

  const again = live.handleHook(bashAsk);
  const id2 = live.snapshot().queue[0].id;
  live.answer(id2, 'deny');
  const denied = await again;
  assert.equal(denied.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(denied.hookSpecificOutput.decision.message, /Denied/);

  const third = live.handleHook(bashAsk);
  const id3 = live.snapshot().queue[0].id;
  live.answer(id3, 'always');
  const always = await third;
  assert.equal(always.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(always.hookSpecificOutput.decision.updatedPermissions[0].rules[0].ruleContent, 'npm test');
  assert.equal(always.hookSpecificOutput.decision.updatedPermissions[0].destination, 'localSettings');
});

test('a permission timeout returns no decision so the terminal prompt remains', async () => {
  const live = createLive({ permissionWaitMs: 30 });
  const body = await live.handleHook(bashAsk);
  assert.deepEqual(body, {});
  const session = live.snapshot().sessions[0];
  assert.equal(session.state, 'working');
  assert.match(session.activity, /terminal/);
  assert.equal(live.answer('missing', 'allow'), false);
});

test('lifecycle hooks move a bee through working, stuck, idle and remove it', () => {
  const live = createLive();
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'SessionStart', source: 'startup' });
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/work/northwind-web/src/app.ts', old_string: 'a', new_string: 'b' } });
  assert.equal(live.snapshot().sessions[0].state, 'working');
  assert.match(live.snapshot().sessions[0].activity, /Edit/);
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'SubagentStart', agent_id: 'agent_explore', agent_type: 'Explore' });
  assert.equal(live.snapshot().sessions.filter(s => s.kind === 'subagent').length, 1);
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error: Rate limit reached' });
  assert.equal(live.snapshot().sessions.find(s => s.kind === 'session').state, 'stuck');
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'UserPromptSubmit', prompt: 'try again' });
  assert.equal(live.snapshot().sessions.find(s => s.kind === 'session').state, 'working');
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [] });
  assert.equal(live.snapshot().sessions.find(s => s.kind === 'session').state, 'idle');
  live.handleHook({ session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'SessionEnd', reason: 'other' });
  assert.equal(live.snapshot().sessions.length, 0);
});

test('log fallback does not override a session that hooks already own', () => {
  const live = createLive();
  live.handleHook({ session_id: 'ses_kite', cwd: '/work/paperkite-cli', hook_event_name: 'Stop', last_assistant_message: 'Idle from hook.' });
  live.applyLog({ id: 'ses_kite', cwd: '/work/paperkite-cli', state: 'working', activity: 'stale log', source: 'claude', updated: Date.now() });
  assert.match(live.snapshot().sessions[0].activity, /Idle from hook/);
  live.applyLog({ id: 'codex_paper', cwd: '/work/paperkite-cli', state: 'working', activity: 'shell', source: 'codex', model: 'gpt-5.1-codex', updated: Date.now() });
  const codex = live.snapshot().sessions.find(s => s.id === 'codex_paper');
  assert.equal(codex.source, 'codex');
  assert.equal(codex.zone, live.snapshot().sessions.find(s => s.id === 'ses_kite').zone);
  assert.equal(live.snapshot().source, 'hooks');
});

test('a spent budget denies the permission request instead of holding or allowing it', async () => {
  const live = createLive({
    gate: {
      blockPermission: () => ({ level: 'stop', message: 'Budget reached for northwind-web (100% of $4.00 today). Kovan denied further work. Nothing was allowed.' }),
    },
  });
  const body = await live.handleHook(bashAsk);
  assert.equal(body.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(body.hookSpecificOutput.decision.message, /Nothing was allowed/);
  assert.equal(live.snapshot().queue.length, 0);
  assert.equal(live.answer('missing', 'allow'), false);
});

test('Gemini BeforeTool expires as a deny; Codex PermissionRequest expires with no decision', async () => {
  const events = [];
  const live = createLive({ permissionWaitMs: 20, onAudit: (event) => events.push(event) });
  const gemini = await live.handleHook({
    session_id: 'gem_atlas', cwd: '/work/atlas-notes', hook_event_name: 'BeforeTool',
    tool_name: 'run_shell_command', tool_input: { command: 'npm test' },
  }, { cli: 'gemini' });
  assert.equal(gemini.decision, 'deny');
  assert.match(gemini.reason, /Nothing was allowed/);
  assert.equal(events[0].actor, 'timeout');
  assert.equal(events[0].decision, 'deny');
  const aborted = createLive({ permissionWaitMs: 5000 });
  const ac = new AbortController();
  const hanging = aborted.handleHook({
    session_id: 'gem_atlas', cwd: '/work/atlas-notes', hook_event_name: 'BeforeTool',
    tool_name: 'run_shell_command', tool_input: { command: 'npm test' },
  }, { cli: 'gemini', signal: ac.signal });
  ac.abort();
  const fromAbort = await hanging;
  assert.equal(fromAbort.decision, 'deny');
  const codexWait = createLive({ permissionWaitMs: 20 });
  const codexEmpty = await codexWait.handleHook({
    session_id: 'codex_harbor', cwd: '/work/harbor-docs', hook_event_name: 'PermissionRequest',
    tool_name: 'Bash', tool_input: { command: 'git status' },
  }, { cli: 'codex' });
  assert.deepEqual(codexEmpty, {});
  const codexLive = createLive({ permissionWaitMs: 2000 });
  const pending = codexLive.handleHook({
    session_id: 'codex_harbor', cwd: '/work/harbor-docs', hook_event_name: 'PermissionRequest',
    tool_name: 'Bash', tool_input: { command: 'git status' },
  }, { cli: 'codex' });
  const card = codexLive.snapshot().queue[0];
  assert.equal(card.always, false);
  assert.equal(codexLive.answer(card.id, 'always'), true);
  const body = await pending;
  assert.equal(body.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(body.hookSpecificOutput.decision.updatedPermissions, undefined);
});

test('an allow rule answers immediately and a broken rules file does not', async () => {
  const events = [];
  const allow = createLive({
    rules: { evaluate: () => ({ action: 'allow', ruleId: 'allow-tests', failed: false, status: 'ok' }) },
    onAudit: (event) => events.push(event),
  });
  const allowed = await allow.handleHook(bashAsk);
  assert.equal(allowed.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(allow.snapshot().queue.length, 0);
  assert.equal(events[0].actor, 'rule');
  assert.equal(events[0].ruleId, 'allow-tests');
  assert.equal(events[0].decision, 'allow');

  const denied = createLive({
    rules: { evaluate: () => ({ action: 'deny', ruleId: 'deny-bash', failed: false, status: 'ok', override: true }) },
    onAudit: (event) => events.push(event),
  });
  const body = await denied.handleHook(bashAsk);
  assert.equal(body.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(events.at(-1).actor, 'rule');
  assert.equal(events.at(-1).ruleId, 'deny-bash');

  const broken = createLive({
    permissionWaitMs: 30,
    rules: { evaluate: () => ({ action: 'allow', ruleId: 'stale', failed: true, status: 'invalid' }) },
    onAudit: (event) => events.push(event),
  });
  const asked = await broken.handleHook(bashAsk);
  assert.deepEqual(asked, {});
  assert.equal(events.at(-1).actor, 'timeout');
  assert.equal(events.at(-1).decision, 'unanswered');
  assert.equal(events.some(event => event.ruleId === 'stale' && event.decision === 'allow'), false);
});

test('a budget stop is recorded as budget even when a rule would allow', async () => {
  const events = [];
  const live = createLive({
    rules: { evaluate: () => ({ action: 'allow', ruleId: 'allow-tests', failed: false, status: 'ok' }) },
    gate: { blockPermission: () => ({ level: 'stop', message: 'Budget reached for lighthouse-api. Nothing was allowed.' }) },
    onAudit: (event) => events.push(event),
  });
  const body = await live.handleHook(bashAsk);
  assert.equal(body.hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(events[0].actor, 'budget');
  assert.equal(events[0].decision, 'deny');
  assert.equal(live.snapshot().queue.length, 0);
});

test('desktop and phone answers are different audit actors', async () => {
  const events = [];
  const live = createLive({ permissionWaitMs: 2000, onAudit: (event) => events.push(event) });
  const pending = live.handleHook(bashAsk);
  const id = live.snapshot().queue[0].id;
  assert.equal(live.answer(id, 'deny', { actor: 'phone' }), true);
  await pending;
  assert.equal(events[0].actor, 'phone');
  assert.equal(events[0].decision, 'deny');
  const again = live.handleHook(bashAsk);
  const id2 = live.snapshot().queue[0].id;
  live.answer(id2, 'allow');
  await again;
  assert.equal(events[1].actor, 'desktop');
  assert.equal(events[1].decision, 'allow');
});

test('allow is turned into a denial when the budget is reached while a card is open', async () => {
  let stop = false;
  const live = createLive({
    gate: { blockPermission: () => (stop ? { level: 'stop', message: 'Budget reached for lighthouse-api. Nothing was allowed.' } : null) },
  });
  const pending = live.handleHook(bashAsk);
  const id = live.snapshot().queue[0].id;
  stop = true;
  assert.equal(live.answer(id, 'allow'), true);
  const body = await pending;
  assert.equal(body.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(body.hookSpecificOutput.decision.message, /Nothing was allowed/);
});
