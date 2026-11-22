// Per-launch API token. The file is mode 0600 and the value is never logged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function launchToken(file) {
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'w' });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows does not use POSIX modes. */ }
  return token;
}

export function tokenMatches(presented, expected) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const given = typeof presented === 'string' ? presented.trim() : '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
