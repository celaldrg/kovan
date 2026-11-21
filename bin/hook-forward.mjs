#!/usr/bin/env node
// Forwards a Claude Code command-hook payload to Kovan. SessionStart cannot be
// an HTTP hook, so the installer registers this command instead. If Kovan is
// down or slow, the process still exits 0 and prints nothing: Claude Code
// continues, and a permission prompt is never auto-allowed from here.
import fs from 'node:fs';

const port = process.env.KOVAN_PORT || '4700';
const url = process.env.KOVAN_HOOK_URL || `http://127.0.0.1:${port}/api/hooks`;
const body = fs.readFileSync(0, 'utf8');
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), Number(process.env.KOVAN_HOOK_TIMEOUT_MS || 8000));
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: ac.signal,
  });
  const text = await res.text();
  if (res.ok && text.trim().startsWith('{')) process.stdout.write(text.trim());
} catch { /* Kovan is not running. Leave the decision to Claude Code. */ }
clearTimeout(timer);
process.exit(0);
