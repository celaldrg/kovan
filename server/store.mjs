// Tiny JSON-file persistence with atomic writes.
import fs from 'node:fs';
import path from 'node:path';

export function jsonStore(file, initial) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { value = structuredClone(initial); }
  let timer = null;
  const flush = () => {
    timer = null;
    const tmp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  };
  return {
    get: () => value,
    save() { if (!timer) timer = setTimeout(flush, 50); },
    flushNow() { if (timer) clearTimeout(timer); flush(); },
  };
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
