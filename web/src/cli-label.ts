export const CLI_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  aider: 'Aider',
};

export function cliLabel(id?: string) {
  return CLI_LABELS[id || ''] || 'Session';
}

export function costLabel(cost?: { usd: number; tokens: number; unpriced: number } | null) {
  if (!cost || (cost.tokens === 0 && cost.unpriced === 0)) return 'cost unknown';
  if (cost.unpriced > 0 && cost.usd === 0) return 'cost unknown';
  if (cost.usd === 0) return '$0 local';
  return cost.usd < 0.01 ? `$${cost.usd.toFixed(4)}` : `$${cost.usd.toFixed(2)}`;
}
