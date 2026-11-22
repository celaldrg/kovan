// Walkthrough of the simulated hive, recorded with a Chrome screencast so the
// scene keeps moving while frames are captured.
// node scripts/shots.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(out, { recursive: true });
const framesDir = path.join(out, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const port = 4798;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-shots-'));
const vault = path.join(data, 'vault');
fs.cpSync(path.resolve('vault'), vault, { recursive: true });
const server = spawn('node', ['server/index.mjs'], {
  env: { ...process.env, KOVAN_PORT: String(port), KOVAN_DATA: data, KOVAN_VAULT: vault, KOVAN_DEMO: '1', KOVAN_AUTOPILOT: '0' },
  stdio: 'ignore',
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const base = `http://127.0.0.1:${port}`;

function authHeaders() {
  const token = fs.readFileSync(path.join(data, 'token'), 'utf8').trim();
  return { 'content-type': 'application/json', 'x-kovan-token': token };
}
async function snap() {
  const res = await fetch(base + '/api/live', { headers: authHeaders() });
  return res.json();
}
async function clearQueue() {
  const live = await snap();
  for (const card of live.queue) {
    await fetch(base + '/api/live/answer', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id: card.id, behavior: 'allow' }),
    });
  }
}
let pendingHook = null;
function raisePermission() {
  pendingHook = fetch(base + '/api/hooks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
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
    }),
  });
  pendingHook.catch(() => {});
}

try {
  if (!chrome) throw new Error('Chrome/Chromium not found');
  await sleep(700);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1120,700'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('pageerror', String(e)));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.ui-on', { timeout: 20000 });
  await sleep(1800);
  await page.evaluate(() => {
    const hive = window.kovan.hive;
    hive.skipIntro();
    hive.controls.autoRotate = false;
    hive.lastInteract = 1e15;
  });
  await clearQueue();
  await page.waitForFunction(() => !document.querySelector('#permit.on'), { timeout: 8000 });
  await sleep(600);
  await page.screenshot({ path: path.resolve('assets/screenshot-hive.png') });

  const client = await page.createCDPSession();
  const grabbed = [];
  let t0 = 0;
  client.on('Page.screencastFrame', async frame => {
    if (!t0) t0 = Date.now();
    grabbed.push({ t: Date.now() - t0, data: frame.data });
    try { await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch { /* stopping */ }
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 960, maxHeight: 600, everyNthFrame: 1 });

  // Working hive, then a bee starts waiting, the card opens, Allow, resume, Sessions.
  await sleep(5500);
  raisePermission();
  await page.waitForSelector('#permit.on header b', { timeout: 8000 });
  await sleep(800);
  await page.screenshot({ path: path.resolve('assets/screenshot-approval.png') });
  await sleep(1800);
  await page.evaluate(() => document.querySelector('#permit header b')?.click());
  await page.waitForSelector('#chat.open [data-go="allow"]', { timeout: 8000 });
  await sleep(2800);
  await page.evaluate(() => document.querySelector('#chat.open [data-go="allow"]')?.click());
  await page.waitForFunction(() => !document.querySelector('#permit.on'), { timeout: 8000 });
  await sleep(700);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#chat .x')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(3500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('a');
  await page.waitForSelector('#sheet.open .acard', { timeout: 8000 });
  await sleep(800);
  await page.screenshot({ path: path.resolve('assets/screenshot-sessions.png') });
  await sleep(1600);
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('r');
  await page.waitForSelector('#replayForm', { timeout: 8000 });
  await page.type('#replayQ', 'dock');
  await page.click('#replayForm button[type="submit"]');
  await page.waitForFunction(() => /dock/i.test(document.querySelector('.replay-hit p')?.textContent || ''), { timeout: 8000 });
  await page.click('.replay-hit');
  await page.waitForSelector('.replay-scrub input', { timeout: 8000 });
  await sleep(500);
  await page.screenshot({ path: path.resolve('assets/screenshot-replay.png') });
  await sleep(1200);

  await client.send('Page.stopScreencast');
  await sleep(300);
  const elapsed = grabbed.length ? grabbed[grabbed.length - 1].t / 1000 : 0;
  // Keep about 8 frames a second so the file stays a walkthrough, not a pile of duplicates.
  const step = 125;
  let next = 0;
  let n = 0;
  const kept = [];
  for (const frame of grabbed) {
    if (frame.t < next) continue;
    const name = `f${String(n).padStart(3, '0')}.jpg`;
    fs.writeFileSync(path.join(framesDir, name), Buffer.from(frame.data, 'base64'));
    kept.push({ n, t: frame.t });
    n += 1;
    next = frame.t + step;
  }
  const nearest = (ms) => kept.reduce((best, frame) => Math.abs(frame.t - ms) < Math.abs(best.t - ms) ? frame : best, kept[0]);
  const copyStill = (ms, file) => {
    const frame = nearest(ms);
    if (!frame) return;
    fs.copyFileSync(path.join(framesDir, `f${String(frame.n).padStart(3, '0')}.jpg`), path.join(out, file));
  };
  // Marks along the story: early working hive, open approval card, sessions after Allow.
  copyStill(2000, 'still-hive.jpg');
  copyStill(4500 + 2800 + 1400, 'still-approval.jpg');
  copyStill(Math.max(0, (kept.at(-1)?.t || 0) - 1200), 'still-sessions.jpg');
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify({ frames: n, seconds: Number(elapsed.toFixed(2)), raw: grabbed.length, kept }, null, 2));
  console.log(`captured ${n} frames (${grabbed.length} raw) over ${elapsed.toFixed(1)}s in ${out}`);
  const { spawnSync } = await import('node:child_process');
  const gif = path.resolve('assets/kovan-demo.gif');
  const mp4 = path.resolve('assets/kovan-demo.mp4');
  const palette = path.join(framesDir, 'palette.png');
  spawnSync('ffmpeg', ['-y', '-framerate', '8', '-i', path.join(framesDir, 'f%03d.jpg'), '-vf', 'scale=960:-1:flags=lanczos,palettegen', palette], { stdio: 'inherit' });
  spawnSync('ffmpeg', ['-y', '-framerate', '8', '-i', path.join(framesDir, 'f%03d.jpg'), '-i', palette, '-lavfi', 'scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse', gif], { stdio: 'inherit' });
  spawnSync('ffmpeg', ['-y', '-framerate', '8', '-i', path.join(framesDir, 'f%03d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  void pendingHook;
  await browser.close();
} catch (e) { console.log('FAILED', e); process.exitCode = 1; }
await new Promise(r => { server.once('exit', r); server.kill(); });
fs.rmSync(data, { recursive: true, force: true });
