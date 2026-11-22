// Simulated Claude Code sessions so `npm run demo` is alive with zero setup.
// Projects and commands are fictional. The standing permission is a real
// PermissionRequest payload, answered only from the UI.
const PROJECTS = [
  { cwd: '/work/lighthouse-api', id: 'ses_lighthouse', model: 'claude-sonnet-4-5', title: 'Hive layout' },
  { cwd: '/work/northwind-web', id: 'ses_north', model: 'claude-opus-4-5', title: 'Billing page' },
  { cwd: '/work/paperkite-cli', id: 'ses_kite', model: 'claude-haiku-4-5', title: 'Release notes' },
];

const TOOLS = [
  { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the suite' } },
  { tool_name: 'Read', tool_input: { file_path: '/work/lighthouse-api/src/scene.ts' } },
  { tool_name: 'Grep', tool_input: { pattern: 'permission', path: '/work/northwind-web' } },
];

export function startLiveDemo(live) {
  const base = { transcript_path: '/work/lighthouse-api/.transcripts/demo.jsonl' };
  for (const p of PROJECTS) {
    live.handleHook({ ...base, session_id: p.id, cwd: p.cwd, hook_event_name: 'SessionStart', source: 'startup', model: p.model, session_title: p.title });
  }
  live.handleHook({ ...base, session_id: 'ses_lighthouse', cwd: '/work/lighthouse-api', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the suite' } });
  live.handleHook({ ...base, session_id: 'ses_lighthouse', cwd: '/work/lighthouse-api', hook_event_name: 'SubagentStart', agent_id: 'agent_explore', agent_type: 'Explore' });
  live.handleHook({ ...base, session_id: 'ses_north', cwd: '/work/northwind-web', hook_event_name: 'Stop', last_assistant_message: 'Billing page copy is updated.' });
  live.handleHook({ ...base, session_id: 'ses_kite', cwd: '/work/paperkite-cli', hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: 'API Error: Rate limit reached' });

  const edit = {
    ...base,
    session_id: 'ses_lighthouse',
    cwd: '/work/lighthouse-api',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/work/lighthouse-api/src/hive.ts',
      old_string: 'export const lanes = 6;',
      new_string: 'export const lanes = 7;',
    },
    permission_suggestions: [{
      type: 'addRules',
      rules: [{ toolName: 'Edit', ruleContent: 'src/hive.ts' }],
      behavior: 'allow',
      destination: 'session',
    }],
  };
  // Leave this request open so the approval card stays until the UI answers.
  const standing = live.handleHook(edit);
  standing.catch(() => {});

  // Other CLIs. Codex and Gemini speak through the same hook path. OpenCode and Aider are logs.
  live.handleHook({
    session_id: 'codex_harbor', cwd: '/work/harbor-docs', hook_event_name: 'SessionStart', source: 'startup',
    model: 'gpt-4.1', session_title: 'Dock note',
  }, { cli: 'codex' });
  live.handleHook({
    session_id: 'codex_harbor', cwd: '/work/harbor-docs', hook_event_name: 'UserPromptSubmit',
    prompt: 'Add a dock note to the harbor guide', model: 'gpt-4.1',
    message_id: 'demo-codex-harbor', usage: { input_tokens: 1800, output_tokens: 400, cache_read_input_tokens: 200 },
  }, { cli: 'codex' });
  live.handleHook({
    session_id: 'codex_harbor', cwd: '/work/harbor-docs', hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command: 'git status' },
  }, { cli: 'codex' });
  live.handleHook({
    session_id: 'gem_atlas', cwd: '/work/atlas-notes', hook_event_name: 'SessionStart', source: 'startup',
    model: 'gemini-2.5-flash', session_title: 'Atlas notes',
  }, { cli: 'gemini' });
  live.handleHook({
    session_id: 'gem_atlas', cwd: '/work/atlas-notes', hook_event_name: 'BeforeAgent',
    prompt: 'Summarise the atlas notes', model: 'gemini-2.5-flash',
    message_id: 'demo-gem-atlas', usage: { input_tokens: 40000, output_tokens: 8000 },
  }, { cli: 'gemini' });
  live.handleHook({
    session_id: 'gem_atlas', cwd: '/work/atlas-notes', hook_event_name: 'AfterAgent',
    last_assistant_message: 'Atlas notes are summarised.',
  }, { cli: 'gemini' });
  live.applyLog({
    id: 'ses_quill', cwd: '/work/quill-editor', source: 'opencode', model: 'openai/local-writer',
    title: 'Tighten the editor empty state', state: 'working', activity: 'Tighten the editor empty state',
    readOnly: true, approvals: 'none',
    note: 'Read-only until OpenCode\'s local service is reachable. Kovan does not approve from the database alone.',
    usages: [{ messageId: 'demo-opencode', model: 'local-writer', usage: { input_tokens: 400, output_tokens: 80 } }],
    events: [{ kind: 'prompt', text: 'Tighten the editor empty state', status: 'working' }],
  });
  live.applyLog({
    id: 'aider-keel', cwd: '/work/keel-notes', source: 'aider', model: 'gpt-4.1',
    title: 'Greeting', state: 'idle', activity: 'Applied edit to greeting.py',
    readOnly: true, approvals: 'none',
    note: 'Read-only. Aider records chat history and can ring when a reply is ready. It has no approval hook.',
    usages: [{ messageId: 'demo-aider', model: 'gpt-4.1', usage: { input_tokens: 1200, output_tokens: 80 } }],
    events: [{ kind: 'prompt', text: 'Fix the greeting in greeting.py', status: 'idle' }, { kind: 'tool', tool: 'edit', text: 'Applied edit to greeting.py', status: 'done' }],
  });

  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    const tool = TOOLS[n % TOOLS.length];
    const target = n % 5 === 0 ? 'ses_north' : 'ses_lighthouse';
    const cwd = target === 'ses_north' ? '/work/northwind-web' : '/work/lighthouse-api';
    if (n % 4 === 0) {
      live.handleHook({ ...base, session_id: target, cwd, hook_event_name: 'PostToolUse', tool_name: tool.tool_name, tool_input: tool.tool_input });
    } else {
      live.handleHook({ ...base, session_id: 'ses_lighthouse', cwd: '/work/lighthouse-api', hook_event_name: 'PreToolUse', ...tool, tool_input: { ...tool.tool_input, file_path: tool.tool_input.file_path } });
    }
    if (n % 7 === 0) {
      live.handleHook({ ...base, session_id: 'ses_kite', cwd: '/work/paperkite-cli', hook_event_name: 'UserPromptSubmit', prompt: 'retry the release notes after the limit resets' });
    }
  }, 4500);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
