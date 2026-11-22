// Turn a reported usage object into USD. Missing usage stays missing.
// A model that is not on the price table is unpriced: tokens are kept, dollars are not invented.

import { PRICE_TABLE } from './prices.js';

function nonNeg(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Buckets Claude reports. Returns null when the object has no usage numbers.
 * A 5-minute / 1-hour split replaces the combined cache-write total.
 * A combined total with no split is priced as a 5-minute write.
 */
export function usageBuckets(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const input = nonNeg(usage.input_tokens);
  const output = nonNeg(usage.output_tokens);
  const cacheRead = nonNeg(usage.cache_read_input_tokens);
  const cacheWrite = nonNeg(usage.cache_creation_input_tokens);
  const split = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
  const write5 = split ? nonNeg(split.ephemeral_5m_input_tokens) : null;
  const write1 = split ? nonNeg(split.ephemeral_1h_input_tokens) : null;
  const present = [input, output, cacheRead, cacheWrite, write5, write1].some(n => n != null);
  if (!present) return null;
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  if (write5 != null || write1 != null) {
    cacheWrite5m = write5 || 0;
    cacheWrite1h = write1 || 0;
  } else {
    cacheWrite5m = cacheWrite || 0;
  }
  return {
    input: input || 0,
    output: output || 0,
    cacheRead: cacheRead || 0,
    cacheWrite5m,
    cacheWrite1h,
  };
}

export function lookupRate(model, table = PRICE_TABLE) {
  const raw = String(model || '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/-\d{8}$/, '');
  const alias = table.aliases?.[raw] || table.aliases?.[stripped];
  const id = alias || (table.models?.[raw] ? raw : stripped);
  const rate = table.models?.[id] || table.models?.[raw] || null;
  if (!rate) return null;
  return { id: table.models?.[id] ? id : raw, ...rate };
}

function applyLong(rate, buckets) {
  const prompt = buckets.input + buckets.cacheRead + buckets.cacheWrite5m + buckets.cacheWrite1h;
  if (!rate.long || prompt <= rate.long.after) return rate;
  return { ...rate, ...rate.long, id: rate.id };
}

/** Price one reported usage object. `usd` is null when the model is not on the table. */
export function priceUsage(usage, model, table = PRICE_TABLE) {
  const buckets = usageBuckets(usage);
  if (!buckets) return { ok: false, reason: 'no-usage', usd: null, buckets: null, model: String(model || ''), dated: table.dated };
  if (String(model || '').startsWith('ollama:') || model === 'ollama') {
    return { ok: true, reason: 'local', usd: 0, buckets, model: String(model || 'ollama'), dated: table.dated };
  }
  const found = lookupRate(model, table);
  if (!found) return { ok: false, reason: 'unpriced-model', usd: null, buckets, model: String(model || ''), dated: table.dated };
  const rate = applyLong(found, buckets);
  const usd = (
    buckets.input * rate.input
    + buckets.output * rate.output
    + buckets.cacheRead * rate.cacheRead
    + buckets.cacheWrite5m * rate.cacheWrite5m
    + buckets.cacheWrite1h * rate.cacheWrite1h
  ) / 1e6;
  return { ok: true, reason: 'priced', usd, buckets, model: rate.id, dated: table.dated };
}

export function tokensOf(buckets) {
  if (!buckets) return 0;
  return buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite5m + buckets.cacheWrite1h;
}

/** One assistant row from a Claude Code JSONL file. Null when that line has no usage. */
export function usageFromClaudeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const message = row.message && typeof row.message === 'object' ? row.message : null;
  const usage = message?.usage || row.usage;
  const buckets = usageBuckets(usage);
  if (!buckets) return null;
  const messageId = typeof message?.id === 'string' && message.id
    ? message.id
    : (typeof row.uuid === 'string' ? row.uuid : '');
  if (!messageId) return null;
  const at = Date.parse(row.timestamp || '') || 0;
  return {
    messageId,
    model: typeof message?.model === 'string' ? message.model : (typeof row.model === 'string' ? row.model : ''),
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
    at,
    usage,
  };
}
