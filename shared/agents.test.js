import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCodexRollout, parseGeminiSession, parseOpenCodeSession, parseOpenCodePermission,
  parseOpenCodeService, parseAiderHistory, adaptHook, hookDecision, openCodeReply, codexUsageBuckets,
} from './agents.js';
import { permissionDecision } from './hooks.js';
import { redactSecrets } from './redact.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => fs.readFileSync(path.join(root, 'fixtures', 'agents', name), 'utf8');

test('Codex rollout fixture yields a session and one usage delta', () => {
  const row = parseCodexRollout(fixture('codex-rollout.jsonl').split('\n'));
  assert.equal(row.id, 'codex_harbor');
  assert.equal(row.cwd, '/work/harbor-docs');
  assert.equal(row.model, 'gpt-4.1');
  assert.equal(row.state, 'working');
  assert.equal(row.readOnly, true);
  assert.equal(row.usages.length, 1);
  assert.equal(row.usages[0].usage.input_tokens, 100);
  assert.equal(row.usages[0].usage.cache_read_input_tokens, 20);
  assert.equal(row.usages[0].usage.output_tokens, 30);
  assert.ok(row.events.some(ev => ev.kind === 'prompt' && /dock note/.test(ev.text)));
  const repeated = codexUsageBuckets({ input_tokens: 120, cached_input_tokens: 20, output_tokens: 30, total_tokens: 150 });
  assert.equal(repeated.input_tokens, 100);
});

test('Gemini session fixture reads the message, tool call and token summary', () => {
  const row = parseGeminiSession(fixture('gemini-session.jsonl').split('\n'));
  assert.equal(row.id, 'gem_atlas');
  assert.equal(row.cwd, '/work/atlas-notes');
  assert.equal(row.model, 'gemini-2.5-flash');
  assert.match(row.activity, /read_file/);
  assert.equal(row.usages.length, 1);
  assert.equal(row.usages[0].usage.input_tokens, 920);
  assert.equal(row.usages[0].usage.output_tokens, 250);
  assert.equal(row.usages[0].usage.cache_read_input_tokens, 100);
  assert.equal(row.readOnly, true);
});

test('OpenCode session and permission fixtures match the documented fields', () => {
  const row = parseOpenCodeSession(JSON.parse(fixture('opencode-session.json')));
  assert.equal(row.id, 'ses_quill');
  assert.equal(row.cwd, '/work/quill-editor');
  assert.equal(row.model, 'openai/gpt-4.1-mini');
  assert.equal(row.state, 'working');
  assert.equal(row.usages[0].usage.input_tokens, 800);
  assert.equal(row.usages[0].usage.output_tokens, 160);
  assert.equal(row.approvals, 'none');
  const perm = parseOpenCodePermission(JSON.parse(fixture('opencode-permission.json')));
  assert.equal(perm.tool, 'bash');
  assert.equal(perm.command, 'npm test');
  const service = parseOpenCodeService(JSON.parse(fixture('opencode-service.json')));
  assert.equal(service.origin, 'http://127.0.0.1:4096');
  assert.equal(parseOpenCodeService({ url: 'http://203.0.113.8:4096', pid: 1 }), null);
  assert.equal(parseOpenCodeService({ url: 'file:///tmp/x', pid: 1 }), null);
});

test('Aider history fixture splits the session and reads the token line', () => {
  const secret = ['sk', 'ant', 'api03-syntheticfixturekey0000'].join('-');
  const rows = parseAiderHistory(fixture('aider-history.md').replace('SECRET_PLACEHOLDER', secret), 'greeting');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'aider');
  assert.equal(rows[0].readOnly, true);
  assert.equal(rows[0].approvals, 'none');
  assert.match(rows[0].note, /no approval hook/);
  assert.equal(rows[0].model, 'gpt-4.1');
  assert.equal(rows[0].usages[0].usage.input_tokens, 1200);
  assert.equal(rows[0].usages[0].usage.output_tokens, 80);
  assert.equal(rows[0].usages[1].usage.cache_read_input_tokens, 12);
  assert.equal(rows[0].usages[1].usage.output_tokens, 40);
  assert.equal(rows[0].usages[2].usage.input_tokens, 2803);
  assert.equal(rows[0].usages[2].usage.output_tokens, 172);
  const stored = redactSecrets(rows[0].events.map(ev => ev.text).join('\n'));
  assert.equal(stored.includes(secret), false);
  assert.match(stored, /\[redacted\]/);
});

test('hook decisions fail safe and never invent an allow', () => {
  const gemini = adaptHook(JSON.parse(fixture('gemini-before-tool.json')), 'gemini');
  assert.equal(gemini.hold, true);
  assert.equal(gemini.body.hook_event_name, 'PermissionRequest');
  assert.equal(gemini.always, false);
  assert.deepEqual(hookDecision('gemini', 'deny', gemini.body, permissionDecision), { decision: 'deny', reason: 'Denied in Kovan' });
  assert.deepEqual(hookDecision('gemini', 'wait', gemini.body, permissionDecision), {});
  const codex = adaptHook(JSON.parse(fixture('codex-permission.json')), 'codex');
  const allow = hookDecision('codex', 'allow', codex.body, permissionDecision);
  assert.equal(allow.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(allow.hookSpecificOutput.decision.updatedPermissions, undefined);
  const always = hookDecision('codex', 'always', codex.body, permissionDecision);
  assert.equal(always.hookSpecificOutput.decision.updatedPermissions, undefined);
  assert.equal(hookDecision('codex', '', codex.body, permissionDecision).hookSpecificOutput, undefined);
  assert.equal(openCodeReply('deny').reply, 'reject');
  assert.equal(openCodeReply('allow').reply, 'once');
  assert.equal(openCodeReply('nope'), null);
  assert.equal(adaptHook({ hook_event_name: 'BeforeModel' }, 'gemini'), null);
});
