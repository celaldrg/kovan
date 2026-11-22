// Parsers for the session formats each CLI actually writes.
// Codex rollout lines follow openai/codex RolloutItem JSONL (session_meta, response_item, event_msg token_count).
// Gemini sessions follow google-gemini/gemini-cli chatRecordingService JSONL.
// OpenCode rows follow the session table and Permission.Request documented by opencode.ai.
// Aider history follows the markdown grammar in aider's own chat history file.
// A hook that does not return a decision is not an allow.

function shortenPaths(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .replace(/\/(?:Users|home|root)\/[^/\s]+/g, '~');
}

export const CLI_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  aider: 'Aider',
};

export function cliLabel(id) {
  return CLI_LABELS[id] || 'Session';
}

function clip(value, n = 180) {
  const t = shortenPaths(value).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** "1.2k" / "38k" / "1200" as used by Aider's token line. */
export function parseTokenCount(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') return Math.round(n * 1000);
  if (unit === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

function textOfParts(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    const one = asObject(content);
    if (one && typeof one.text === 'string') return one.text;
    return '';
  }
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  }).filter(Boolean).join(' ');
}

/**
 * Map a Codex TokenUsage object. input_tokens includes cached tokens in the
 * rollout schema, so cached counts are split out before pricing.
 * Returns cumulative buckets, not a delta.
 */
export function codexUsageBuckets(usage) {
  const row = asObject(usage);
  if (!row) return null;
  const input = num(row.input_tokens);
  const cached = num(row.cached_input_tokens);
  const write = num(row.cache_write_input_tokens);
  const output = num(row.output_tokens);
  if (input === 0 && cached === 0 && write === 0 && output === 0) return null;
  return {
    input_tokens: Math.max(0, input - cached - write),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: write,
    output_tokens: output,
    total: num(row.total_tokens) || input + output,
  };
}

function usageDelta(prev, next) {
  if (!next) return null;
  if (!prev) return { ...next };
  const delta = {
    input_tokens: Math.max(0, next.input_tokens - prev.input_tokens),
    cache_read_input_tokens: Math.max(0, next.cache_read_input_tokens - prev.cache_read_input_tokens),
    cache_creation_input_tokens: Math.max(0, next.cache_creation_input_tokens - prev.cache_creation_input_tokens),
    output_tokens: Math.max(0, next.output_tokens - prev.output_tokens),
    total: next.total,
  };
  const grew = delta.input_tokens + delta.output_tokens + delta.cache_read_input_tokens + delta.cache_creation_input_tokens;
  return grew > 0 ? delta : null;
}

/**
 * Codex rollout JSONL, including the nested session_meta.payload.meta shape
 * and token_count events. `usages` are deltas of total_token_usage so a
 * repeated snapshot is not counted twice.
 */
export function parseCodexRollout(lines, fileSessionId = '') {
  let id = fileSessionId || '';
  let cwd = '';
  let model = '';
  let state = 'idle';
  let activity = '';
  let updated = 0;
  let saw = false;
  let prev = null;
  const usages = [];
  const events = [];
  for (const line of lines) {
    if (!line || !String(line).trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const ts = Date.parse(row.timestamp || '') || 0;
    if (ts) updated = Math.max(updated, ts);
    const payload = asObject(row.payload) || {};
    const meta = asObject(payload.meta) || {};
    if (row.type === 'session_meta') {
      saw = true;
      id = payload.id || meta.id || payload.session_id || id;
      cwd = payload.cwd || meta.cwd || cwd;
      model = payload.model || meta.model || model;
      continue;
    }
    if (row.type === 'turn_context') {
      const turn = asObject(payload.turn_context) || payload;
      if (typeof turn.model === 'string' && turn.model) model = turn.model;
      if (typeof turn.cwd === 'string' && turn.cwd) cwd = turn.cwd;
      continue;
    }
    if (row.type === 'event_msg') {
      const kind = payload.type;
      if (kind === 'user_message') {
        saw = true;
        state = 'working';
        activity = clip(payload.message || payload.text || 'prompt');
        events.push({ kind: 'prompt', at: ts, text: activity, status: 'working' });
      } else if (kind === 'agent_message') {
        saw = true;
        state = 'idle';
        activity = clip(payload.message || payload.text || '');
      } else if (kind === 'task_complete' || kind === 'turn_complete') {
        saw = true;
        state = 'idle';
      } else if (kind === 'error') {
        saw = true;
        state = 'stuck';
        activity = clip(payload.message || payload.error || 'error');
      } else if (kind === 'token_count') {
        const info = asObject(payload.info);
        const next = codexUsageBuckets(info?.total_token_usage);
        const delta = usageDelta(prev, next);
        if (next) prev = next;
        if (delta) {
          usages.push({
            messageId: `codex:${id || fileSessionId}:${next.total}`,
            at: ts,
            model,
            usage: delta,
          });
        }
      }
      continue;
    }
    if (row.type === 'response_item') {
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        saw = true;
        state = 'working';
        const name = payload.name || payload.type || 'tool';
        activity = clip(name);
        events.push({ kind: 'tool', at: ts, tool: String(name), text: activity, status: 'working' });
      } else if (payload.type === 'message' && payload.role === 'assistant') {
        saw = true;
        state = 'idle';
        activity = clip(textOfParts(payload.content) || activity);
      } else if (payload.type === 'message' && payload.role === 'user') {
        saw = true;
        state = 'working';
        activity = clip(textOfParts(payload.content) || 'prompt');
        events.push({ kind: 'prompt', at: ts, text: activity, status: 'working' });
      }
    }
  }
  if (!saw || !id) return null;
  return {
    id, cwd, model, title: '', state, activity, updated, source: 'codex',
    readOnly: true,
    approvals: 'none',
    note: 'Read-only. This Codex session was read from its rollout log. Install Codex hooks to approve from the hive.',
    usages, events,
  };
}

function geminiTokens(tokens) {
  const row = asObject(tokens);
  if (!row) return null;
  const input = num(row.input) + num(row.tool);
  const output = num(row.output) + num(row.thoughts);
  const cached = num(row.cached);
  if (input === 0 && output === 0 && cached === 0) return null;
  return {
    input_tokens: Math.max(0, input - cached),
    output_tokens: output,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

/** Gemini CLI session JSONL: a metadata line, then message lines, plus $set patches. */
export function parseGeminiSession(lines, fileSessionId = '') {
  let sessionId = fileSessionId || '';
  let cwd = '';
  let model = '';
  let summary = '';
  let updated = 0;
  let state = 'idle';
  let activity = '';
  let saw = false;
  const usages = [];
  const events = [];
  const directories = [];
  for (const line of lines) {
    if (!line || !String(line).trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (row.$set && typeof row.$set === 'object') {
      const set = row.$set;
      if (typeof set.sessionId === 'string') sessionId = set.sessionId;
      if (typeof set.summary === 'string') summary = set.summary;
      if (Array.isArray(set.directories)) directories.push(...set.directories.filter(d => typeof d === 'string'));
      const ts = Date.parse(set.lastUpdated || '') || 0;
      if (ts) updated = Math.max(updated, ts);
      continue;
    }
    if (row.sessionId && !row.type) {
      saw = true;
      sessionId = row.sessionId;
      if (Array.isArray(row.directories)) directories.push(...row.directories.filter(d => typeof d === 'string'));
      const ts = Date.parse(row.lastUpdated || row.startTime || '') || 0;
      if (ts) updated = Math.max(updated, ts);
      if (typeof row.summary === 'string') summary = row.summary;
      continue;
    }
    const ts = Date.parse(row.timestamp || '') || 0;
    if (ts) updated = Math.max(updated, ts);
    if (row.type === 'user') {
      saw = true;
      state = 'working';
      activity = clip(textOfParts(row.content) || 'prompt');
      events.push({ kind: 'prompt', at: ts, text: activity, status: 'working' });
    } else if (row.type === 'gemini') {
      saw = true;
      if (typeof row.model === 'string' && row.model) model = row.model;
      const calls = Array.isArray(row.toolCalls) ? row.toolCalls : [];
      if (calls.length) {
        const call = calls[calls.length - 1];
        state = 'working';
        const tool = call.name || 'tool';
        const arg = call.args && (call.args.command || call.args.file_path || call.args.pattern || '');
        activity = clip(`${tool} ${arg}`.trim());
        events.push({ kind: 'tool', at: ts, tool: String(tool), text: activity, status: String(call.status || 'working') });
      } else {
        state = 'idle';
        activity = clip(textOfParts(row.content) || summary || activity);
      }
      const usage = geminiTokens(row.tokens);
      if (usage && row.id) usages.push({ messageId: `gemini:${row.id}`, at: ts, model, usage });
    } else if (row.type === 'error') {
      saw = true;
      state = 'stuck';
      activity = clip(textOfParts(row.content) || 'error');
    }
  }
  if (!saw || !sessionId) return null;
  cwd = directories[0] || '';
  return {
    id: sessionId, cwd, model, title: summary, state, activity, updated, source: 'gemini',
    readOnly: true,
    approvals: 'none',
    note: 'Read-only. This Gemini CLI session was read from its chat log. Install Gemini hooks to approve from the hive.',
    usages, events,
  };
}

/** One OpenCode session row, as stored or exported. Tokens on the row are cumulative. */
export function parseOpenCodeSession(row) {
  const src = asObject(row);
  if (!src || typeof src.id !== 'string' || !src.id) return null;
  const modelObj = asObject(src.model);
  const model = modelObj ? `${modelObj.providerID || 'model'}/${modelObj.id || ''}`.replace(/\/$/, '') : (typeof src.model === 'string' ? src.model : '');
  const directory = typeof src.directory === 'string' ? src.directory : '';
  const title = typeof src.title === 'string' ? src.title : '';
  const updated = num(src.time_updated) || num(src.time_created) || Date.parse(src.updated || '') || 0;
  const busy = num(src.time_busy);
  const idle = num(src.time_idle);
  let state = 'idle';
  if (src.idle_outcome === 'error' || src.idle_outcome === 'failed') state = 'stuck';
  else if (busy && busy >= idle) state = 'working';
  const usage = {
    input_tokens: num(src.tokens_input),
    output_tokens: num(src.tokens_output) + num(src.tokens_reasoning),
    cache_read_input_tokens: num(src.tokens_cache_read),
    cache_creation_input_tokens: num(src.tokens_cache_write),
  };
  const hasUsage = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0;
  return {
    id: src.id,
    cwd: directory,
    model,
    title,
    state,
    activity: clip(title || (state === 'working' ? 'working' : 'idle')),
    updated,
    source: 'opencode',
    readOnly: true,
    approvals: 'none',
    note: 'Read-only until OpenCode\'s local service is reachable. Kovan does not approve from the database alone.',
    usages: hasUsage ? [{ messageId: `opencode:${src.id}:total`, at: updated, model, usage, cumulative: true }] : [],
    events: title ? [{ kind: 'prompt', at: updated, text: title, status: state }] : [],
  };
}

/** Pending OpenCode permission. Supports the current request and the older asked shape. */
export function parseOpenCodePermission(row) {
  const src = asObject(row);
  if (!src) return null;
  const id = typeof src.id === 'string' ? src.id : '';
  const sessionId = typeof src.sessionID === 'string' ? src.sessionID : (typeof src.sessionId === 'string' ? src.sessionId : '');
  if (!id || !sessionId) return null;
  const tool = typeof src.action === 'string' ? src.action : (typeof src.permission === 'string' ? src.permission : 'tool');
  const resources = Array.isArray(src.resources) ? src.resources : (Array.isArray(src.patterns) ? src.patterns : []);
  const command = resources.filter(item => typeof item === 'string').join(' ');
  return { id, sessionId, tool, command, metadata: asObject(src.metadata) || {} };
}

/**
 * service.json is the discovery file: url, pid, and an optional password.
 * Only a loopback URL is accepted. The password is not logged by this parser.
 */
export function parseOpenCodeService(row) {
  const src = asObject(row);
  if (!src || typeof src.url !== 'string') return null;
  let url;
  try { url = new URL(src.url); } catch { return null; }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return {
    origin: url.origin,
    password: typeof src.password === 'string' ? src.password : '',
  };
}

export function openCodeAuthHeader(password) {
  if (!password) return {};
  return { authorization: `Basic ${btoa(`opencode:${password}`)}` };
}

/** Reply body for POST /api/session/{sessionID}/permission/{requestID}/reply. Null is not an allow. */
export function openCodeReply(behavior) {
  if (behavior === 'deny') return { reply: 'reject' };
  if (behavior === 'allow') return { reply: 'once' };
  if (behavior === 'always') return { reply: 'always' };
  return null;
}

const AIDER_HEADER = /^# aider chat started at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s*$/;
// Aider appends an optional "Cost: …" clause after "received." Do not anchor on the end of the line.
const AIDER_TOKENS = /^Tokens:\s+(\S+)\s+sent(?:,\s+(\S+)\s+cache write)?(?:,\s+(\S+)\s+cache hit)?,\s+(\S+)\s+received\.?/;

function hashKey(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).slice(0, 6);
}

/** Split .aider.chat.history.md on the session headers Aider writes. */
export function parseAiderHistory(markdown, fileKey = 'aider') {
  const text = String(markdown || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  const blocks = [];
  let current = null;
  const push = () => { if (current) blocks.push(current); };
  const ensure = (stamp) => {
    if (current) return;
    const idStamp = stamp ? stamp.replace(' ', 'T').replace(/:/g, '-') : 'undated';
    current = {
      id: `aider-${idStamp}-${hashKey(fileKey + idStamp)}`,
      stamp: stamp || '',
      lines: [],
    };
  };
  for (const line of text.split(/\n/)) {
    const header = line.match(AIDER_HEADER);
    if (header) {
      push();
      current = null;
      ensure(`${header[1]} ${header[2]}`);
      continue;
    }
    ensure('');
    current.lines.push(line);
  }
  push();
  return blocks.map(block => reduceAiderBlock(block, fileKey)).filter(Boolean);
}

function reduceAiderBlock(block) {
  let model = '';
  let state = 'idle';
  let activity = '';
  let saw = false;
  const events = [];
  const usages = [];
  let at = Date.parse(block.stamp.replace(' ', 'T') + 'Z') || 0;
  block.lines.forEach((line, index) => {
    if (!line.trim()) return;
    const when = at + index;
    if (line.startsWith('#### ')) {
      saw = true;
      state = 'working';
      activity = clip(line.slice(5));
      events.push({ kind: 'prompt', at: when, text: activity, status: 'working' });
      return;
    }
    if (line.startsWith('> ')) {
      const body = line.slice(2).trim();
      const modelLine = body.match(/^Model:\s+(\S+)/);
      if (modelLine) model = modelLine[1];
      const tokens = body.match(AIDER_TOKENS);
      if (tokens) {
        const sent = parseTokenCount(tokens[1]);
        const write = tokens[2] ? parseTokenCount(tokens[2]) : 0;
        const hit = tokens[3] ? parseTokenCount(tokens[3]) : 0;
        const received = parseTokenCount(tokens[4]);
        if (sent != null && received != null) {
          usages.push({
            messageId: `aider:${block.id}:${index}`,
            at: when,
            model,
            usage: {
              input_tokens: sent,
              output_tokens: received,
              cache_read_input_tokens: hit || 0,
              cache_creation_input_tokens: write || 0,
            },
          });
        }
      }
      if (/^Applied edit to /.test(body) || body.startsWith('Added ')) {
        saw = true;
        state = 'working';
        activity = clip(body);
        events.push({ kind: 'tool', at: when, tool: 'edit', text: activity, status: 'done' });
      }
      return;
    }
    if (!line.startsWith('#')) {
      saw = true;
      state = 'idle';
      activity = clip(line);
    }
  });
  if (!saw) return null;
  return {
    id: block.id,
    cwd: '',
    model,
    title: '',
    state,
    activity: activity || 'aider',
    updated: at,
    source: 'aider',
    readOnly: true,
    approvals: 'none',
    note: 'Read-only. Aider records chat history and can ring when a reply is ready. It has no approval hook.',
    usages,
    events,
  };
}

const GEMINI_EVENT = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  Notification: 'Notification',
  BeforeTool: 'PermissionRequest',
  AfterTool: 'PostToolUse',
  BeforeAgent: 'UserPromptSubmit',
  AfterAgent: 'Stop',
};

/**
 * Turn a Codex or Gemini hook body into the shared hook shape.
 * Gemini BeforeTool is held like a permission request. No decision is added here.
 */
export function adaptHook(body, cli = 'claude') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const name = body.hook_event_name;
  if (cli === 'gemini') {
    const mapped = GEMINI_EVENT[name];
    if (!mapped) return null;
    const next = { ...body, hook_event_name: mapped };
    if (name === 'BeforeAgent' && !next.prompt) next.prompt = 'working';
    if (name === 'AfterAgent' && !next.last_assistant_message) next.last_assistant_message = 'idle';
    return { body: next, cli: 'gemini', hold: name === 'BeforeTool', always: false };
  }
  if (cli === 'codex') {
    return { body, cli: 'codex', hold: name === 'PermissionRequest', always: false };
  }
  return { body, cli: 'claude', hold: name === 'PermissionRequest', always: true };
}

/**
 * Decision JSON for a CLI that can take an approval.
 * An unknown behavior returns an empty object or null: that is not an allow.
 * Codex rejects updatedPermissions on PermissionRequest, so "always" is a single allow.
 * Gemini BeforeTool has no saved-rule field, so "always" is a single allow.
 */
/** Gemini BeforeTool deny used when Kovan does not produce an allow. Exit 2 carries the same reason. */
export const GEMINI_DENY_REASON = 'Kovan did not allow this tool. Nothing was allowed.';

export function geminiDenyBody() {
  return { decision: 'deny', reason: GEMINI_DENY_REASON };
}

/** True only for an explicit allow, deny, or block. `{}` is not a decision. */
export function explicitGeminiDecision(text) {
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.decision !== 'allow' && body.decision !== 'deny' && body.decision !== 'block') return null;
  return body;
}

export function hookDecision(cli, behavior, hook, claudeDecision) {
  if (behavior !== 'allow' && behavior !== 'deny' && behavior !== 'always') {
    return cli === 'opencode' ? null : {};
  }
  if (cli === 'gemini') {
    if (behavior === 'deny') return { decision: 'deny', reason: 'Denied in Kovan' };
    return { decision: 'allow' };
  }
  if (cli === 'codex') {
    const decision = { behavior: behavior === 'deny' ? 'deny' : 'allow' };
    if (decision.behavior === 'deny') decision.message = 'Denied in Kovan';
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  if (cli === 'opencode') return openCodeReply(behavior);
  return claudeDecision(behavior, hook);
}
