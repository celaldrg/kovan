export interface Dept { id: string; name: string; tr: string; code: string; color: string; icon: string; mission: string }
export interface Worker { id: string; dept: string; lead?: boolean; name: string; role: string; does: string; skills?: string[]; brief?: string; model?: string; effort?: string }
export type JobState = 'scheduled' | 'queued' | 'working' | 'approval' | 'done' | 'failed' | 'cancelled';
export interface Piece { worker: string; piece: string; state: string; result?: string }
export interface Job {
  id: string; text: string; dept: string; routed?: 'you' | 'auto'; state: JobState; worker: string | null; created: number; started?: number; finished?: number;
  at?: number | null; routineId?: string | null; late?: boolean; needsOk: boolean; swarm?: boolean; pieces?: Piece[];
  result?: string; executed?: string; note?: string; sources?: string[]; skills?: string[]; modelUsed?: string; effortUsed?: string; tokens?: number; error?: string;
}
export interface Rule { kind: 'minutes' | 'hours' | 'days'; every?: number; hour?: number; minute?: number; weekdays?: number[] }
export interface Routine { id: string; text: string; dept: string; rule: Rule; model: string; needsOk: boolean; paused: boolean; next: number | null; lastRun: number | null; start: number; swarm?: boolean }
export interface Connector { name: string; ok: boolean; usable?: boolean; status: string }
export interface ChatMsg { from: 'owner' | 'worker' | 'system'; text: string; t: number; job?: string }
export interface State {
  name: string; backend: 'claude-cli' | 'api' | 'demo'; mode?: 'live' | 'company'; model: string; models: string[]; efforts: string[]; swarm: { enabled: boolean; max: number };
  live?: LiveSnap;
  depts: Dept[]; workers: Worker[]; jobs: Job[]; routines: Routine[]; connectors: { items: Connector[]; note: string }; notes: number;
  skills: { name: string; about: string; workers: string[]; depts: string[] }[];
}
export interface Pulse { type: 'read' | 'write' | 'work' | 'handoff' | 'chat'; worker?: string; note?: string; from?: string; to?: string }
export type LiveState = 'idle' | 'working' | 'stuck' | 'needs-you';
export interface LivePermit { id: string; tool: string; command: string; diff: string; file: string; since: number }
export interface LiveBee {
  id: string; sessionId: string; kind: 'session' | 'subagent'; project: string; zone: string;
  name: string; role: string; model: string; state: LiveState; activity: string; updated: number;
  source: 'claude' | 'codex' | 'demo'; attention: string; permission: LivePermit | null;
}
export interface LiveQueueItem {
  id: string; beeId: string; sessionId: string; project: string; name: string;
  tool: string; command: string; diff: string; file: string; since: number;
}
export interface LiveZoneInfo { id: string; name: string; color: string; source: string }
export interface LiveSnap { source: 'hooks' | 'logs' | 'demo' | 'none'; hooked: boolean; sessions: LiveBee[]; queue: LiveQueueItem[]; zones: LiveZoneInfo[] }
