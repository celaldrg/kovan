import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_TABLE, mergePrices } from './prices.js';
import { priceUsage, usageBuckets, usageFromClaudeRow, tokensOf } from './cost.js';
import { budgetLevel, periodStart } from './budget.js';
import { detectRunaway } from './runaway.js';

test('cost math uses each reported bucket and the dated table', () => {
  assert.equal(PRICE_TABLE.dated, '2026-11-09');
  const priced = priceUsage({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
  }, 'claude-sonnet-4-5');
  assert.equal(priced.ok, true);
  assert.equal(priced.model, 'claude-sonnet-4-5');
  assert.equal(priced.dated, '2026-11-09');
  // 3 + 15 + 0.30 + 3.75 + 6
  assert.ok(Math.abs(priced.usd - 28.05) < 1e-9);
  const alias = priceUsage({ input_tokens: 2_000_000, output_tokens: 0 }, 'sonnet');
  assert.ok(Math.abs(alias.usd - 6) < 1e-9);
  const dated = priceUsage({ input_tokens: 1_000_000, output_tokens: 0 }, 'claude-sonnet-4-5-20250929');
  assert.equal(dated.model, 'claude-sonnet-4-5');
  assert.ok(Math.abs(dated.usd - 3) < 1e-9);
});

test('a combined cache write is priced as a 5-minute write and is not double counted', () => {
  const priced = priceUsage({
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 250_000, ephemeral_1h_input_tokens: 750_000 },
  }, 'claude-haiku-4-5');
  // split wins: 0.25 * 1.25 + 0.75 * 2
  assert.ok(Math.abs(priced.usd - (0.25 * 1.25 + 0.75 * 2)) < 1e-9);
  const onlyTotal = priceUsage({ cache_creation_input_tokens: 1_000_000 }, 'claude-haiku-4-5');
  assert.ok(Math.abs(onlyTotal.usd - 1.25) < 1e-9);
});

test('missing usage and unknown models are not given a dollar amount', () => {
  assert.equal(usageBuckets(null), null);
  assert.equal(usageBuckets({}), null);
  assert.equal(usageBuckets({ input_tokens: '100' }), null);
  const missing = priceUsage(undefined, 'sonnet');
  assert.equal(missing.ok, false);
  assert.equal(missing.usd, null);
  const unknown = priceUsage({ input_tokens: 500, output_tokens: 20 }, 'claude-made-up');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unpriced-model');
  assert.equal(unknown.usd, null);
  assert.equal(unknown.buckets.input, 500);
  assert.equal(tokensOf(unknown.buckets), 520);
});

test('a config overlay replaces a price and keeps the date explicit', () => {
  const table = mergePrices(PRICE_TABLE, {
    dated: '2026-12-01',
    models: {
      'claude-sonnet-4-5': { input: 9, output: 9, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 1 },
      'not-a-rate': { input: -1, output: 1, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 1 },
    },
  });
  assert.equal(table.dated, '2026-12-01');
  const priced = priceUsage({ input_tokens: 1_000_000, output_tokens: 0 }, 'sonnet', table);
  assert.ok(Math.abs(priced.usd - 9) < 1e-9);
  assert.equal(priceUsage({ input_tokens: 10 }, 'not-a-rate', table).ok, false);
});

test('haiku 5.5 uses the published long-context rate only from reported tokens', () => {
  const small = priceUsage({ input_tokens: 1000, output_tokens: 1000 }, 'claude-haiku-5-5');
  assert.ok(Math.abs(small.usd - (1000 * 0.1 + 1000 * 0.5) / 1e6) < 1e-12);
  const big = priceUsage({ input_tokens: 150_000, output_tokens: 1000 }, 'claude-haiku-5-5');
  assert.ok(Math.abs(big.usd - (150_000 * 0.5 + 1000 * 2.5) / 1e6) < 1e-12);
});

test('jsonl rows without a usage object or an id are ignored', () => {
  assert.equal(usageFromClaudeRow({ type: 'user', message: { content: 'hi' } }), null);
  const row = usageFromClaudeRow({
    timestamp: '2026-11-22T00:00:00.000Z',
    sessionId: 'ses_lighthouse',
    cwd: '/work/lighthouse-api',
    message: { id: 'msg_1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 4 } },
  });
  assert.equal(row.messageId, 'msg_1');
  assert.equal(row.sessionId, 'ses_lighthouse');
  assert.equal(usageBuckets(row.usage).output, 4);
});

test('budget thresholds warn at 75%, warn harder at 95%, and stop at the limit', () => {
  assert.equal(budgetLevel(74, 100).level, 'ok');
  assert.equal(budgetLevel(75, 100).level, 'warn');
  assert.equal(budgetLevel(94.9, 100).level, 'warn');
  assert.equal(budgetLevel(95, 100).level, 'high');
  assert.equal(budgetLevel(99.9, 100).level, 'high');
  assert.equal(budgetLevel(100, 100).level, 'stop');
  assert.equal(budgetLevel(140, 100).level, 'stop');
  assert.equal(budgetLevel(50, null).level, 'open');
  assert.equal(budgetLevel(50, 0).level, 'open');
  assert.equal(budgetLevel(0, 10).level, 'ok');
  const start = periodStart('day', Date.UTC(2026, 10, 22, 18, 30));
  assert.equal(start, Date.UTC(2026, 10, 22));
  assert.equal(periodStart('month', Date.UTC(2026, 10, 22, 18)).valueOf(), Date.UTC(2026, 10, 1));
  assert.equal(periodStart('session', Date.now()), 0);
});

test('runaway detection flags tool-call spikes, repeated calls, and cost spikes', () => {
  const now = 1_000_000;
  assert.deepEqual(detectRunaway([
    { at: now - 1000, signature: 'Bash npm test' },
    { at: now - 500, signature: 'Read app.ts' },
  ], now), []);
  const loop = detectRunaway(Array.from({ length: 6 }, (_, i) => ({ at: now - i * 1000, signature: 'Bash npm test' })), now);
  assert.equal(loop.some(f => f.kind === 'loop' && f.count === 6), true);
  assert.equal(loop.some(f => f.kind === 'tool-rate'), false);
  const spike = detectRunaway(Array.from({ length: 40 }, (_, i) => ({ at: now - i * 100, signature: `Read file-${i}` })), now, { toolRate: 40 });
  assert.equal(spike.some(f => f.kind === 'tool-rate'), true);
  const cost = detectRunaway([{ at: now - 1000, usd: 2.5, signature: '' }], now, { costUsd: 2 });
  assert.equal(cost.some(f => f.kind === 'cost-rate'), true);
  const old = detectRunaway([{ at: now - 120_000, signature: 'Bash npm test' }], now);
  assert.deepEqual(old, []);
});
