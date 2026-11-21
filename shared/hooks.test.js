import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHook, describeToolCall, permissionDecision, reduceClaudeJsonl, reduceCodexJsonl, sumUsage, projectName, redactPaths,
} from './hooks.js';

const session = (extra) => ({
  session_id: 'ses_lighthouse',
  cwd: '/work/lighthouse-api',
  transcript_path: '/work/lighthouse-api/.transcripts/ses_lighthouse.jsonl',
  ...extra,
});

test('parseHook accepts the documented lifecycle events and rejects guesses', () => {
  const start = parseHook(session({ hook_event_name: 'SessionStart', source: 'startup', model: 'claude-sonnet-4-5' }));
  assert.equal(start.name, 'SessionStart');
  assert.equal(start.source, 'startup');
  assert.equal(start.model, 'claude-sonnet-4-5');
  assert.equal(start.cwd, '/work/lighthouse-api');

  const note = parseHook(session({
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'Claude needs your permission',
  }));
  assert.equal(note.notificationType, 'permission_prompt');
  assert.equal(note.message, 'Claude needs your permission');

  const stop = parseHook(session({
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Tests passed.',
    background_tasks: [{ id: 'task-001', type: 'shell', status: 'running', description: 'tail logs' }],
  }));
  assert.equal(stop.lastAssistantMessage, 'Tests passed.');
  assert.equal(stop.backgroundTasks.length, 1);

  const pre = parseHook(session({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Run tests' },
    tool_use_id: 'toolu_01',
    permission_mode: 'default',
  }));
  assert.equal(pre.toolName, 'Bash');
  assert.equal(pre.toolInput.command, 'npm test');

  const sub = parseHook(session({ hook_event_name: 'SubagentStart', agent_id: 'agent_explore', agent_type: 'Explore' }));
  assert.equal(sub.agentId, 'agent_explore');
  assert.equal(sub.agentType, 'Explore');

  const end = parseHook(session({ hook_event_name: 'SessionEnd', reason: 'other' }));
  assert.equal(end.reason, 'other');

  assert.equal(parseHook(session({ hook_event_name: 'NotARealEvent' })), null);
  assert.equal(parseHook({ hook_event_name: 'Stop' }), null);
  assert.equal(parseHook(null), null);
});

test('describeToolCall shows the command and an edit diff without a home path', () => {
  const bash = describeToolCall('Bash', { command: 'npm test', description: 'Run tests' });
  assert.equal(bash.tool, 'Bash');
  assert.equal(bash.command, 'npm test');
  assert.match(bash.diff, /Run tests/);

  const edit = describeToolCall('Edit', {
    file_path: '/work/lighthouse-api/src/hive.ts',
    old_string: 'const n = 1;',
    new_string: 'const n = 2;',
  });
  assert.equal(edit.file, 'hive.ts');
  assert.match(edit.diff, /^- const n = 1;/m);
  assert.match(edit.diff, /^\+ const n = 2;/m);
  assert.equal(redactPaths('see /Users/someone/proj and C:\\Users\\someone\\proj'), 'see ~/proj and ~\\proj');
  assert.equal(projectName('/work/northwind-web'), 'northwind-web');
});

test('permissionDecision is fail-safe and echoes allow suggestions for always', () => {
  const hook = parseHook(session({
    hook_event_name: 'PermissionRequest',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf node_modules', description: 'Remove node_modules' },
    permission_suggestions: [{
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm -rf node_modules' }],
      behavior: 'allow',
      destination: 'localSettings',
    }],
  }));

  const allow = permissionDecision('allow', hook);
  assert.equal(allow.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(allow.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(allow.hookSpecificOutput.decision.updatedPermissions, undefined);

  const deny = permissionDecision('deny', hook);
  assert.equal(deny.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(deny.hookSpecificOutput.decision.message, /Denied/);

  const always = permissionDecision('always', hook);
  assert.equal(always.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(always.hookSpecificOutput.decision.updatedPermissions[0].destination, 'localSettings');
  assert.equal(always.hookSpecificOutput.decision.updatedPermissions[0].rules[0].ruleContent, 'rm -rf node_modules');

  const bare = parseHook(session({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Edit',
    tool_input: { file_path: '/work/lighthouse-api/src/hive.ts', old_string: 'a', new_string: 'b' },
  }));
  const fallback = permissionDecision('always', bare);
  assert.equal(fallback.hookSpecificOutput.decision.updatedPermissions[0].destination, 'session');
  assert.equal(fallback.hookSpecificOutput.decision.updatedPermissions[0].rules[0].toolName, 'Edit');

  assert.deepEqual(permissionDecision('ask', hook), {});
  assert.deepEqual(permissionDecision('', hook), {});
});

test('Claude session JSONL fallback infers working, idle and stuck', () => {
  const lines = [
    JSON.stringify({ type: 'user', sessionId: 'ses_north', cwd: '/work/northwind-web', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'Add a health check' } }),
    JSON.stringify({ type: 'assistant', sessionId: 'ses_north', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
  ];
  const working = reduceClaudeJsonl(lines);
  assert.equal(working.id, 'ses_north');
  assert.equal(working.state, 'working');
  assert.match(working.activity, /npm test/);
  assert.equal(working.model, 'claude-sonnet-4-5');

  const idle = reduceClaudeJsonl([
    JSON.stringify({ type: 'assistant', sessionId: 'ses_kite', cwd: '/work/paperkite-cli', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'All checks passed.' }] } }),
  ]);
  assert.equal(idle.state, 'idle');
  assert.match(idle.activity, /All checks passed/);

  const stuck = reduceClaudeJsonl([
    JSON.stringify({ type: 'assistant', sessionId: 'ses_err', isApiErrorMessage: true, timestamp: '2026-01-01T00:02:00.000Z', message: { content: 'rate limit' } }),
  ], 'ses_err');
  assert.equal(stuck.state, 'stuck');
});

test('Codex rollout JSONL fallback reads session_meta and tool calls', () => {
  const row = reduceCodexJsonl([
    JSON.stringify({ timestamp: '2026-01-02T00:00:00.000Z', type: 'session_meta', payload: { id: 'codex_paper', cwd: '/work/paperkite-cli', model: 'gpt-5.1-codex' } }),
    JSON.stringify({ timestamp: '2026-01-02T00:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell' } }),
  ]);
  assert.equal(row.source, 'codex');
  assert.equal(row.id, 'codex_paper');
  assert.equal(row.state, 'working');
  assert.equal(row.model, 'gpt-5.1-codex');
  assert.equal(projectName(row.cwd), 'paperkite-cli');
});

test('sumUsage counts cache reads and cache writes', () => {
  assert.equal(sumUsage({
    input_tokens: 10,
    output_tokens: 4,
    cache_creation_input_tokens: 6,
    cache_read_input_tokens: 20,
  }), 40);
  assert.equal(sumUsage(null), 0);
});
