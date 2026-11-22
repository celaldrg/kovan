// Company-mode calls for OpenAI, Gemini and local Ollama.
// Keys are read from the environment at call time. They are not written to disk and not returned in errors.
import { redactKeys } from '../shared/redact.js';

function isSafeModelToken(model) {
  return typeof model === 'string' && /^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,127}$/.test(model);
}

export const PROVIDER_NAMES = ['openai', 'gemini', 'ollama'];

export function providerCatalog(cfg = {}) {
  const spec = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  const models = (name, fallback) => {
    const list = spec[name] && Array.isArray(spec[name].models) ? spec[name].models.map(String) : fallback;
    return list.filter(id => isSafeModelToken(id));
  };
  return {
    openai: { models: models('openai', ['gpt-4.1', 'gpt-4.1-mini']) },
    gemini: { models: models('gemini', ['gemini-2.5-pro', 'gemini-2.5-flash']) },
    ollama: { models: models('ollama', ['llama3.2']) },
  };
}

export function providerOf(model) {
  const value = String(model || '');
  const cut = value.indexOf(':');
  if (cut <= 0) return 'claude';
  const name = value.slice(0, cut);
  return PROVIDER_NAMES.includes(name) ? name : 'claude';
}

/** The bare model id, or null when it is not on that provider's allowlist. */
export function providerModel(model, cfg = {}) {
  const provider = providerOf(model);
  if (provider === 'claude') return { provider, id: String(model || '') };
  const id = String(model).slice(provider.length + 1);
  const allowed = providerCatalog(cfg)[provider].models;
  if (!allowed.includes(id) || !isSafeModelToken(id)) return null;
  return { provider, id };
}

export function providerStatus(env = process.env) {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
    ollama: true,
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
  };
}

export function safeProviderError(err, env = process.env) {
  const keys = [env.OPENAI_API_KEY, env.GEMINI_API_KEY, env.GOOGLE_API_KEY, env.ANTHROPIC_API_KEY];
  return redactKeys(err && err.message ? err.message : 'request failed', keys).slice(0, 300);
}

/** Loopback unless KOVAN_OLLAMA_ALLOW_REMOTE=1. A bad host is null, not a thrown error. */
export function ollamaEndpoint(raw, env = process.env) {
  const value = raw || env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loop = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!loop && env.KOVAN_OLLAMA_ALLOW_REMOTE !== '1') return null;
  return url.origin;
}

function usageFromOpenAI(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = Number(usage.prompt_tokens) || 0;
  const cached = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  if (!prompt && !output) return null;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: output,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

function usageFromGemini(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const prompt = Number(meta.promptTokenCount) || 0;
  const cached = Number(meta.cachedContentTokenCount) || 0;
  const output = (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0);
  if (!prompt && !output) return null;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: output,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 180) } }; }
}

export async function runOpenAI(prompt, { model, env = process.env, fetchImpl = globalThis.fetch, maxTokens = 1200 } = {}) {
  const key = env.OPENAI_API_KEY || '';
  if (!key) throw new Error('OpenAI is not configured. Set OPENAI_API_KEY.');
  if (!isSafeModelToken(model)) throw new Error('invalid model');
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(safeProviderError(new Error(body?.error?.message || `OpenAI ${res.status}`), env));
  const text = body.choices?.[0]?.message?.content || '';
  return { text: String(text).trim(), usage: usageFromOpenAI(body.usage) };
}

export async function runGemini(prompt, { model, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  if (!key) throw new Error('Gemini is not configured. Set GEMINI_API_KEY.');
  if (!isSafeModelToken(model)) throw new Error('invalid model');
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(safeProviderError(new Error(body?.error?.message || `Gemini ${res.status}`), env));
  const text = (body.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
  return { text: text.trim(), usage: usageFromGemini(body.usageMetadata) };
}

export async function runOllama(prompt, { model, host, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const origin = ollamaEndpoint(host, env);
  if (!origin) throw new Error('Ollama host must be loopback. Set OLLAMA_HOST to http://127.0.0.1:11434.');
  if (!isSafeModelToken(model)) throw new Error('invalid model');
  const res = await fetchImpl(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(safeProviderError(new Error(body?.error || `Ollama ${res.status}`), env));
  const input = Number(body.prompt_eval_count) || 0;
  const output = Number(body.eval_count) || 0;
  const usage = input || output ? { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } : null;
  return { text: String(body.message?.content || '').trim(), usage };
}
