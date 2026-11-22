#!/usr/bin/env node
// Forwards a command-hook payload to Kovan. The launch token is read from
// data/token on each call and sent as x-kovan-token.
// Claude Code and Codex exit 0 and print nothing when Kovan does not answer.
// That is not an allow. Gemini BeforeTool exits 2 with a deny instead, because
// Gemini treats a missing decision and a killed hook as continue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geminiDenyBody } from '../shared/agents.js';
import { resolveHook } from '../server/hook-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let body = '';
try { body = fs.readFileSync(0, 'utf8'); } catch { body = ''; }
let result = { stdout: '', stderr: '', exitCode: 0 };
try {
  result = await resolveHook(body, process.argv.slice(2), process.env, {
    defaultTokenFile: path.join(here, '..', 'data', 'token'),
  });
} catch {
  const cli = process.argv.includes('--cli') ? process.argv[process.argv.indexOf('--cli') + 1] : '';
  let event = '';
  try { event = JSON.parse(body).hook_event_name || ''; } catch { event = ''; }
  if (cli === 'gemini' && event === 'BeforeTool') {
    const deny = geminiDenyBody();
    result = { stdout: `${JSON.stringify(deny)}\n`, stderr: `${deny.reason}\n`, exitCode: 2 };
  }
}
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.exitCode);
