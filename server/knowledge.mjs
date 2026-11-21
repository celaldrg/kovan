// Skills (how a kind of work is done) and lessons (what a worker learned from revisions),
// both plain Markdown inside the vault so the user owns and edits them.
import fs from 'node:fs';
import path from 'node:path';

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    meta[kv[1]] = v;
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

export function readSkillShelf(vaultDir) {
  const dir = path.join(vaultDir, 'Kovan', 'skills');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { meta, body } = frontMatter(fs.readFileSync(file, 'utf8'));
    const extras = fs.readdirSync(path.join(dir, name)).filter(f => f !== 'SKILL.md' && /\.(md|txt)$/i.test(f))
      .map(f => ({ file: f, text: fs.readFileSync(path.join(dir, name, f), 'utf8').slice(0, 3000) }));
    out.push({ name: meta.name || name, about: meta.about || '', workers: [].concat(meta.workers || []), depts: [].concat(meta.departments || meta.depts || meta.combs || []), body, extras });
  }
  return out;
}

export const skillsFor = (skills, worker) => skills.filter(s => s.workers.includes(worker.id) || s.depts.includes(worker.dept));

const lessonFile = (vaultDir, id) => path.join(vaultDir, 'Kovan', 'lessons', `${id}.md`);

export function readLessons(vaultDir, id) {
  let text = '';
  try { text = fs.readFileSync(lessonFile(vaultDir, id), 'utf8'); } catch { return { rules: [], oneOffs: [] }; }
  const section = h => (text.split(new RegExp(`^## ${h}\\s*$`, 'm'))[1] || '').split(/^## /m)[0]
    .split('\n').map(l => l.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
  return { rules: section('Standing rules'), oneOffs: section('One-offs') };
}

export function addLesson(vaultDir, worker, note, standing) {
  const cur = readLessons(vaultDir, worker.id);
  (standing ? cur.rules : cur.oneOffs).push(note.replace(/\s+/g, ' ').trim());
  const file = lessonFile(vaultDir, worker.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# What ${worker.name} has learned\n\nThis file is yours. Remove a bullet and the bee forgets it; promote a one-off into Standing rules and it applies everywhere.\n\n## Standing rules\n${cur.rules.map(r => `- ${r}`).join('\n')}\n\n## One-offs\n${cur.oneOffs.map(r => `- ${r}`).join('\n')}\n`);
  return cur;
}

/** Cheap local guess at whether a correction is a standing rule. */
export const looksStanding = note => /\b(always|never|every time|from now on|in general|don't ever|stop)\b|her zaman|asla|bundan sonra|hiçbir zaman/i.test(note);
