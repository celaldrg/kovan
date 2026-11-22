// Live hive: one bee per Claude Code session (and one per subagent), one zone per
// working directory. Hook events are exact. Session JSONL is only a fallback for
// sessions that have never reported a hook.
import path from 'node:path';
import { parseHook, describeToolCall, permissionDecision, projectName, redactPaths } from '../shared/hooks.js';
import { adaptHook, hookDecision, cliLabel, geminiDenyBody } from '../shared/agents.js';
import { GEMINI_SERVER_WAIT_MS } from './hook-client.mjs';

const PALETTE = ['#5b8def', '#3ee6c8', '#f5b13d', '#f472b6', '#a3e635', '#c084fc', '#fb923c', '#38bdf8'];

function clip(s, n = 180) {
  const t = redactPaths(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function colorFor(id) {
  let h = 0;
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function zoneKey(cwd) {
  const name = projectName(cwd || 'session').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'session';
  let h = 2166136261;
  for (const c of String(cwd || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `${name}-${(h >>> 0).toString(16).slice(0, 4)}`;
}

export function createLive({ emit = () => {}, now = () => Date.now(), permissionWaitMs = GEMINI_SERVER_WAIT_MS, gate = null, onRecord = null } = {}) {
  const sessions = new Map();
  const subs = new Map();
  const pending = new Map();
  let hooked = false;

  function changed() { emit('live', snapshot()); }

  function ensureSession(id, cwd) {
    let s = sessions.get(id);
    if (!s) {
      s = {
        id, cwd: cwd || '', project: projectName(cwd || ''), model: '', title: '',
        state: 'idle', activity: 'session started', updated: now(), started: now(),
        hooked: false, source: 'claude', attention: '',
        readOnly: false, approvals: 'hooks', note: '', always: true,
      };
      sessions.set(id, s);
    }
    if (cwd && cwd !== s.cwd) { s.cwd = cwd; s.project = projectName(cwd); }
    s.updated = now();
    return s;
  }

  function permsFor(beeId) {
    return [...pending.values()].filter(p => p.beeId === beeId || p.sessionId === beeId).sort((a, b) => a.since - b.since);
  }

  function refreshState(session) {
    if (permsFor(session.id).length) { session.state = 'needs-you'; return; }
  }

  function mark(session, state, activity) {
    if (activity) session.activity = clip(activity);
    if (permsFor(session.id).length && state !== 'needs-you') {
      session.state = 'needs-you';
      return;
    }
    session.state = state;
    if (state !== 'needs-you') session.attention = '';
  }

  function record(event) {
    if (!onRecord) return;
    try { onRecord(event); } catch { /* recording must not break the hive */ }
  }

  function apply(ev) {
    hooked = true;
    if (ev.name === 'SubagentStart' || ev.name === 'SubagentStop') {
      const parent = ensureSession(ev.sessionId, ev.cwd);
      parent.hooked = true;
      if (ev.cli) parent.source = ev.cli;
      parent.readOnly = false;
      parent.approvals = 'hooks';
      mark(parent, 'working', ev.name === 'SubagentStart' ? `spawned ${ev.agentType || 'subagent'}` : parent.activity);
      const sid = ev.agentId || `${ev.sessionId}:${ev.agentType || 'subagent'}`;
      if (ev.name === 'SubagentStop') {
        const sub = subs.get(sid);
        if (sub) { sub.state = 'idle'; sub.activity = clip(ev.lastAssistantMessage || 'subagent finished'); sub.updated = now(); }
        if (!permsFor(parent.id).length && parent.state !== 'stuck') mark(parent, 'working', parent.activity);
        return;
      }
      subs.set(sid, {
        id: sid, parentId: parent.id, cwd: parent.cwd, project: parent.project,
        agentType: ev.agentType || 'subagent', state: 'working', activity: ev.agentType || 'subagent',
        updated: now(), source: 'claude',
      });
      return;
    }

    if (ev.name === 'SessionEnd') {
      for (const [id, sub] of subs) if (sub.parentId === ev.sessionId) subs.delete(id);
      for (const [id, p] of pending) if (p.sessionId === ev.sessionId) { p.finish(p.cli === 'gemini' ? geminiDenyBody() : {}); }
      sessions.delete(ev.sessionId);
      return;
    }

    const session = ensureSession(ev.sessionId, ev.cwd);
    session.hooked = true;
    if (ev.cli) session.source = ev.cli;
    session.readOnly = false;
    session.approvals = 'hooks';
    if (ev.always === false) session.always = false;
    if (ev.model) session.model = ev.model;
    if (ev.title) session.title = ev.title;

    if (ev.name === 'SessionStart') {
      mark(session, permsFor(session.id).length ? 'needs-you' : 'idle', ev.source ? `session ${ev.source}` : 'session started');
      return;
    }
    if (ev.name === 'UserPromptSubmit') {
      mark(session, 'working', ev.prompt || 'working');
      record({ sessionId: session.id, cli: session.source, project: session.project, status: 'working', kind: 'prompt', text: ev.prompt || session.activity, at: now() });
      return;
    }
    if (ev.name === 'PreToolUse' || ev.name === 'PostToolUse') {
      const d = describeToolCall(ev.toolName, ev.toolInput);
      const line = `${d.tool}${d.command ? ' ' + d.command : ''}`.trim();
      gate?.noteTool?.({ sessionId: ev.sessionId, project: session.project, signature: line, at: now() });
      if (ev.agentId && subs.has(ev.agentId)) {
        const sub = subs.get(ev.agentId);
        sub.state = 'working';
        sub.activity = clip(line);
        sub.updated = now();
      }
      mark(session, 'working', ev.name === 'PostToolUse' ? `finished ${line}` : line);
      record({ sessionId: session.id, cli: session.source, project: session.project, status: 'working', kind: 'tool', tool: d.tool, text: line, at: now() });
      return;
    }
    if (ev.name === 'Stop') {
      if (ev.backgroundTasks.length) mark(session, 'working', ev.backgroundTasks[0].description || 'background work');
      else mark(session, 'idle', ev.lastAssistantMessage || 'idle');
      return;
    }
    if (ev.name === 'StopFailure') {
      session.attention = '';
      if (!permsFor(session.id).length) session.state = 'stuck';
      session.activity = clip(ev.errorDetails || ev.error || ev.lastAssistantMessage || 'model error');
      return;
    }
    if (ev.name === 'PermissionDenied') {
      const d = describeToolCall(ev.toolName, ev.toolInput);
      mark(session, 'working', `denied ${d.tool} ${d.command}`.trim());
      return;
    }
    if (ev.name === 'Notification') {
      if (ev.notificationType === 'idle_prompt') mark(session, 'idle', ev.message || 'idle');
      else if (ev.notificationType === 'permission_prompt' || ev.notificationType === 'agent_needs_input') {
        session.attention = clip(ev.message || 'Needs you');
        if (!permsFor(session.id).length) session.state = 'needs-you';
        session.activity = session.attention;
      } else if (ev.notificationType === 'agent_completed') mark(session, 'idle', ev.message || 'finished');
      else if (ev.message) session.activity = clip(ev.message);
      return;
    }
  }

  function openPermission(ev) {
    const session = ensureSession(ev.sessionId, ev.cwd);
    session.hooked = true;
    if (ev.cli) {
      session.source = ev.cli;
      session.readOnly = false;
      session.approvals = ev.approvals || 'hooks';
      session.always = ev.always !== false;
    }
    const d = describeToolCall(ev.toolName, ev.toolInput);
    const beeId = ev.agentId && subs.has(ev.agentId) ? ev.agentId : session.id;
    const id = `p_${Math.random().toString(36).slice(2, 10)}`;
    const since = now();
    session.state = 'needs-you';
    session.activity = clip(`${d.tool} ${d.command}`.trim() || 'waiting for approval');
    if (beeId !== session.id) {
      const sub = subs.get(beeId);
      sub.state = 'needs-you';
      sub.activity = session.activity;
      sub.updated = since;
    }
    return { id, beeId, sessionId: session.id, since, tool: d.tool, command: d.command, diff: d.diff, file: d.file, suggestions: ev.permissionSuggestions, toolName: ev.toolName, toolInput: ev.toolInput };
  }

  function decided(body) {
    if (!body || typeof body !== 'object') return false;
    if (body.hookSpecificOutput) return true;
    if (body.decision === 'allow' || body.decision === 'deny') return true;
    if (body.reply === 'once' || body.reply === 'always' || body.reply === 'reject') return true;
    return false;
  }

  function handleHook(raw, { signal, cli } = {}) {
    const adapted = adaptHook(raw, cli || 'claude');
    if (!adapted) return Promise.resolve({});
    const ev = parseHook(adapted.body);
    if (!ev) return Promise.resolve({});
    ev.cli = adapted.cli;
    ev.always = adapted.always;
    if (raw && raw.usage && gate?.noteUsage) {
      const messageId = typeof raw.message_id === 'string' ? raw.message_id : (typeof raw.uuid === 'string' ? raw.uuid : '');
      const entry = gate.noteUsage({
        source: 'hook', sessionId: ev.sessionId, cwd: ev.cwd, model: ev.model || (typeof raw.model === 'string' ? raw.model : ''),
        usage: raw.usage, messageId, at: now(),
      });
      if (entry) {
        record({
          sessionId: ev.sessionId, cli: ev.cli, project: projectName(ev.cwd), status: entry.priced ? 'priced' : 'unknown',
          kind: 'cost', text: entry.priced ? 'priced from reported tokens' : 'cost unknown', at: now(),
        });
      }
    }
    if (ev.name !== 'PermissionRequest') {
      apply(ev);
      changed();
      return Promise.resolve({});
    }
    hooked = true;
    const session = ensureSession(ev.sessionId, ev.cwd);
    const block = gate?.blockPermission?.(session);
    if (block?.level === 'stop') {
      session.attention = block.message;
      const body = hookDecision(ev.cli, 'deny', ev, permissionDecision);
      if (body.hookSpecificOutput?.decision) body.hookSpecificOutput.decision.message = block.message;
      else if (typeof body.reason === 'string') body.reason = block.message;
      changed();
      record({ sessionId: session.id, cli: session.source, project: session.project, status: 'denied', kind: 'approval', text: block.message, at: now() });
      return Promise.resolve(body);
    }
    const card = openPermission(ev);
    const unanswered = () => (ev.cli === 'gemini' ? geminiDenyBody() : {});
    let finish = () => {};
    const result = new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => finish(unanswered()), permissionWaitMs);
      if (signal) signal.addEventListener('abort', () => finish(unanswered()), { once: true });
      finish = (body) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(card.id);
        const session = sessions.get(card.sessionId);
        const answered = decided(body);
        if (session && !permsFor(session.id).length && session.state === 'needs-you' && !answered) {
          session.state = 'working';
          session.activity = 'waiting in the terminal';
          record({ sessionId: session.id, cli: session.source, project: session.project, status: 'timeout', kind: 'approval', text: 'no decision', tool: card.tool, at: now() });
        }
        const sub = subs.get(card.beeId);
        if (sub && !permsFor(sub.id).length && sub.state === 'needs-you' && !answered) sub.state = 'working';
        resolve(answered ? body : {});
        changed();
      };
    });
    pending.set(card.id, { ...card, finish, raw: ev, cli: ev.cli, always: ev.always !== false });
    changed();
    return result;
  }

  function answer(id, behavior) {
    const item = pending.get(id);
    if (!item) return false;
    if (behavior !== 'allow' && behavior !== 'deny' && behavior !== 'always') return false;
    const sessionForGate = sessions.get(item.sessionId);
    if ((behavior === 'allow' || behavior === 'always') && gate?.blockPermission?.(sessionForGate)?.level === 'stop') {
      behavior = 'deny';
    }
    const cli = item.cli || 'claude';
    const body = hookDecision(cli, behavior, {
      ...item.raw,
      permissionSuggestions: item.suggestions,
      toolName: item.toolName,
      toolInput: item.toolInput,
    }, permissionDecision);
    if (!decided(body)) return false;
    if (item.deliver && item.deliver(body) === false) return false;
    if (behavior === 'deny' && gate?.blockPermission?.(sessionForGate)?.level === 'stop') {
      const block = gate.blockPermission(sessionForGate);
      if (body.hookSpecificOutput?.decision) body.hookSpecificOutput.decision.message = block.message;
      else if (typeof body.reason === 'string') body.reason = block.message;
    }
    const session = sessions.get(item.sessionId);
    if (session) {
      session.activity = clip(behavior === 'deny' ? `denied ${item.tool}` : `allowed ${item.tool}`);
      if (permsFor(session.id).length <= 1) session.state = 'working';
      record({
        sessionId: session.id, cli: session.source, project: session.project,
        status: behavior === 'deny' ? 'denied' : 'allowed', kind: 'approval', tool: item.tool, text: session.activity, at: now(),
      });
    }
    const sub = subs.get(item.beeId);
    if (sub && permsFor(sub.id).length <= 1) sub.state = 'working';
    item.finish(body);
    return true;
  }

  /** JSONL fallback. Ignored for sessions that have already received a hook. */
  function applyLog(rec) {
    if (!rec || !rec.id) return;
    const existing = sessions.get(rec.id);
    if (existing?.hooked) return;
    const session = ensureSession(rec.id, rec.cwd);
    if (session.hooked) return;
    const known = ['claude', 'codex', 'gemini', 'opencode', 'aider'];
    session.source = known.includes(rec.source) ? rec.source : 'claude';
    session.readOnly = rec.readOnly !== false;
    session.approvals = rec.approvals || 'none';
    session.note = typeof rec.note === 'string' ? rec.note : session.note;
    session.always = false;
    if (rec.model) session.model = rec.model;
    if (rec.title) session.title = rec.title;
    session.state = rec.state || 'idle';
    if (rec.activity) session.activity = clip(rec.activity);
    if (rec.updated) session.updated = rec.updated;
    if (Array.isArray(rec.usages)) {
      for (const usage of rec.usages) {
        if (!usage || !usage.usage || !usage.messageId) continue;
        const entry = gate?.noteUsage?.({
          source: 'jsonl', sessionId: session.id, cwd: session.cwd, model: usage.model || session.model,
          usage: usage.usage, messageId: usage.messageId, at: usage.at || now(),
        });
        if (entry) {
          record({
            sessionId: session.id, cli: session.source, project: session.project,
            status: entry.priced ? 'priced' : 'unknown', kind: 'cost', text: entry.priced ? 'priced from reported tokens' : 'cost unknown', at: entry.at || now(),
          });
        }
      }
    }
    if (Array.isArray(rec.events)) {
      for (const event of rec.events) {
        record({ ...event, sessionId: session.id, cli: session.source, project: session.project, at: event.at || session.updated });
      }
    }
    changed();
  }

  /** A permission that is answered over another CLI's local API, not a stdin hook. */
  function holdExternal(spec) {
    if (!spec || !spec.sessionId || !spec.requestId) return '';
    for (const item of pending.values()) if (item.externalId === spec.requestId) return item.id;
    const ev = {
      name: 'PermissionRequest', sessionId: spec.sessionId, cwd: spec.cwd || '', cli: spec.cli || 'opencode',
      toolName: spec.toolName || 'tool', toolInput: spec.toolInput || {}, permissionSuggestions: [],
      always: spec.cli === 'opencode', approvals: 'api',
    };
    const session = ensureSession(ev.sessionId, ev.cwd);
    session.hooked = true;
    session.source = ev.cli;
    session.readOnly = false;
    session.approvals = 'api';
    session.always = true;
    if (spec.model) session.model = spec.model;
    if (spec.title) session.title = spec.title;
    hooked = true;
    const card = openPermission(ev);
    let finish = () => {};
    finish = (body) => {
      pending.delete(card.id);
      changed();
      return body;
    };
    pending.set(card.id, { ...card, finish, raw: ev, cli: ev.cli, always: true, externalId: spec.requestId, deliver: spec.deliver });
    changed();
    return card.id;
  }

  function beeView(session, kind, extra = {}) {
    const cards = permsFor(extra.id || session.id);
    const card = cards[0];
    const mark = gate?.decorate?.(session) || {};
    return {
      id: extra.id || session.id,
      sessionId: session.id,
      kind,
      project: session.project,
      zone: zoneKey(session.cwd),
      name: extra.name || session.title || session.project || 'session',
      role: extra.role || session.model || cliLabel(session.source),
      model: session.model || '',
      state: extra.state || session.state,
      activity: extra.activity || session.activity || '',
      updated: extra.updated || session.updated,
      source: session.source,
      readOnly: session.readOnly === true,
      approvals: session.approvals || 'none',
      note: session.note || '',
      always: session.always !== false,
      attention: session.attention || '',
      permission: card ? { id: card.id, tool: card.tool, command: card.command, diff: card.diff, file: card.file, since: card.since } : null,
      cost: mark.cost || null,
      budget: mark.budget || null,
      runaway: mark.runaway || null,
      budgetBlock: !!mark.budgetBlock,
    };
  }

  function snapshot() {
    const list = [];
    for (const session of sessions.values()) list.push(beeView(session, 'session'));
    for (const sub of subs.values()) {
      const parent = sessions.get(sub.parentId);
      if (!parent) continue;
      list.push(beeView(parent, 'subagent', {
        id: sub.id,
        name: sub.agentType || 'subagent',
        role: 'subagent',
        state: sub.state,
        activity: sub.activity,
        updated: sub.updated,
      }));
    }
    const queue = [];
    for (const item of pending.values()) {
      const session = sessions.get(item.sessionId);
      queue.push({
        id: item.id,
        beeId: item.beeId,
        sessionId: item.sessionId,
        project: session?.project || 'session',
        name: session?.title || session?.project || 'session',
        tool: item.tool,
        command: item.command,
        diff: item.diff,
        file: item.file,
        since: item.since,
        cli: session?.source || item.cli || 'claude',
        always: item.always !== false,
        externalId: item.externalId || '',
      });
    }
    queue.sort((a, b) => a.since - b.since);
    const zones = new Map();
    for (const bee of list) {
      if (!zones.has(bee.zone)) zones.set(bee.zone, { id: bee.zone, name: bee.project, color: colorFor(bee.zone), source: bee.source });
    }
    return {
      source: hooked ? 'hooks' : (sessions.size ? 'logs' : 'none'),
      hooked,
      sessions: list,
      queue,
      zones: [...zones.values()],
    };
  }

  function releaseExternal(requestId) {
    for (const [id, item] of pending) {
      if (item.externalId !== requestId) continue;
      pending.delete(id);
      const session = sessions.get(item.sessionId);
      if (session && !permsFor(session.id).length && session.state === 'needs-you') {
        session.state = 'working';
        session.activity = 'waiting in the tool';
      }
      changed();
      return true;
    }
    return false;
  }

  return { handleHook, answer, applyLog, holdExternal, releaseExternal, snapshot, changed };
}
