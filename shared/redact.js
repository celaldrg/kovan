// Strip obvious secrets before anything is written to the local replay store.
// This is a pattern pass, not a guarantee. Paths are shortened separately.

const RULES = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/sk-proj-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/sk-[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]'],
  [/ghp_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/github_pat_[A-Za-z0-9_]{16,}/g, '[redacted]'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/AKIA[0-9A-Z]{16}/g, '[redacted]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]'],
  [/(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*['"]?[^\s'"]{6,}/gi, '$1=[redacted]'],
];

export function redactSecrets(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  return text;
}

/** Remove known key strings from an error before it is shown or logged. */
export function redactKeys(value, keys = []) {
  let text = redactSecrets(value);
  for (const key of keys) {
    if (typeof key === 'string' && key.length >= 6) text = text.split(key).join('[redacted]');
  }
  return text;
}
