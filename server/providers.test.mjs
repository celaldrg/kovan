import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerModel, providerStatus, ollamaEndpoint, runOpenAI, runGemini, runOllama, safeProviderError } from './providers.mjs';
import { priceUsage } from '../shared/cost.js';

const cfg = {
  providers: {
    openai: { models: ['gpt-4.1'] },
    gemini: { models: ['gemini-2.5-flash'] },
    ollama: { models: ['llama3.2'] },
  },
};

test('provider model ids stay on the allowlist', () => {
  assert.equal(providerModel('openai:gpt-4.1', cfg).id, 'gpt-4.1');
  assert.equal(providerModel('openai:gpt-4.1-mini', cfg), null);
  assert.equal(providerModel('gemini:gemini-2.5-flash', cfg).id, 'gemini-2.5-flash');
  assert.equal(providerModel('ollama:other', cfg), null);
  assert.equal(providerModel('openai:--flag', cfg), null);
  assert.equal(providerModel('sonnet', cfg).provider, 'claude');
});

test('keys are visible only as booleans and are stripped from errors', () => {
  const key = ['sk', 'proj', 'syntheticfixturekey000000'].join('-');
  const env = { OPENAI_API_KEY: key, GEMINI_API_KEY: '', OLLAMA_HOST: 'http://127.0.0.1:11434' };
  const status = providerStatus(env);
  assert.equal(status.openai, true);
  assert.equal(status.gemini, false);
  assert.equal(JSON.stringify(status).includes(key), false);
  const err = safeProviderError(new Error(`upstream said ${key}`), env);
  assert.equal(err.includes(key), false);
  assert.match(err, /\[redacted\]/);
});

test('Ollama stays on loopback unless remote is explicitly allowed', () => {
  assert.equal(ollamaEndpoint('', { OLLAMA_HOST: '' }), 'http://127.0.0.1:11434');
  assert.equal(ollamaEndpoint('http://127.0.0.1:11434', {}), 'http://127.0.0.1:11434');
  assert.equal(ollamaEndpoint('http://203.0.113.8:11434', {}), null);
  assert.equal(ollamaEndpoint('http://203.0.113.8:11434', { KOVAN_OLLAMA_ALLOW_REMOTE: '1' }), 'http://203.0.113.8:11434');
  assert.equal(ollamaEndpoint('file:///tmp/x', {}), null);
});

test('provider calls send the key as a header and map reported usage', async () => {
  const key = ['sk', 'proj', 'syntheticfixturekey000000'].join('-');
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    if (String(url).includes('openai')) {
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } } }) };
    }
    if (String(url).includes('generativelanguage')) {
      return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gem' }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, cachedContentTokenCount: 1 } }) };
    }
    return { ok: true, text: async () => JSON.stringify({ message: { content: 'local' }, prompt_eval_count: 5, eval_count: 1 }) };
  };
  const openai = await runOpenAI('hello', { model: 'gpt-4.1', env: { OPENAI_API_KEY: key }, fetchImpl });
  assert.equal(openai.text, 'ok');
  assert.equal(openai.usage.input_tokens, 7);
  assert.equal(openai.usage.cache_read_input_tokens, 3);
  assert.equal(seen.init.headers.authorization, `Bearer ${key}`);
  assert.equal(JSON.stringify(seen.init.body).includes(key), false);
  const gemini = await runGemini('hello', { model: 'gemini-2.5-flash', env: { GEMINI_API_KEY: 'AIzaSyntheticFixtureKey0000000' }, fetchImpl });
  assert.equal(gemini.usage.output_tokens, 2);
  assert.equal(seen.url.includes('key='), false);
  const local = await runOllama('hello', { model: 'llama3.2', env: { OLLAMA_HOST: 'http://127.0.0.1:11434' }, fetchImpl });
  assert.equal(local.usage.input_tokens, 5);
  const priced = priceUsage(local.usage, 'ollama:llama3.2');
  assert.equal(priced.ok, true);
  assert.equal(priced.usd, 0);
  const custom = priceUsage({ input_tokens: 10, output_tokens: 2 }, 'ollama:custom-local');
  assert.equal(custom.usd, 0);
  await assert.rejects(() => runOpenAI('hello', { model: 'gpt-4.1', env: {}, fetchImpl }), /OPENAI_API_KEY/);
  await assert.rejects(() => runOllama('hello', { model: 'llama3.2', env: { OLLAMA_HOST: 'http://203.0.113.8:11434' }, fetchImpl }), /loopback/);
});
