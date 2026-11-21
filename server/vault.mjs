// Reads a folder of Markdown notes with [[wiki links]] into a graph, ranks notes for a task,
// and writes deliverables back as dated notes.
import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['.git', '.obsidian', 'node_modules', '.trash']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

const words = s => (String(s).toLowerCase().match(/[a-zçğıöşü0-9]{3,}/g) || []);
const STOP = new Set('the and for with that this from your you are our not but all any can will have has into about what when who how why its was were been them they their then than also just more most some such only very each other over under write make draft please give list'.split(' '));

export function createVault(dir) {
  let notes = new Map(); // id -> { id, title, folder, body, links:Set, path }
  const activity = new Map(); // id -> { reads: Set<workerId>, writes: Set<workerId> }

  function idFor(file) { return path.relative(dir, file).replace(/\\/g, '/').replace(/\.md$/i, ''); }

  function resolveLink(raw, fromId) {
    const target = raw.split('|')[0].split('#')[0].trim();
    if (notes.has(target)) return target;
    const low = target.toLowerCase();
    for (const id of notes.keys()) if (id.toLowerCase() === low || id.toLowerCase().endsWith('/' + low)) return id;
    return null;
  }

  function scan() {
    const next = new Map();
    for (const file of walk(dir)) {
      const id = idFor(file);
      if (id.startsWith('Kovan/skills/') || id.startsWith('Kovan/lessons/')) continue;
      const body = fs.readFileSync(file, 'utf8');
      const h = body.match(/^#\s+(.+)$/m);
      next.set(id, { id, title: h ? h[1].trim() : path.basename(id), folder: id.includes('/') ? id.split('/')[0] : 'root', body, rawLinks: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]), path: file });
    }
    notes = next;
    for (const n of notes.values()) n.links = new Set(n.rawLinks.map(l => resolveLink(l, n.id)).filter(Boolean).filter(x => x !== n.id));
    return notes.size;
  }
  scan();

  function touch(id, worker, kind) {
    if (!activity.has(id)) activity.set(id, { reads: new Set(), writes: new Set() });
    activity.get(id)[kind].add(worker);
  }

  return {
    dir,
    scan,
    size: () => notes.size,
    graph() {
      const nodes = [...notes.values()].map(n => {
        const a = activity.get(n.id);
        return { id: n.id, title: n.title, folder: n.folder, reads: a ? [...a.reads] : [], writes: a ? [...a.writes] : [] };
      });
      const links = [];
      for (const n of notes.values()) for (const t of n.links) links.push({ source: n.id, target: t });
      return { nodes, links };
    },
    note(id) {
      const n = notes.get(id);
      if (!n) return null;
      const backlinks = [...notes.values()].filter(x => x.links.has(id)).map(x => x.id);
      const a = activity.get(id);
      return { id, title: n.title, body: n.body, links: [...n.links], backlinks, reads: a ? [...a.reads] : [], writes: a ? [...a.writes] : [] };
    },
    /** Top-k notes by keyword overlap, with one hop of link expansion. Home/index notes always help. */
    relevant(text, k = 4) {
      const q = new Set(words(text).filter(w => !STOP.has(w)));
      const scored = [];
      for (const n of notes.values()) {
        if (n.id.startsWith('Kovan/')) continue;
        const ws = words(n.title + ' ' + n.title + ' ' + n.body);
        let s = 0;
        for (const w of ws) if (q.has(w)) s += 1;
        for (const w of q) if (n.id.toLowerCase().includes(w)) s += 3;
        if (s) scored.push([s / Math.sqrt(ws.length + 10), n]);
      }
      scored.sort((a, b) => b[0] - a[0]);
      const pick = scored.slice(0, k).map(x => x[1]);
      if (pick.length < k) for (const n of pick.slice()) for (const l of n.links) if (pick.length < k && !pick.find(p => p.id === l)) pick.push(notes.get(l));
      const home = [...notes.values()].find(n => /^(home|index|readme)$/i.test(n.id));
      if (home && !pick.includes(home)) pick.push(home);
      return pick.map(n => ({ id: n.id, title: n.title, body: n.body.slice(0, 2500) }));
    },
    markRead: (ids, worker) => ids.forEach(id => touch(id, worker, 'reads')),
    /** Writes a deliverable note under Kovan/outputs and returns its id. */
    writeDeliverable({ worker, title, body, sources = [], meta = {} }) {
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      const slug = String(title).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'output';
      const rel = `Kovan/outputs/${day}-${slug}-${Math.random().toString(36).slice(2, 6)}.md`;
      const front = ['---', `worker: ${worker.id}`, `role: ${worker.role}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`), `created: ${d.toISOString()}`, '---'].join('\n');
      const text = `${front}\n# ${title}\n\n${body.trim()}\n\n---\nSources: ${sources.map(s => `[[${s}]]`).join(', ') || '—'}\n`;
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      scan();
      const id = rel.replace(/\.md$/, '');
      touch(id, worker.id, 'writes');
      return id;
    },
  };
}
