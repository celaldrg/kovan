#!/usr/bin/env node
// `npx kovan hooks install` merges Kovan into Claude Code user settings.
// `npx kovan hooks uninstall` removes only those entries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHooks, uninstallHooks, hookUrl } from '../server/hooks-settings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const forwarder = path.join(here, 'hook-forward.mjs');

function settingsFile(argv) {
  const flag = argv.indexOf('--settings');
  if (flag >= 0 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(root, 'settings.json');
}

function portFrom(argv) {
  const flag = argv.indexOf('--port');
  if (flag >= 0 && argv[flag + 1]) return Number(argv[flag + 1]);
  if (process.env.KOVAN_PORT) return Number(process.env.KOVAN_PORT);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve('kovan.config.json'), 'utf8'));
    if (cfg.port) return Number(cfg.port);
  } catch { /* default */ }
  return 4700;
}

const argv = process.argv.slice(2);
const [group, action] = argv;
if (group !== 'hooks' || (action !== 'install' && action !== 'uninstall')) {
  console.log(`Kovan hooks

  npx kovan hooks install      merge Kovan into Claude Code user settings
  npx kovan hooks uninstall    remove Kovan's hooks, leave yours in place

  --settings <file>   settings file (default: ~/.claude/settings.json)
  --port <n>          Kovan port (default: 4700, or kovan.config.json)

If Kovan is not running, or a permission request times out, Claude Code
falls back to its normal terminal prompt. Kovan never auto-allows.`);
  process.exit(group ? 1 : 0);
}

const file = settingsFile(argv);
try {
  if (action === 'install') {
    const result = installHooks({ file, port: portFrom(argv), forwarder });
    console.log(`Kovan hooks installed in ${result.file}`);
    console.log(`  endpoint  ${result.url}`);
    console.log(`  backup    ${result.backup || '(new file, nothing to back up)'}`);
    console.log('Start Kovan with `npm start`, then open a Claude Code session.');
    console.log('If Kovan is stopped, Claude Code keeps its own permission prompt.');
  } else {
    const result = uninstallHooks({ file });
    if (!result.removed) console.log(`No settings file at ${file}`);
    else console.log(`Kovan hooks removed from ${result.file}\n  backup  ${result.backup}`);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

void hookUrl;
