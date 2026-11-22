// Published list prices, USD per 1,000,000 tokens.
// Dated from Anthropic's pricing page and the 2026-11-09 list-price card.
// Override any row in kovan.config.json under "prices". Unknown models stay unpriced.

export const PRICE_DATED = '2026-11-09';
export const PRICE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

/** Cache writes that are not split into 5-minute and 1-hour buckets use the 5-minute rate. */
export const PRICE_TABLE = {
  dated: PRICE_DATED,
  source: PRICE_SOURCE,
  models: {
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
    'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
    'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
    'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
    'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
    'claude-haiku-5-5': {
      input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2,
      long: { after: 100000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 },
    },
  },
  aliases: {
    sonnet: 'claude-sonnet-4-5',
    opus: 'claude-opus-4-1',
    haiku: 'claude-haiku-4-5',
  },
};

function finiteRate(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

export function validRate(rate) {
  if (!rate || typeof rate !== 'object') return false;
  return ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'].every(k => finiteRate(rate[k]));
}

/** Config overlay. Invalid rows are ignored. The dated field stays explicit. */
export function mergePrices(base, overlay, extraAliases = {}) {
  const models = { ...base.models };
  const custom = [];
  if (overlay && typeof overlay === 'object' && overlay.models && typeof overlay.models === 'object') {
    for (const [id, rate] of Object.entries(overlay.models)) {
      if (!validRate(rate)) continue;
      const long = rate.long && validRate(rate.long) && finiteRate(rate.long.after) ? { after: rate.long.after, ...rateFields(rate.long) } : undefined;
      models[id] = { ...rateFields(rate), ...(long ? { long } : {}) };
      custom.push(id);
    }
  }
  const aliases = { ...base.aliases };
  for (const [alias, id] of Object.entries(extraAliases || {})) {
    if (typeof id === 'string' && id.trim()) aliases[alias] = id.trim();
  }
  if (overlay && overlay.aliases && typeof overlay.aliases === 'object') {
    for (const [alias, id] of Object.entries(overlay.aliases)) {
      if (typeof id === 'string' && id.trim()) aliases[alias] = id.trim();
    }
  }
  return {
    dated: typeof overlay?.dated === 'string' && overlay.dated.trim() ? overlay.dated.trim() : base.dated,
    source: base.source,
    models,
    aliases,
    custom,
  };
}

function rateFields(rate) {
  return {
    input: rate.input,
    output: rate.output,
    cacheRead: rate.cacheRead,
    cacheWrite5m: rate.cacheWrite5m,
    cacheWrite1h: rate.cacheWrite1h,
  };
}
