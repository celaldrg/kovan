// Headless captures of the live hive and the approval card.
// node scripts/shots.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(out, { recursive: true });
const frames = path.join(out, 'frames');
fs.mkdirSync(frames, { recursive: true });
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
try {
  await sleep(900);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('pageerror', String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.ui-on', { timeout: 20000 });
  await page.waitForSelector('#permit.on', { timeout: 8000 });
  await sleep(1800);
  await page.screenshot({ path: path.join(out, 'screenshot-hive.png') });
  const box = await page.$eval('#permit', el => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.floor(r.x - 28));
    const y = Math.max(0, Math.floor(r.y - 36));
    return { x, y, width: Math.min(1440 - x, Math.ceil(r.width + 56)), height: Math.min(900 - y, Math.ceil(r.height + 56)) };
  });
  await page.screenshot({ path: path.join(out, 'screenshot-approval.png'), clip: box });
  for (let i = 0; i < 16; i++) {
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(2, '0')}.png`) });
    await sleep(280);
  }
  await page.keyboard.press('a');
  await sleep(700);
  await page.screenshot({ path: path.join(out, 'screenshot-sessions.png') });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.click('#modeBtn');
  await sleep(1200);
  await page.screenshot({ path: path.join(out, 'screenshot-company.png') });
  console.log('captured', out);
  await browser.close();
} catch (e) { console.log('FAILED', e); process.exitCode = 1; }
await new Promise(r => { server.once('exit', r); server.kill(); });
fs.rmSync(data, { recursive: true, force: true });
