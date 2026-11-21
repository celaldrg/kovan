// Department helpers shared by the server (routing) and the web app (command-bar hint).

const fold = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');

/** Every handle a department answers to: id, code, first word of the English and Turkish names. */
export function departmentHandles(d) {
  return [...new Set([d.id, d.code, String(d.name).split(/[\s&]+/)[0], String(d.tr || '').split(/[\s&]+/)[0]].filter(Boolean).map(fold))];
}

/**
 * A task can name its department up front: "@design new pricing page brief" or "finans: march invoices".
 * Returns { dept, task } when it does, otherwise null.
 */
export function pickDepartment(text, depts) {
  const m = String(text || '').match(/^\s*(?:@([\p{L}&-]+)[\s,:]*|([\p{L}&-]+)\s*:\s+)/u);
  if (!m) return null;
  const tag = fold(m[1] || m[2]);
  const d = depts.find(x => departmentHandles(x).includes(tag));
  return d ? { dept: d.id, task: String(text).slice(m[0].length).trim() } : null;
}

const words = s => fold(s).match(/[a-z]{3,}/g) || [];

/** Best-fitting department for free text, by overlap with its name, mission and team skills. '' if nothing fits. */
export function guessDepartment(text, depts, workers = []) {
  const q = new Set(words(text));
  let best = '', top = 0;
  for (const d of depts) {
    const bag = `${d.name} ${d.tr} ${d.mission} ${workers.filter(w => w.dept === d.id).map(w => `${w.role} ${(w.skills || []).join(' ')}`).join(' ')}`;
    const score = new Set(words(bag).filter(x => q.has(x))).size;
    if (score > top) { top = score; best = d.id; }
  }
  return best;
}
