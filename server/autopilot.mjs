// Demo autopilot: keeps an offline hive visibly busy (for exploring and filming).
// Only runs in demo mode; disable with KOVAN_AUTOPILOT=0 or "autopilot": false in config.
import { uid } from './store.mjs';

const TASKS = [
  ['research', 'compare pricing pages of our top five competitors'],
  ['research', 'size the market for customer-feedback tools in DACH'],
  ['research', 'summarise themes from last month\'s win/loss interviews'],
  ['research', 'analyse the changelog of our closest competitor for Q3'],
  ['marketing', 'write the launch post for opportunity scoring v2'],
  ['marketing', 'draft the October customer newsletter'],
  ['marketing', 'write a LinkedIn post about the Slack digest launch'],
  ['marketing', 'publish the release notes for version 3.8'],
  ['design', 'design the landing page section for SSO and SCIM'],
  ['design', 'update the brand system colour tokens for dark mode'],
  ['design', 'review the onboarding flow for new workspaces'],
  ['design', 'spec the pricing page comparison table'],
  ['engineering', 'fix the duplicate-event bug in webhook retries'],
  ['engineering', 'review PR 482: rate limiter for the public API'],
  ['engineering', 'deploy release 3.8.1 to production'],
  ['engineering', 'write a test plan for SCIM provisioning'],
  ['support', 'triage the overnight ticket queue'],
  ['support', 'build the weekly SLA report'],
  ['support', 'update the help article on CRM sync errors'],
  ['support', 'email the incident summary to affected enterprise accounts'],
  ['finance', 'calculate October burn and runway'],
  ['finance', 'reconcile October invoices against bank receipts'],
  ['finance', 'send the overdue invoice reminder for account 1042'],
  ['finance', 'build the MRR and churn report for the board pack'],
  ['', 'estimate the cost of adding a second support shift'],
  ['', 'draft a reply to the prospect asking about data retention'],
  ['', 'list the API endpoints that still lack latency alerts'],
];
const SWARMS = [['marketing', 'as a team, plan the launch week for opportunity scoring v2'], ['research', 'as a team, map the competitive landscape for the board deck'], ['engineering', 'as a team, prepare the 3.9 release'], ['finance', 'as a team, prepare the quarterly board metrics pack']];

export function startAutopilot(hive, { jobs, save }) {
  let n = 0;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  // deal tasks from a shuffled deck so the feed doesn't repeat itself
  const decks = new Map();
  const deal = a => {
    let d = decks.get(a);
    if (!d || !d.length) { d = [...a].sort(() => Math.random() - 0.5); decks.set(a, d); }
    return d.pop();
  };

  // seed a little history so the board and calendar are not empty on first run
  if (!jobs().length) {
    const day = 86400e3, now = Date.now();
    for (let i = 0; i < 18; i++) {
      const [dept0, text] = pick(TASKS);
      const dept = dept0 || 'research';
      const team = hive.crew.workers.filter(w => w.dept === dept);
      const t = now - (1 + Math.floor(Math.random() * 12)) * day + Math.random() * 6 * 3600e3;
      jobs().push({ id: uid('j'), text, dept, state: 'done', routed: dept0 ? 'you' : 'auto', worker: pick(team)?.id || null, created: t, started: t, finished: t + (40 + Math.random() * 140) * 1e3, needsOk: false, auto: true, tokens: Math.round(1200 + Math.random() * 7000), modelUsed: pick(['sonnet', 'sonnet', 'haiku', 'opus']), seeded: true, log: [], result: '*Earlier demo run.*' });
    }
    save();
  }
  if (!hive.routines().length) {
    hive.scheduleRoutine({ text: 'triage new support tickets', dept: 'support', rule: { kind: 'days', weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 } });
    hive.scheduleRoutine({ text: 'weekly revenue summary', dept: 'finance', rule: { kind: 'days', weekdays: [1], hour: 10, minute: 30 } });
    hive.scheduleRoutine({ text: 'scan competitor release notes', dept: 'research', rule: { kind: 'days', weekdays: [3, 5], hour: 16, minute: 0 } });
  }

  const tick = async () => {
    const busy = jobs().filter(j => j.state === 'working' || j.state === 'queued').length;
    if (busy < 7) {
      n++;
      const [dept, text] = n % 9 === 0 ? deal(SWARMS) : deal(TASKS);
      await hive.addJob({ text, dept, auto: true }).catch(() => {});
    }
    for (const j of jobs()) if (j.auto && j.state === 'approval' && Date.now() - (j.finished || 0) > 9000) hive.approve(j.id).catch(() => {});
    // keep the list light: drop the oldest finished autopilot jobs
    const done = jobs().filter(j => j.auto && j.state === 'done' && !j.seeded);
    if (done.length > 60) { const drop = new Set(done.slice(0, done.length - 60).map(j => j.id)); jobs().splice(0, jobs().length, ...jobs().filter(j => !drop.has(j.id))); save(); }
    setTimeout(tick, 2000 + Math.random() * 3000);
  };
  setTimeout(tick, 2500);
}
