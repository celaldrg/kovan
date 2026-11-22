#!/usr/bin/env node
// Forwards a Claude Code command-hook payload to Kovan. The launch token is
// read from data/token on each call and sent as x-kovan-token. If Kovan is
// down, the token is missing, or the wait ends, this process exits 0 and
// prints nothing: Claude Code continues, and a permission is never auto-allowed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardHook } from '../server/hook-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let body = '';
try { body = fs.readFileSync(0, 'utf8'); } catch { body = ''; }
let out = '';
try {
  out = await forwardHook(body, process.argv.slice(2), process.env, {
    defaultTokenFile: path.join(here, '..', 'data', 'token'),
  });
} catch { out = ''; }
if (out) process.stdout.write(out);
process.exit(0);
