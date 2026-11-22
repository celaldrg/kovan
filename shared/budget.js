// Budget thresholds. 75% warns, 95% warns harder, 100% stops work Kovan controls.

export const WARN_AT = 0.75;
export const HIGH_AT = 0.95;

const RANK = { open: 0, ok: 1, warn: 2, high: 3, stop: 4 };

export function budgetLevel(spentUsd, limitUsd, thresholds = {}) {
  const warnAt = thresholds.warnAt ?? WARN_AT;
  const highAt = thresholds.highAt ?? HIGH_AT;
  if (typeof limitUsd !== 'number' || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    return { level: 'open', ratio: null, spentUsd: spentUsd || 0, limitUsd: null };
  }
  const spent = typeof spentUsd === 'number' && Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0;
  const ratio = spent / limitUsd;
  let level = 'ok';
  if (ratio >= 1) level = 'stop';
  else if (ratio >= highAt) level = 'high';
  else if (ratio >= warnAt) level = 'warn';
  return { level, ratio, spentUsd: spent, limitUsd };
}

export function worseLevel(a, b) {
  return (RANK[b] || 0) > (RANK[a] || 0) ? b : a;
}

/** UTC day or month. Session budgets use the whole history of that session. */
export function periodStart(period, now) {
  const d = new Date(now);
  if (period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (period === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return 0;
}

export function periodLabel(period) {
  if (period === 'month') return 'this month';
  if (period === 'session') return 'this session';
  return 'today';
}
