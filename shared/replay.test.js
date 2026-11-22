import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTimeline, retainEvents } from './replay.js';

const events = [
  { at: Date.parse('2026-04-01T00:00:00Z'), cli: 'codex', project: 'harbor-docs', status: 'working', kind: 'prompt', tool: '', text: 'Add a dock note' },
  { at: Date.parse('2026-04-02T00:00:00Z'), cli: 'aider', project: 'keel-notes', status: 'idle', kind: 'tool', tool: 'edit', text: 'Applied edit to greeting.py' },
  { at: Date.parse('2026-04-03T00:00:00Z'), cli: 'gemini', project: 'atlas-notes', status: 'denied', kind: 'approval', tool: 'run_shell_command', text: 'Denied in Kovan' },
];

test('search filters by text, cli, project, date and status', () => {
  assert.equal(searchTimeline(events, { q: 'dock' }).length, 1);
  assert.equal(searchTimeline(events, { q: 'DOCK', cli: 'aider' }).length, 0);
  assert.equal(searchTimeline(events, { project: 'keel-notes', status: 'idle' })[0].tool, 'edit');
  assert.equal(searchTimeline(events, { from: '2026-04-03T00:00:00Z', cli: 'gemini' }).length, 1);
  assert.equal(searchTimeline(events, { to: '2026-04-01T12:00:00Z' }).length, 1);
  assert.equal(searchTimeline(events, { q: 'missing' }).length, 0);
});

test('retention drops events outside the window', () => {
  const now = Date.parse('2026-04-03T00:00:00Z');
  const kept = retainEvents(events, now, 1);
  assert.deepEqual(kept.map(ev => ev.cli), ['aider', 'gemini']);
  assert.equal(retainEvents(events, now, 0.5).map(ev => ev.cli).join(','), 'gemini');
  assert.equal(retainEvents(events, now, 0).length, 0);
});
