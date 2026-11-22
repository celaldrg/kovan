// Search and retention for locally recorded session timelines.
// Recording itself lives next to the server; this module is pure.

export function searchTimeline(events, filter = {}) {
  const list = Array.isArray(events) ? events : [];
  const q = String(filter.q || '').trim().toLowerCase();
  const cli = String(filter.cli || '').trim();
  const project = String(filter.project || '').trim();
  const status = String(filter.status || '').trim();
  const from = filter.from ? Date.parse(filter.from) : 0;
  const to = filter.to ? Date.parse(filter.to) : 0;
  return list.filter(ev => {
    if (!ev || typeof ev !== 'object') return false;
    if (cli && ev.cli !== cli) return false;
    if (project && ev.project !== project) return false;
    if (status && ev.status !== status) return false;
    if (from && (!ev.at || ev.at < from)) return false;
    if (to && (!ev.at || ev.at > to)) return false;
    if (!q) return true;
    const hay = `${ev.text || ''} ${ev.tool || ''} ${ev.project || ''} ${ev.cli || ''} ${ev.kind || ''} ${ev.status || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Keep events inside the retention window. A non-positive day count keeps nothing. */
export function retainEvents(events, now, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return [];
  const cutoff = now - n * 86400e3;
  return (Array.isArray(events) ? events : []).filter(ev => ev && typeof ev.at === 'number' && ev.at >= cutoff);
}

export function sessionIds(events) {
  const ids = [];
  const seen = new Set();
  for (const ev of events || []) {
    if (!ev?.sessionId || seen.has(ev.sessionId)) continue;
    seen.add(ev.sessionId);
    ids.push(ev.sessionId);
  }
  return ids;
}
