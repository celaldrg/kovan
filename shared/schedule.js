// Kovan — plain-language schedule parsing (English + Turkish).
// A rule looks like: { kind: 'minutes'|'hours'|'days', every, hour, minute, weekdays: number[] }
// weekdays use JS numbering (0 = Sunday). Pure functions, shared by server and browser.

const DAY_WORDS = [
  [0, ['sunday', 'sundays', 'sun', 'pazar']],
  [1, ['monday', 'mondays', 'mon', 'pazartesi']],
  [2, ['tuesday', 'tuesdays', 'tue', 'salı', 'sali']],
  [3, ['wednesday', 'wednesdays', 'wed', 'çarşamba', 'carsamba']],
  [4, ['thursday', 'thursdays', 'thu', 'perşembe', 'persembe']],
  [5, ['friday', 'fridays', 'fri', 'cuma']],
  [6, ['saturday', 'saturdays', 'sat', 'cumartesi']],
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function findDays(s) {
  const out = new Set();
  for (const [n, words] of DAY_WORDS) {
    for (const w of words) {
      if (new RegExp(`(^|[^a-zçğıöşü])${w}([^a-zçğıöşü]|$)`, 'i').test(s)) out.add(n);
    }
  }
  return [...out].sort();
}

function extractClock(s) {
  // "at 8am", "at 8:30 pm", "18:00", "saat 9", "9'da"
  let m = s.match(/(?:at|@|saat)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i)
    || s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i)
    || s.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (!m) return null;
  let hour = Number(m[1]);
  let minute = 0, ampm;
  if (m.length === 3) { ampm = m[2]; } else { minute = m[2] ? Number(m[2]) : 0; ampm = m[3]; }
  if (ampm) { ampm = ampm.toLowerCase(); if (ampm === 'pm' && hour < 12) hour += 12; if (ampm === 'am' && hour === 12) hour = 0; }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, match: m[0] };
}

/**
 * Detect a recurring schedule in a sentence.
 * Returns { rule, task } where task is the sentence with the schedule phrase removed, or null.
 */
export function parseSchedule(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  const time = extractClock(low);
  let rule = null;
  let phrase = null; // what to cut out of the task text
  let m;
  const DAYS_RX = '(?:mon|tues|wednes|thurs|fri|satur|sun)days?|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar';
  if ((m = low.match(/every\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/)) || (m = low.match(/her\s+(\d+)\s*(dakika|saat(?!\s*\d))(da|de|te|ta)?/))) {
    const n = Math.max(1, Number(m[1]));
    const unit = /^(min|dak)/.test(m[2]) ? 'minutes' : 'hours';
    rule = { kind: unit, every: n }; phrase = m[0];
  } else if ((m = low.match(/\bevery hour\b|\bhourly\b|her saat başı|saatlik/))) {
    rule = { kind: 'hours', every: 1 }; phrase = m[0];
  } else if ((m = low.match(/\b(?:every weekday|on weekdays|weekdays)\b|hafta içi(?: her gün)?/))) {
    rule = { kind: 'days', weekdays: [1, 2, 3, 4, 5] }; phrase = m[0];
  } else if ((m = low.match(/\b(?:every day|each day|every morning|every evening)\b|her gün|her sabah|her akşam/)) || (m = low.match(/^daily\b|\bdaily$|\bdaily at\b/))) {
    rule = { kind: 'days', weekdays: [0, 1, 2, 3, 4, 5, 6] }; phrase = m[0].replace(/ at$/, '');
  } else if ((m = low.match(new RegExp(`\\b(?:every|each|on)\\s+(?:(?:${DAYS_RX})(?:\\s*(?:,|and|&)\\s*)?)+|\\bher\\s+(?:(?:${DAYS_RX})(?:\\s*(?:,|ve)\\s*)?)+`)))) {
    const days = findDays(m[0]);
    if (days.length) { rule = { kind: 'days', weekdays: days }; phrase = m[0]; }
  } else if ((m = low.match(/\bevery week\b|^weekly\b|\bweekly$|her hafta/))) {
    rule = { kind: 'days', weekdays: [1] }; phrase = m[0];
  }
  if (!rule) return null;
  if (rule.kind === 'days') {
    rule.hour = time ? time.hour : (/evening|akşam/.test(low) ? 18 : 9);
    rule.minute = time ? time.minute : 0;
  }
  const cut = (str, frag) => { if (!frag) return str; const i = str.toLowerCase().indexOf(frag.toLowerCase()); return i < 0 ? str : str.slice(0, i) + ' ' + str.slice(i + frag.length); };
  let task = cut(s, phrase);
  if (rule.kind === 'days' && time) task = cut(task, time.match);
  task = task.replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1');
  return { rule, task: task || s };
}

const pad = n => String(n).padStart(2, '0');

function intIn(value, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * Rebuild a schedule rule from checked numbers.
 * Strings are dropped so a stored rule cannot carry markup.
 */
export function sanitizeRule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const kind = input.kind;
  if (kind === 'minutes' || kind === 'hours') {
    const every = intIn(input.every, 1, 1440);
    if (every == null) return null;
    return { kind, every };
  }
  if (kind !== 'days') return null;
  const hour = intIn(input.hour, 0, 23);
  const minute = intIn(input.minute, 0, 59);
  if (hour == null || minute == null || !Array.isArray(input.weekdays) || !input.weekdays.length) return null;
  const weekdays = [];
  for (const day of input.weekdays) {
    const n = intIn(day, 0, 6);
    if (n == null) return null;
    if (!weekdays.includes(n)) weekdays.push(n);
  }
  weekdays.sort((a, b) => a - b);
  return { kind, hour, minute, weekdays };
}

export function describeRule(rule) {
  const clean = sanitizeRule(rule);
  if (!clean) return '';
  if (clean.kind === 'minutes') return `every ${clean.every} min`;
  if (clean.kind === 'hours') return clean.every === 1 ? 'every hour' : `every ${clean.every} h`;
  const t = `${pad(clean.hour)}:${pad(clean.minute)}`;
  const d = clean.weekdays;
  if (d.length === 7) return `daily · ${t}`;
  if (d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x))) return `weekdays · ${t}`;
  return `${d.map(x => DAY_NAMES[x]).join(', ')} · ${t}`;
}

/** Next firing strictly after `after` (ms). `start` (ms) = do not fire before this. */
export function nextRun(rule, after, start = 0) {
  const base = Math.max(after, start - 1);
  if (rule.kind === 'minutes' || rule.kind === 'hours') {
    const step = rule.every * (rule.kind === 'minutes' ? 60e3 : 3600e3);
    const anchor = start || 0;
    if (base < anchor) return anchor;
    return anchor + (Math.floor((base - anchor) / step) + 1) * step;
  }
  const d = new Date(base);
  d.setSeconds(0, 0);
  for (let i = 0; i < 400; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, rule.hour, rule.minute, 0, 0);
    if (c.getTime() > base && rule.weekdays.includes(c.getDay())) return c.getTime();
  }
  return null;
}

/** All firings in [from, to). Capped to keep calendars light. */
export function occurrences(rule, from, to, start = 0, cap = 200) {
  const out = [];
  let t = nextRun(rule, from - 1, start);
  while (t != null && t < to && out.length < cap) { out.push(t); t = nextRun(rule, t, start); }
  return out;
}

// Words that mean the task touches the outside world.
const OUTBOUND = /\b(send|email (to|the)|reply to|post|publish|tweet|pay|transfer|refund|delete|remove|cancel (the|my)|invoice (to)?|book|purchase|buy|submit)\b|gönder|paylaş|yayınla|öde|sil\b|iptal et|satın al/i;
export const isOutbound = text => OUTBOUND.test(String(text || ''));

const TEAM = /^\s*(as a team|team up|swarm)\b[:,]?\s*|^\s*ekip(çe| olarak)\b[:,]?\s*/i;
export function detectSwarm(text) {
  const m = String(text || '').match(TEAM);
  return m ? { swarm: true, task: text.slice(m[0].length).trim() } : { swarm: false, task: text };
}
