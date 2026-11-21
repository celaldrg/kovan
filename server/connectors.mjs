// Links: MCP servers registered with the local Claude Code CLI, read from its `mcp list` output.
import { spawn } from 'node:child_process';

export function parseMcpList(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([^:\s][^:]*):\s+(.*?)\s+-\s+(.*)$/);
    if (!m) continue;
    const status = m[3];
    const ok = /✓|connected/i.test(status) && !/fail|✗|needs/i.test(status);
    out.push({ name: m[1].trim(), ok, status: status.replace(/^[✓✗⚠!\s]+/, '').trim() });
  }
  return out;
}

export function listConnectors(backend, { allow = [], deny = [] } = {}) {
  if (backend !== 'claude-cli') return Promise.resolve({ items: [], note: 'Connectors appear when Claude Code is installed and logged in.' });
  return new Promise(resolve => {
    const child = spawn('claude', ['mcp', 'list'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => child.kill(), 30e3);
    child.stdout.on('data', d => (out += d));
    child.on('error', () => { clearTimeout(t); resolve({ items: [], note: 'Could not run `claude mcp list`.' }); });
    child.on('close', () => {
      clearTimeout(t);
      const lc = s => s.toLowerCase();
      const items = parseMcpList(out).map(c => ({
        ...c,
        usable: c.ok && !deny.map(lc).includes(lc(c.name)) && (!allow.length || allow.map(lc).includes(lc(c.name))),
      }));
      resolve({ items, note: items.length ? '' : 'No MCP servers connected yet.' });
    });
  });
}
