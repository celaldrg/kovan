import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelIds, modelChoices, cliArgs, acceptModel, isSafeModelToken } from './ai.mjs';

test('model ids are configurable and env wins over config', () => {
  const prev = process.env.KOVAN_MODEL_HAIKU;
  process.env.KOVAN_MODEL_HAIKU = 'claude-haiku-custom';
  const ids = modelIds({ modelIds: { sonnet: 'claude-sonnet-custom', haiku: 'from-config' } });
  assert.equal(ids.sonnet, 'claude-sonnet-custom');
  assert.equal(ids.haiku, 'claude-haiku-custom');
  assert.equal(ids.opus, 'claude-opus-4-1');
  assert.deepEqual(modelChoices({ models: ['haiku', 'sonnet'] }), ['haiku', 'sonnet']);
  if (prev === undefined) delete process.env.KOVAN_MODEL_HAIKU;
  else process.env.KOVAN_MODEL_HAIKU = prev;
});

test('cli model is one allowlisted argv token', () => {
  assert.deepEqual(cliArgs('sonnet'), ['-p', '--output-format', 'json', '--model=sonnet', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,Task']);
  assert.equal(cliArgs('claude-sonnet-4-5').includes('--model=claude-sonnet-4-5'), true);
  assert.equal(isSafeModelToken('--dangerously-skip-permissions'), false);
  assert.throws(() => cliArgs('--dangerously-skip-permissions'), /invalid model/);
  assert.throws(() => cliArgs('sonnet --dangerously-skip-permissions'), /invalid model/);
  const choices = modelChoices({ models: ['sonnet', 'opus', 'haiku'] });
  assert.equal(acceptModel('sonnet', choices), 'sonnet');
  assert.equal(acceptModel('', choices), '');
  assert.equal(acceptModel('<img src=x onerror=alert(1)>', choices), null);
  assert.equal(acceptModel('--model', choices), null);
  assert.equal(acceptModel('gpt', choices), null);
});
