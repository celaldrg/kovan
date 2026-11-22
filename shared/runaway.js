// Flag a session that is spending or calling tools far faster than a normal stretch of work.
// This only reports a flag. It does not allow or deny a tool.

const DEFAULTS = {
  windowMs: 60_000,
  toolRate: 40,
  loopCount: 6,
  costUsd: 2,
};

export function detectRunaway(events, now, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const recent = (events || []).filter(e => e && typeof e.at === 'number' && now - e.at <= cfg.windowMs && now - e.at >= 0);
  const flags = [];
  const tools = recent.filter(e => e.signature);
  if (tools.length >= cfg.toolRate) {
    flags.push({ kind: 'tool-rate', count: tools.length, detail: `${tools.length} tool calls in ${Math.round(cfg.windowMs / 1000)}s` });
  }
  const counts = new Map();
  for (const e of tools) counts.set(e.signature, (counts.get(e.signature) || 0) + 1);
  let loopSig = '';
  let loopN = 0;
  for (const [sig, n] of counts) {
    if (n > loopN) { loopN = n; loopSig = sig; }
  }
  if (loopN >= cfg.loopCount) {
    flags.push({ kind: 'loop', count: loopN, signature: loopSig, detail: `repeated ${loopN} times: ${loopSig}` });
  }
  const usd = recent.reduce((sum, e) => sum + (typeof e.usd === 'number' ? e.usd : 0), 0);
  if (usd >= cfg.costUsd) {
    flags.push({ kind: 'cost-rate', usd, detail: `$${usd.toFixed(2)} in ${Math.round(cfg.windowMs / 1000)}s` });
  }
  return flags;
}
