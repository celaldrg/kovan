import { parseCodexRollout } from './agents.js';

// Claude Code hook payloads and the permission reply Kovan sends back.
// Event names and field shapes follow the Claude Code hooks reference
// (SessionStart, SessionEnd, Notification, Stop, StopFailure, PreToolUse,
// PostToolUse, PermissionRequest, PermissionDenied, SubagentStart, SubagentStop,
// UserPromptSubmit). Unknown events are ignored.

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'Notification',
  'Stop',
  'StopFailure',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'UserPromptSubmit',
];

const EVENT_SET = new Set(HOOK_EVENTS);

/** Strip home-directory prefixes so the UI never has to render a local absolute path. */
export function redactPaths(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .replace(/\/(?:Users|home|root)\/[^/\s]+/g, '~');
}

export function projectName(cwd) {
  const clean = String(cwd || '').replace(/[\\/]+$/, '');
  const base = clean.split(/[/\\]/).filter(Boolean).pop() || '';
  return base || 'session';
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Normalize one hook POST body. Returns null when the body is not a hook we understand. */
export function parseHook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const name = body.hook_event_name;
  if (!EVENT_SET.has(name)) return null;
  if (typeof body.session_id !== 'string' || !body.session_id.trim()) return null;
  const toolInput = asObject(body.tool_input);
  return {
    name,
    sessionId: body.session_id.trim(),
    cwd: typeof body.cwd === 'string' ? body.cwd : '',
    permissionMode: typeof body.permission_mode === 'string' ? body.permission_mode : '',
    agentId: typeof body.agent_id === 'string' ? body.agent_id : '',
    agentType: typeof body.agent_type === 'string' ? body.agent_type : '',
    model: typeof body.model === 'string' ? body.model : '',
    source: typeof body.source === 'string' ? body.source : '',
    reason: typeof body.reason === 'string' ? body.reason : '',
    message: typeof body.message === 'string' ? body.message : '',
    notificationType: typeof body.notification_type === 'string' ? body.notification_type : '',
    title: typeof body.session_title === 'string' ? body.session_title : (typeof body.title === 'string' ? body.title : ''),
    toolName: typeof body.tool_name === 'string' ? body.tool_name : '',
    toolInput,
    lastAssistantMessage: typeof body.last_assistant_message === 'string' ? body.last_assistant_message : '',
    stopHookActive: body.stop_hook_active === true,
    backgroundTasks: Array.isArray(body.background_tasks) ? body.background_tasks : [],
    permissionSuggestions: Array.isArray(body.permission_suggestions) ? body.permission_suggestions : [],
    error: typeof body.error === 'string' ? body.error : '',
    errorDetails: typeof body.error_details === 'string' ? body.error_details : '',
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
  };
}

function clip(s, n) {
  const t = redactPaths(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** A short unified diff for Edit / Write, safe to show on an approval card. */
export function describeToolCall(toolName, input) {
  const tool = String(toolName || 'tool');
  const src = asObject(input);
  const file = typeof src.file_path === 'string' ? src.file_path : '';
  const fileLabel = file ? projectName(file) === file ? file : projectName(file) : '';
  let command = '';
  if (typeof src.command === 'string') command = src.command;
  else if (file) command = fileLabel;
  else if (typeof src.pattern === 'string') command = src.pattern;
  else if (typeof src.query === 'string') command = src.query;
  else if (typeof src.url === 'string') command = src.url;
  else if (typeof src.prompt === 'string') command = src.prompt;
  else if (typeof src.description === 'string') command = src.description;
  let diff = '';
  if ((tool === 'Edit' || tool === 'StrReplace') && (src.old_string || src.new_string)) {
    const fileHead = fileLabel || 'file';
    const oldLines = String(src.old_string || '').split('\n');
    const newLines = String(src.new_string || '').split('\n');
    diff = [`--- ${fileHead}`, `+++ ${fileHead}`]
      .concat(oldLines.map(l => '- ' + l), newLines.map(l => '+ ' + l))
      .join('\n');
  } else if (tool === 'Write' && typeof src.content === 'string') {
    const fileHead = fileLabel || 'file';
    diff = [`+++ ${fileHead}`].concat(String(src.content).split('\n').slice(0, 80).map(l => '+ ' + l)).join('\n');
  } else if (typeof src.description === 'string' && src.description && src.description !== command) {
    diff = src.description;
  }
  return {
    tool,
    command: clip(command, 2000),
    diff: redactPaths(diff).slice(0, 8000),
    file: fileLabel,
  };
}

/**
 * PermissionRequest reply. `always` echoes Claude's own allow suggestions when
 * it sent them, otherwise a session-scoped allow rule. An empty object is the
 * fail-safe: Claude Code keeps its normal terminal prompt.
 */
export function permissionDecision(behavior, hook) {
  if (behavior !== 'allow' && behavior !== 'deny' && behavior !== 'always') return {};
  const decision = { behavior: behavior === 'always' ? 'allow' : behavior };
  if (decision.behavior === 'deny') decision.message = 'Denied in Kovan';
  if (behavior === 'always') {
    const suggested = (hook?.permissionSuggestions || []).filter(s => s && s.behavior === 'allow');
    if (suggested.length) decision.updatedPermissions = suggested.map(s => ({ ...s }));
    else {
      const tool = hook?.toolName || 'Bash';
      const rule = { toolName: tool };
      if ((tool === 'Bash' || tool === 'PowerShell') && hook?.toolInput?.command) {
        rule.ruleContent = String(hook.toolInput.command).slice(0, 200);
      }
      decision.updatedPermissions = [{ type: 'addRules', rules: [rule], behavior: 'allow', destination: 'session' }];
    }
  }
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => (b && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join(' ');
}

function blocks(content) {
  return Array.isArray(content) ? content : [];
}

/**
 * Best-effort state from a Claude Code session JSONL when hooks are not installed.
 * Hooks remain the exact source once they have spoken for a session.
 */
export function reduceClaudeJsonl(lines, fileSessionId = '') {
  let id = fileSessionId || '';
  let cwd = '';
  let model = '';
  let title = '';
  let state = 'idle';
  let activity = '';
  let updated = 0;
  let saw = false;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (typeof row.sessionId === 'string' && row.sessionId) id = row.sessionId;
    if (typeof row.cwd === 'string' && row.cwd) cwd = row.cwd;
    const ts = Date.parse(row.timestamp || '') || 0;
    if (ts) updated = Math.max(updated, ts);
    const msg = row.message && typeof row.message === 'object' ? row.message : null;
    if (msg?.model && typeof msg.model === 'string') model = msg.model;
    if (row.type === 'summary' && typeof row.summary === 'string') title = row.summary;
    if (row.isApiErrorMessage || row.error) {
      saw = true;
      state = 'stuck';
      activity = clip(row.error || textOf(msg?.content) || 'model error', 180);
      continue;
    }
    if (row.type === 'user' && msg) {
      const content = msg.content;
      const toolResultOnly = Array.isArray(content) && content.length > 0 && content.every(b => b && b.type === 'tool_result');
      if (!toolResultOnly) {
        saw = true;
        state = 'working';
        activity = clip(textOf(content) || 'prompt', 180);
      }
      continue;
    }
    if (row.type === 'assistant' && msg) {
      saw = true;
      const content = blocks(msg.content);
      const tool = [...content].reverse().find(b => b && b.type === 'tool_use');
      if (tool) {
        state = 'working';
        const d = describeToolCall(tool.name, tool.input);
        activity = clip(`${d.tool} ${d.command}`.trim(), 180);
      } else {
        state = 'idle';
        activity = clip(textOf(msg.content), 180);
      }
    }
  }
  if (!saw || !id) return null;
  return { id, cwd, model, title, state, activity, updated, source: 'claude' };
}

/** Best-effort read of a Codex rollout JSONL. Unrecognised lines are skipped. */
export function reduceCodexJsonl(lines, fileSessionId = '') {
  const row = parseCodexRollout(lines, fileSessionId);
  if (!row) return null;
  return {
    id: row.id, cwd: row.cwd, model: row.model, title: row.title || '', state: row.state,
    activity: row.activity, updated: row.updated, source: 'codex',
    readOnly: true, approvals: 'none', note: row.note, usages: row.usages, events: row.events,
  };
}

/** Sum every token bucket Claude records, including cache reads. */
export function sumUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return (usage.input_tokens || 0)
    + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}
