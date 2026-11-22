#!/usr/bin/env node
// `kovan` starts the local server. `kovan hooks install` merges hooks.
// The npm package name is `@celaldrg/kovan`. The bin name stays `kovan`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../server/config.mjs';
import { installHooks, uninstallHooks } from '../server/hooks-settings.mjs';
import { installOptionalHooks, uninstallOptionalHooks } from '../server/cli-hooks.mjs';
import { createAudit } from '../server/audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const forwarder = path.join(here, 'hook-forward.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'kovan.config.json'), 'utf8'));
    if (cfg.port) return Number(cfg.port);
  } catch { /* default */ }
  return 4700;
}

function flagValue(argv, name) {
  const eq = argv.find(arg => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return '';
}

function dataDir() {
  return path.resolve(ROOT, process.env.KOVAN_DATA || 'data');
}

function help() {
  console.log(`Kovan (${pkg.name})

  npx ${pkg.name}                 start the local server
  kovan                           same, from a clone: node bin/kovan.mjs
  kovan hooks install             merge hooks into Claude Code user settings
  kovan hooks uninstall           remove Kovan's hooks, leave yours in place
  kovan audit verify              check the local approval hash chain
  kovan audit export --since <d>  print audit JSONL from a date or timestamp

  --settings <file>   Claude settings file
  --port <n>          port written into hook commands

The package name is ${pkg.name}. Publishing runs from a GitHub release, not from a pull request.
If Kovan is not running, or a Claude or Codex permission request times out, that CLI keeps its own prompt.
Gemini BeforeTool is an explicit deny unless you choose Allow. A rules file that does not parse never auto-allows.`);
}

const argv = process.argv.slice(2);
const [group, action] = argv;

if (!group || group === 'start') {
  await import('../server/index.mjs');
} else if (group === 'help' || group === '--help' || group === '-h') {
  help();
} else if (group === 'audit' && (action === 'verify' || action === 'export')) {
  const dir = dataDir();
  const audit = createAudit({
    file: path.join(dir, 'audit.jsonl'),
    headFile: path.join(dir, 'audit.head'),
  });
  if (action === 'verify') {
    const result = audit.verify();
    if (!result.ok) {
      console.log(`${result.error || 'broken'}${result.seq ? ` seq ${result.seq}` : ''}`);
      process.exit(1);
    }
    console.log(`ok ${result.checked}`);
  } else {
    const since = flagValue(argv, '--since');
    const exported = audit.exportSince(since);
    if (exported.error) {
      console.error('audit export needs --since <date>');
      process.exit(1);
    }
    for (const row of exported.records) process.stdout.write(`${JSON.stringify(row)}\n`);
  }
} else if (group === 'hooks' && (action === 'install' || action === 'uninstall')) {
  const file = settingsFile(argv);
  try {
    if (action === 'install') {
      const result = installHooks({ file, port: portFrom(argv), forwarder });
      console.log(`Kovan hooks installed in ${result.file}`);
      console.log(`  endpoint  ${result.url}`);
      console.log(`  backup    ${result.backup || '(new file, nothing to back up)'}`);
      console.log('Start Kovan with `npx ' + pkg.name + '` or `npm start`, then open a Claude Code session.');
      console.log('Each launch writes a new token in the data directory. The hook reads data/token unless KOVAN_DATA is set.');
      console.log('If Kovan is stopped, Claude Code keeps its own permission prompt.');
      try {
        const extra = installOptionalHooks({ port: portFrom(argv), forwarder });
        if (!extra.installed.length) console.log('Codex and Gemini CLI were not detected, so no extra hooks were written.');
        for (const item of extra.installed) {
          console.log(`Kovan hooks installed for ${item.cli} in ${item.file}`);
          console.log('Gemini BeforeTool exits 2 with a deny unless you choose Allow. Codex PermissionRequest prints nothing and leaves its own prompt.');
        }
      } catch (err) {
        console.error(err.message || err);
      }
    } else {
      const result = uninstallHooks({ file });
      if (!result.removed) console.log(`No settings file at ${file}`);
      else console.log(`Kovan hooks removed from ${result.file}\n  backup  ${result.backup}`);
      try {
        const extra = uninstallOptionalHooks();
        for (const item of extra.removed) console.log(`Kovan hooks removed for ${item.cli} from ${item.file}`);
      } catch (err) {
        console.error(err.message || err);
      }
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
} else {
  help();
  process.exit(1);
}
