import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelIds, modelChoices } from './ai.mjs';

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
