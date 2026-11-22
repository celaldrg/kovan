// Model backends: the local Claude Code CLI (preferred), the Anthropic Messages API, or a
// built-in demo writer so the hive is alive with no setup at all.
import { spawn, spawnSync } from 'node:child_process';
import { sumUsage } from '../shared/hooks.js';

function packResult(text, usage, extra = {}) {
  const reported = usage && typeof usage === 'object' ? usage : null;
  return { text, tokens: reported ? sumUsage(reported) : 0, usage: reported, ...extra };
}

export const MODELS = ['sonnet', 'opus', 'haiku'];
export const EFFORTS = ['', 'low', 'medium', 'high'];
const DEFAULT_IDS = { sonnet: 'claude-sonnet-4-5', opus: 'claude-opus-4-1', haiku: 'claude-haiku-4-5' };

/** Model ids come from config, then env, then the built-in defaults. */
export function modelIds(cfg = {}) {
  const ids = { ...DEFAULT_IDS, ...(cfg.modelIds || {}) };
  if (process.env.KOVAN_MODEL_SONNET) ids.sonnet = process.env.KOVAN_MODEL_SONNET;
  if (process.env.KOVAN_MODEL_OPUS) ids.opus = process.env.KOVAN_MODEL_OPUS;
  if (process.env.KOVAN_MODEL_HAIKU) ids.haiku = process.env.KOVAN_MODEL_HAIKU;
  return ids;
}

export function modelChoices(cfg = {}) {
  const list = Array.isArray(cfg.models) && cfg.models.length ? cfg.models.map(String) : MODELS;
  return list;
}

/** A model id safe to place in a single argv token. Rejects flag-shaped values. */
export function isSafeModelToken(model) {
  return typeof model === 'string' && /^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,127}$/.test(model);
}

/** Empty means "use the default". Null means the caller must reject the value. */
export function acceptModel(model, choices) {
  const value = String(model ?? '').trim();
  if (!value) return '';
  const allowed = (choices || []).map(s => String(s));
  if (!allowed.includes(value) || !isSafeModelToken(value)) return null;
  return value;
}

/**
 * argv for `claude`. The prompt is written to stdin, not placed in argv.
 * `--model=<id>` is one token so a value cannot be parsed as its own flag.
 */
export function cliArgs(model) {
  if (!isSafeModelToken(model)) throw new Error('invalid model');
  return ['-p', '--output-format', 'json', `--model=${model}`, '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,Task'];
}

function hasCli() {
  if (process.env.KOVAN_DEMO === '1') return false;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

export function detectBackend() {
  if (process.env.KOVAN_DEMO === '1') return 'demo';
  if (hasCli()) return 'claude-cli';
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  return 'demo';
}

const EFFORT_HINT = { low: 'Be brief; a quick pass is enough.', medium: '', high: 'Think it through carefully before answering.' };

function runCli(prompt, { model, effort, tools = true, timeoutMs = 10 * 60e3 }) {
  const args = cliArgs(model);
  return new Promise((resolve, reject) => {
    // Workers may use connectors and web search, never the shell or file editing.
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('timed out')); }, timeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('close', code => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(j.result || 'CLI error'));
        resolve(packResult(String(j.result || '').trim(), j.usage || null));
      } catch { reject(new Error(err.trim() || `claude exited ${code}`)); }
    });
    child.stdin.end((EFFORT_HINT[effort] ? EFFORT_HINT[effort] + '\n\n' : '') + prompt);
  });
}

async function runApi(prompt, { model, effort, ids }) {
  const table = ids || modelIds();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.KOVAN_MODEL_ID || table[model] || table.sonnet, max_tokens: effort === 'low' ? 1200 : 4000, messages: [{ role: 'user', content: (EFFORT_HINT[effort] ? EFFORT_HINT[effort] + '\n\n' : '') + prompt }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `API ${r.status}`);
  return packResult(j.content.map(c => c.text || '').join('').trim(), j.usage || null);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- demo writer: plausible, clearly-marked placeholder work ----
function demoText(kind, ctx) {
  const { worker, task, notes = [], lessons = [] } = ctx;
  const cite = notes.slice(0, 3).map(n => `“${n.title}”`).join(', ') || 'the vault';
  if (kind === 'route') return null;
  if (kind === 'chat') {
    return `Hi, ${worker.name} here (${worker.role}). Based on ${cite}, my take on “${task}”: start small, keep it in the company voice, and I can turn it into a full deliverable if you add it as a task. *(demo mode — connect Claude Code for real answers)*`;
  }
  const bullets = notes.slice(0, 3).map(n => `- From **${n.title}**: ${n.body.split('\n').find(l => /^[-\d]/.test(l.trim()))?.replace(/^[-\d.\s]+/, '') || 'context noted.'}`).join('\n');
  return [
    `## ${kind === 'merge' ? 'Combined result' : 'Deliverable'}: ${task}`,
    '',
    `Prepared by ${worker.name}, ${worker.role}.`,
    '',
    '### What I used',
    bullets || '- No matching notes; worked from the brief alone.',
    '',
    '### Draft',
    `1. Goal — ${task}.`,
    '2. Approach — follow the house rules above, keep it short, one clear call to action.',
    '3. Next step — review, then say `revise: …` in my chat if anything should change.',
    lessons.length ? `\n### Rules I followed\n${lessons.map(l => `- ${l}`).join('\n')}` : '',
    '',
    '*Demo mode: this is placeholder output. Install and log in to Claude Code (or set `ANTHROPIC_API_KEY`) for real work.*',
  ].join('\n');
}

export function createAI(backend, cfg = {}) {
  const ids = modelIds(cfg);
  return {
    backend,
    /** kind: 'work' | 'chat' | 'route' | 'split' | 'merge' | 'classify'. ctx is used by the demo writer. */
    async run(prompt, { model = 'sonnet', effort = '', kind = 'work', ctx = {}, tools = true } = {}) {
      if (backend === 'claude-cli') return runCli(prompt, { model, effort, tools: tools && kind !== 'route' && kind !== 'classify' });
      if (backend === 'api') return runApi(prompt, { model, effort, ids });
      await sleep(kind === 'chat' ? 700 : kind === 'route' ? 150 : 3500 + Math.random() * 5000);
      return { text: demoText(kind, ctx) ?? '', tokens: kind === 'route' ? 0 : Math.round(900 + Math.random() * 4200), usage: null, demo: true };
    },
  };
}
