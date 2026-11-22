// The hive engine: routing, jobs, swarms, approvals, chat, lessons and the routine clock.
import path from 'node:path';
import { jsonStore, uid } from './store.mjs';
import { readSkillShelf, skillsFor, readLessons, addLesson, looksStanding } from './knowledge.mjs';
import { parseSchedule, describeRule, nextRun, isOutbound, detectSwarm, sanitizeRule } from '../shared/schedule.js';
import { modelChoices, acceptModel, EFFORTS } from './ai.mjs';
import { startAutopilot } from './autopilot.mjs';
import { pickDepartment, guessDepartment } from '../shared/departments.js';

const words = s => String(s).toLowerCase().match(/[a-zçğıöşü]{3,}/g) || [];

export function createHive({ cfg, crew, vault, ai, emit }) {
  const jobsDb = jsonStore(path.join(cfg.dataDir, 'jobs.json'), { jobs: [] });
  const routinesDb = jsonStore(path.join(cfg.dataDir, 'routines.json'), { routines: [] });
  const chatDb = jsonStore(path.join(cfg.dataDir, 'chats.json'), { chats: {} });
  const runsDb = jsonStore(path.join(cfg.dataDir, 'runs.json'), { runs: [] });
  const jobs = () => jobsDb.get().jobs;
  const routines = () => routinesDb.get().routines;
  const W = id => crew.workers.find(w => w.id === id);
  const leadOf = dept => crew.workers.find(w => w.dept === dept && w.lead) || crew.workers.find(w => w.dept === dept);
  const D = id => crew.depts.find(d => d.id === id);

  // Jobs interrupted by a restart go back to the queue.
  for (const j of jobs()) if (j.state === 'working') j.state = 'queued';
  // Older data files used comb ids; map them onto departments.
  const LEGACY = { scouts: 'research', nectar: 'marketing', wax: 'engineering', guard: 'support', honey: 'finance' };
  for (const x of [...jobs(), ...routines()]) {
    if (!x.dept && x.comb) x.dept = x.comb;
    if (x.dept && !crew.depts.some(d => d.id === x.dept) && LEGACY[x.dept]) x.dept = LEGACY[x.dept];
    delete x.comb;
  }
  // Drop stored model/rule strings that are not on the allowlist (they were renderable HTML).
  let scrubbedJobs = false;
  let scrubbedRoutines = false;
  const choices = () => modelChoices(cfg);
  for (const x of jobs()) {
    if (x.model) {
      const picked = acceptModel(x.model, choices());
      if (!picked) { x.model = ''; scrubbedJobs = true; }
    }
    if (x.effort && !EFFORTS.includes(x.effort)) { x.effort = ''; scrubbedJobs = true; }
  }
  for (const x of routines()) {
    if (x.model) {
      const picked = acceptModel(x.model, choices());
      if (!picked) { x.model = ''; scrubbedRoutines = true; }
    }
    if (x.rule) {
      const clean = sanitizeRule(x.rule);
      if (!clean) {
        x.paused = true;
        x.rule = { kind: 'days', weekdays: [1], hour: 9, minute: 0 };
        scrubbedRoutines = true;
      } else if (JSON.stringify(clean) !== JSON.stringify(x.rule)) { x.rule = clean; scrubbedRoutines = true; }
    }
  }
  if (scrubbedJobs) jobsDb.save();
  if (scrubbedRoutines) routinesDb.save();

  const changed = () => { jobsDb.save(); emit('jobs', publicJobs()); };
  const publicJobs = () => jobs().slice(-300);
  const pulse = (type, data) => emit('pulse', { type, ...data });
  const recordRun = tokens => { const r = runsDb.get().runs; r.push({ at: Date.now(), tokens: tokens || 0 }); while (r.length > 5000) r.shift(); runsDb.save(); };
  const resolveModel = (job, worker) => {
    const choices = modelChoices(cfg).map(String).filter(id => acceptModel(id, modelChoices(cfg)));
    for (const candidate of [job?.model, worker?.model, cfg.model]) {
      const picked = acceptModel(candidate || '', choices);
      if (picked) return picked;
    }
    return choices[0] || 'sonnet';
  };
  const resolveEffort = (job, worker) => {
    const effort = job?.effort || worker?.effort || cfg.effort || '';
    return EFFORTS.includes(effort) ? effort : '';
  };

  // ---------- prompts ----------
  function workerContext(worker, text) {
    const notes = vault.relevant(text);
    vault.markRead(notes.map(n => n.id), worker.id);
    notes.forEach(n => pulse('read', { worker: worker.id, note: n.id }));
    const skills = skillsFor(readSkillShelf(cfg.vaultDir), worker);
    const lessons = readLessons(cfg.vaultDir, worker.id);
    const dept = crew.depts.find(c => c.id === worker.dept);
    const lines = [
      `You are ${worker.name}, the ${worker.role} in the ${dept?.name} department at ${cfg.name}.`,
      dept?.mission ? `Your department covers: ${dept.mission}` : '',
      worker.lead ? 'You head this department: you own its quality bar and sign off its output.' : `Your department head is ${leadOf(worker.dept)?.name}.`,
      `Your job: ${worker.does}`,
      worker.brief ? `Standing brief from the owner: ${worker.brief}` : '',
      'Ground rule of this hive: looking things up is always fine. Anything that leaves the machine or alters something out there (emails, posts, payments, deletions, bookings) happens only if the owner spelled out that very step in the task.',
      lessons.rules.length ? `Standing rules you learned from the owner's corrections:\n${lessons.rules.map(r => `- ${r}`).join('\n')}` : '',
      ...skills.map(s => `Skill "${s.name}" (${s.about}) — follow it:\n${s.body}${s.extras.map(e => `\n--- ${e.file} ---\n${e.text}`).join('')}`),
      notes.length ? `Relevant notes from the owner's vault:\n${notes.map(n => `### ${n.id}\n${n.body}`).join('\n\n')}` : '',
    ].filter(Boolean);
    return { prompt: lines.join('\n\n'), notes, lessons: lessons.rules, skills: skills.map(s => s.name) };
  }

  // ---------- routing ----------
  function scoreWorkers(text, dept) {
    const q = new Set(words(text));
    return crew.workers.filter(w => !dept || w.dept === dept).map(w => {
      let s = 0;
      for (const sk of w.skills || []) if (String(text).toLowerCase().includes(sk.toLowerCase())) s += 5;
      for (const x of words(`${w.role} ${w.does} ${(w.skills || []).join(' ')}`)) if (q.has(x)) s += 1;
      return [s, w];
    }).sort((a, b) => b[0] - a[0]);
  }

  async function route(text, dept) {
    const ranked = scoreWorkers(text, dept);
    if (ai.backend !== 'demo') {
      const pool = crew.workers.filter(w => !dept || w.dept === dept);
      const prompt = `Pick the single best worker for this task. Reply with only the worker id.\n\nTask: ${text}\n\nWorkers by department:\n${crew.depts.filter(d => !dept || d.id === dept).map(d => `# ${d.name} — ${d.mission}\n${pool.filter(w => w.dept === d.id).map(w => `${w.id} — ${w.role}: ${w.does} [${(w.skills || []).join(', ')}]`).join('\n')}`).join('\n')}`;
      try {
        const { text: out, tokens } = await ai.run(prompt, { model: cfg.model, kind: 'route' });
        recordRun(tokens);
        const id = (out.toLowerCase().match(/[a-z0-9_-]+/g) || []).find(x => pool.some(w => w.id === x));
        if (id) return W(id);
      } catch {}
    }
    if (ranked[0] && ranked[0][0] > 0) return ranked[0][1];
    if (dept) return leadOf(dept);
    // nothing matched a person: hand it to the head of the best-fitting department
    return leadOf(guessDepartment(text, crew.depts, crew.workers) || crew.depts[0].id);
  }

  // ---------- jobs ----------
  async function addJob({ text, dept = '', model = '', effort = '', swarm = false, at = null, routineId = null, needsOk, late = false, auto = false }) {
    const modelPick = acceptModel(model || '', modelChoices(cfg));
    if (modelPick == null) throw Object.assign(new Error('invalid model'), { status: 400 });
    const effortPick = effort == null || effort === '' ? '' : String(effort);
    if (!EFFORTS.includes(effortPick)) throw Object.assign(new Error('invalid effort'), { status: 400 });
    const picked = pickDepartment(text, crew.depts);
    if (picked) { text = picked.task; dept = picked.dept; }
    if (dept && !D(dept)) dept = '';
    const sw = detectSwarm(text);
    const task = sw.task || text;
    const job = {
      id: uid('j'), text: task, dept, routed: dept ? 'you' : 'auto', model: modelPick, effort: effortPick, swarm: (swarm || sw.swarm) && cfg.swarm?.enabled !== false,
      state: at && at > Date.now() ? 'scheduled' : 'queued', at: at || null, routineId, late,
      needsOk: needsOk ?? isOutbound(task), created: Date.now(), worker: null, log: [], auto,
    };
    jobs().push(job);
    changed();
    if (job.state === 'queued') runJob(job).catch(e => fail(job, e));
    return job;
  }

  function fail(job, e) { job.state = 'failed'; job.error = String(e?.message || e); changed(); }
  function log(job, msg) { job.log.push({ t: Date.now(), msg }); changed(); }

  // A bee does one thing at a time: extra work for the same bee waits in the queue.
  const desks = new Map();
  async function claimDesk(id) {
    while (desks.has(id)) await desks.get(id).wait;
    let free; const wait = new Promise(r => (free = r));
    desks.set(id, { wait });
    return () => { desks.delete(id); free(); };
  }

  async function runJob(job) {
    const worker = job.worker ? W(job.worker) : await route(job.text, job.dept || null);
    job.worker = worker.id; job.dept = worker.dept;
    log(job, `${job.routed === 'you' ? 'Sent' : 'Routed'} to ${D(worker.dept)?.name} → ${worker.name}`);
    const release = await claimDesk(worker.id);
    try {
      job.state = 'working'; job.started = Date.now();
      job.modelUsed = resolveModel(job, worker); job.effortUsed = resolveEffort(job, worker);
      changed();
      if (job.swarm) return await runSwarm(job, worker);
      const out = await doWork(worker, job.text, job, job.needsOk
        ? 'This task includes an outbound step. Prepare everything (drafts, exact recipients, amounts) but DO NOT perform the outbound action yet; end with a short "Ready to execute:" line.' : '');
      finish(job, worker, out);
    } finally { release(); }
  }

  async function doWork(worker, task, job, extra = '') {
    const c = workerContext(worker, task);
    const prompt = `${c.prompt}\n\n${extra}\n\nTask from the owner:\n${task}\n\nReturn the finished deliverable in Markdown. End with one line "Tools used: …" (or "Tools used: none").`;
    pulse('work', { worker: worker.id, job: job.id });
    const r = await ai.run(prompt, { model: resolveModel(job, worker), effort: resolveEffort(job, worker), kind: 'work', ctx: { worker, task, notes: c.notes, lessons: c.lessons } });
    recordRun(r.tokens);
    job.tokens = (job.tokens || 0) + (r.tokens || 0);
    return { ...r, sources: c.notes.map(n => n.id), skills: c.skills };
  }

  function finish(job, worker, out) {
    job.result = out.text; job.sources = out.sources; job.skills = out.skills;
    if (job.auto) job.note = null; // autopilot work is theatre: do not litter the vault
    else job.note = vault.writeDeliverable({ worker, title: job.text.slice(0, 80), body: out.text, sources: out.sources, meta: { model: job.modelUsed, state: job.needsOk ? 'awaiting-approval' : 'done' } });
    pulse('write', { worker: worker.id, note: job.note });
    job.state = job.needsOk ? 'approval' : 'done';
    job.finished = Date.now();
    pushChat(worker.id, { from: 'worker', text: out.text, job: job.id });
    changed();
  }

  async function runSwarm(job, lead) {
    const team = crew.workers.filter(w => w.dept === lead.dept);
    const max = Math.max(2, Math.min(4, cfg.swarm?.max || 3));
    let pieces = [];
    if (ai.backend !== 'demo') {
      const prompt = `You head the ${D(lead.dept)?.name} department. Break this job into 2-${max} parts that teammates can work on simultaneously without waiting on each other. Reply ONLY with JSON: [{"worker":"id","piece":"..."}].\nTask: ${job.text}\nTeam:\n${team.map(w => `${w.id} — ${w.role}: ${w.does}`).join('\n')}`;
      try {
        const r = await ai.run(prompt, { model: resolveModel(job, lead), kind: 'split' });
        recordRun(r.tokens);
        pieces = JSON.parse(r.text.match(/\[[\s\S]*\]/)[0]).filter(p => team.some(w => w.id === p.worker)).slice(0, max);
      } catch {}
    }
    if (pieces.length < 2) {
      pieces = team.filter(w => !w.lead).map(w => [scoreWorkers(job.text, lead.dept).findIndex(x => x[1] === w), w]).sort((a, b) => a[0] - b[0]).slice(0, max)
        .map(([, w]) => ({ worker: w.id, piece: `${job.text} — the ${w.role.toLowerCase()} angle` }));
    }
    job.pieces = pieces.map(p => ({ ...p, state: 'working' }));
    log(job, `${lead.name} split the work across ${pieces.map(p => W(p.worker).name).join(', ')}`);
    const results = await Promise.all(job.pieces.map(async p => {
      const w = W(p.worker);
      pulse('handoff', { from: lead.id, to: w.id });
      const r = await doWork(w, p.piece, job, `You are one of ${pieces.length} teammates working in parallel on a larger job led by ${lead.name}: "${job.text}". Do only your piece.`);
      p.state = 'done'; p.result = r.text; changed();
      pushChat(w.id, { from: 'worker', text: r.text, job: job.id });
      pulse('handoff', { from: w.id, to: lead.id });
      return { w, r };
    }));
    const mergePrompt = `${workerContext(lead, job.text).prompt}\n\nYour teammates finished their pieces of: "${job.text}".\n\n${results.map(({ w, r }) => `## ${w.name} (${w.role})\n${r.text}`).join('\n\n')}\n\nWrite the single finished deliverable from these pieces. Finish with a short credits line naming each teammate and their part.`;
    const merged = await ai.run(mergePrompt, { model: resolveModel(job, lead), kind: 'merge', ctx: { worker: lead, task: job.text, notes: vault.relevant(job.text) } });
    recordRun(merged.tokens);
    job.tokens = (job.tokens || 0) + (merged.tokens || 0);
    const body = `${merged.text}\n\n${results.map(({ w, r }) => `### Piece — ${w.name}\n${r.text}`).join('\n\n')}`;
    finish(job, lead, { text: body, sources: [...new Set(results.flatMap(x => x.r.sources))], skills: [] });
  }

  async function approve(id) {
    const job = jobs().find(j => j.id === id);
    if (!job || job.state !== 'approval') throw new Error('not waiting for approval');
    const worker = W(job.worker);
    job.state = 'working'; changed();
    const prompt = `${workerContext(worker, job.text).prompt}\n\nThe owner APPROVED your prepared work below. Now perform the outbound step exactly as prepared, using your tools, and report what you did.\n\n${job.result}`;
    try {
      const r = await ai.run(prompt, { model: resolveModel(job, worker), kind: 'work', ctx: { worker, task: `Executed: ${job.text}` } });
      recordRun(r.tokens);
      job.tokens = (job.tokens || 0) + (r.tokens || 0);
      job.executed = r.text; job.state = 'done'; job.finished = Date.now();
      pushChat(worker.id, { from: 'worker', text: r.text, job: job.id });
      changed();
    } catch (e) { fail(job, e); }
    return job;
  }

  async function reject(id, reason = '') {
    const job = jobs().find(j => j.id === id);
    if (!job || job.state !== 'approval') throw new Error('not waiting for approval');
    const worker = W(job.worker);
    if (reason) addLesson(cfg.vaultDir, worker, reason, looksStanding(reason));
    job.state = 'working'; changed();
    const out = await doWork(worker, job.text, job, `Your previous draft was rejected. Owner's reason: ${reason || 'not specified'}.\nPrevious draft:\n${job.result}\nRework it. Still do NOT perform the outbound step.`);
    finish(job, worker, out);
    return job;
  }

  function cancel(id) {
    const job = jobs().find(j => j.id === id);
    if (job && ['scheduled', 'queued', 'approval'].includes(job.state)) { job.state = 'cancelled'; changed(); }
    return job;
  }

  // ---------- chat ----------
  const chats = () => chatDb.get().chats;
  function pushChat(wid, msg) {
    const list = (chats()[wid] ||= []);
    list.push({ ...msg, t: Date.now() });
    while (list.length > 200) list.shift();
    chatDb.save();
    emit('chat', { worker: wid, msg: list[list.length - 1] });
  }

  async function chat(wid, message) {
    const worker = W(wid);
    if (!worker) throw new Error('unknown worker');
    pushChat(wid, { from: 'owner', text: message });
    const rev = message.match(/^\s*(revise|düzelt)\s*:\s*([\s\S]+)/i);
    if (rev) {
      const last = [...jobs()].reverse().find(j => j.worker === wid && j.result);
      if (!last) { pushChat(wid, { from: 'worker', text: 'I have no deliverable to revise yet.' }); return; }
      const standing = looksStanding(rev[2]);
      addLesson(cfg.vaultDir, worker, rev[2], standing);
      pushChat(wid, { from: 'system', text: standing ? `Saved as a standing rule for ${worker.name}.` : 'Noted for this task.' });
      last.state = 'working'; changed();
      try {
        const out = await doWork(worker, last.text, last, `Revise your previous deliverable. Owner's correction: ${rev[2]}\nPrevious deliverable:\n${last.result}`);
        finish(last, worker, out);
      } catch (e) { fail(last, e); }
      return;
    }
    const sched = parseSchedule(message);
    if (worker.lead && sched) {
      const r = scheduleRoutine({ text: sched.task, dept: worker.dept, rule: sched.rule });
      pushChat(wid, { from: 'worker', text: `On the timetable: “${r.text}” — ${describeRule(r.rule)}. Next run ${new Date(r.next).toLocaleString()}.` });
      return;
    }
    const c = workerContext(worker, message);
    const history = (chats()[wid] || []).slice(-10).map(m => `${m.from === 'owner' ? 'Owner' : worker.name}: ${m.text.slice(0, 1500)}`).join('\n');
    pulse('chat', { worker: wid });
    try {
      const r = await ai.run(`${c.prompt}\n\nYou are chatting with the owner. Answer in role, concisely, grounded in the notes. Conversation so far:\n${history}\n\n${worker.name}:`, { model: resolveModel({}, worker), kind: 'chat', ctx: { worker, task: message, notes: c.notes } });
      recordRun(r.tokens);
      pushChat(wid, { from: 'worker', text: r.text });
    } catch (e) { pushChat(wid, { from: 'system', text: `Error: ${e.message}` }); }
  }

  // ---------- routines ----------
  function scheduleRoutine({ text, dept = '', rule, model = '', needsOk, start = 0, swarm = false, worker = '' }) {
    const cleanRule = sanitizeRule(rule);
    if (!cleanRule) throw Object.assign(new Error('invalid rule'), { status: 400 });
    const modelPick = acceptModel(model || '', modelChoices(cfg));
    if (modelPick == null) throw Object.assign(new Error('invalid model'), { status: 400 });
    const picked = pickDepartment(text, crew.depts);
    if (picked) { text = picked.task; dept = picked.dept; }
    const r = { id: uid('r'), text, dept, rule: cleanRule, model: modelPick, swarm, worker, needsOk: needsOk ?? isOutbound(text), start: start || 0, paused: false, created: Date.now(), lastRun: null };
    r.next = nextRun(rule, Date.now(), r.start);
    routines().push(r);
    routinesDb.save(); emit('routines', routines());
    return r;
  }
  function routineAction(id, action) {
    const r = routines().find(x => x.id === id);
    if (!r) throw new Error('unknown routine');
    if (action === 'pause') r.paused = true;
    if (action === 'resume') { r.paused = false; r.next = nextRun(r.rule, Date.now(), r.start); }
    if (action === 'delete') routines().splice(routines().indexOf(r), 1);
    if (action === 'run') fire(r, false);
    routinesDb.save(); emit('routines', routines());
    return r;
  }
  function fire(r, late) {
    r.lastRun = Date.now();
    addJob({ text: r.text, dept: r.dept, model: r.model, swarm: r.swarm, routineId: r.id, needsOk: r.needsOk, late });
  }

  function tick() {
    const now = Date.now();
    for (const r of routines()) {
      if (r.paused || !r.next || r.next > now) continue;
      const late = now - r.next > 2 * 60e3; // missed while off: one catch-up, marked late
      fire(r, late);
      r.next = nextRun(r.rule, now, r.start);
      routinesDb.save(); emit('routines', routines());
    }
    for (const j of jobs()) if (j.state === 'scheduled' && j.at <= now) {
      j.late = now - j.at > 2 * 60e3; j.state = 'queued'; changed();
      runJob(j).catch(e => fail(j, e));
    }
  }
  setInterval(tick, 15e3);
  setTimeout(tick, 1000);
  for (const j of jobs()) if (j.state === 'queued') runJob(j).catch(e => fail(j, e));

  const api = {
    jobs: publicJobs, routines, scheduleRoutine, addJob, approve, crew,
  };
  if (ai.backend === 'demo' && process.env.KOVAN_AUTOPILOT !== '0' && cfg.autopilot !== false) startAutopilot(api, { jobs, save: changed });

  return {
    jobs: publicJobs, routines, chatsFor: wid => chats()[wid] || [], runs: () => runsDb.get().runs,
    addJob, approve, reject, cancel, chat, scheduleRoutine, routineAction,
    flush() { jobsDb.flushNow(); routinesDb.flushNow(); chatDb.flushNow(); runsDb.flushNow(); },
  };
}
