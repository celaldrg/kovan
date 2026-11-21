// Usage meter, local-only: sums the tokens Claude Code itself recorded in its session logs
// (~/.claude/projects/**/*.jsonl) for the last 5 hours and 7 days, plus Kovan's own runs.
// No credentials are read and nothing leaves the machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const H5 = 5 * 3600e3, D7 = 7 * 86400e3;
let cache = null;

function* jsonlFiles(dir, since, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) yield* jsonlFiles(p, since, depth + 1);
    else if (e.name.endsWith('.jsonl')) { try { if (fs.statSync(p).mtimeMs >= since) yield p; } catch {} }
  }
}

export function readUsage(ownRuns = []) {
  const now = Date.now();
  if (cache && now - cache.at < 60e3) return withOwn(cache, ownRuns, now);
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let session = 0, week = 0, found = false;
  const seen = new Set();
  // Forced demo mode (screen recordings) never reads the local logs.
  const files = process.env.KOVAN_DEMO === '1' ? [] : jsonlFiles(root, now - D7);
  for (const file of files) {
    found = true;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const j = JSON.parse(line);
        const u = j.message?.usage; const ts = Date.parse(j.timestamp);
        if (!u || !ts || now - ts > D7) continue;
        const key = j.message?.id || j.uuid; if (key && seen.has(key)) continue; if (key) seen.add(key);
        const n = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        week += n; if (now - ts <= H5) session += n;
      } catch {}
    }
  }
  cache = { at: now, found, session, week };
  return withOwn(cache, ownRuns, now);
}

function withOwn(c, ownRuns, now) {
  const own5 = ownRuns.filter(r => now - r.at <= H5).reduce((a, r) => a + r.tokens, 0);
  const own7 = ownRuns.filter(r => now - r.at <= D7).reduce((a, r) => a + r.tokens, 0);
  return { source: c.found ? 'claude-code-logs' : 'kovan-only', session: c.found ? c.session : own5, week: c.found ? c.week : own7, kovan: { session: own5, week: own7 } };
}
