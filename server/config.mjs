// Loads kovan.config.json (+ optional kovan.config.local.json) and crew.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

export function loadConfig() {
  const base = readJson(path.join(ROOT, 'kovan.config.json'), {});
  const local = readJson(path.join(ROOT, 'kovan.config.local.json'), {});
  const cfg = { name: 'Kovan', vault: './vault', port: 4700, model: 'sonnet', effort: '', mode: 'live', connectors: { allow: [], deny: [] }, swarm: { enabled: true, max: 3 }, modelIds: {}, ...base, ...local };
  if (process.env.KOVAN_MODE === 'company' || process.env.KOVAN_MODE === 'live') cfg.mode = process.env.KOVAN_MODE;
  if (process.env.KOVAN_PORT) cfg.port = Number(process.env.KOVAN_PORT);
  if (process.env.KOVAN_VAULT) cfg.vault = process.env.KOVAN_VAULT;
  cfg.vaultDir = path.resolve(ROOT, cfg.vault);
  cfg.dataDir = path.resolve(ROOT, process.env.KOVAN_DATA || 'data');
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

/** crew.json (departments + workers), then crew.local.json overrides by worker id (name/role/does/skills/brief/model). */
export function loadCrew() {
  const raw = readJson(path.join(ROOT, 'crew.json'), { departments: [], workers: [] });
  // departments are first-class; older files that used "combs"/"comb" still load
  const depts = (raw.departments || raw.combs || []).map(d => ({ code: d.id.slice(0, 3).toUpperCase(), tr: d.focus || '', mission: '', icon: 'Hexagon', ...d }));
  const crew = { depts, workers: (raw.workers || []).map(({ comb, ...w }) => ({ ...w, dept: w.dept || comb })) };
  const local = readJson(path.join(ROOT, 'crew.local.json'), { workers: [] });
  for (const o of local.workers || []) {
    const w = crew.workers.find(x => x.id === o.id);
    if (!w) continue;
    for (const k of ['name', 'role', 'does', 'skills', 'brief', 'model', 'effort']) if (o[k] !== undefined) w[k] = o[k];
  }
  return crew;
}
