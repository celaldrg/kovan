// Captures key screens in demo autopilot mode: node scripts/shots.mjs <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(out, { recursive: true });
const port = 4798;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kovan-shots-'));
const vault = path.join(data, 'vault');
fs.cpSync(path.resolve('vault'), vault, { recursive: true });
const server = spawn('node', ['server/index.mjs'], { env: { ...process.env, KOVAN_PORT: String(port), KOVAN_DATA: data, KOVAN_VAULT: vault, KOVAN_DEMO: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = k => !only || only.includes(k);
try {
  await sleep(1200);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (want('splash')) {
    // Software-rendered headless Chrome is too slow to catch the 2.6s splash naturally,
    // so hold the first state request on a throwaway page while we capture it.
    const sp = await browser.newPage();
    await sp.setViewport({ width: 1920, height: 1080 });
    await sp.setRequestInterception(true);
    sp.on('request', r => { if (r.url().endsWith('/api/state')) setTimeout(() => r.continue().catch(() => {}), 6000); else r.continue(); });
    await sp.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await sp.screenshot({ path: path.join(out, '0-splash.png') });
    await sp.close();
  }
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#splash', { hidden: true, timeout: 20000 });
  await sleep(Number(process.env.WAIT || 16000));
  if (want('hive')) await page.screenshot({ path: path.join(out, '1-hive.png') });
  if (want('agents')) { await page.keyboard.press('a'); await sleep(4000); await page.screenshot({ path: path.join(out, '2-agents.png') }); await page.keyboard.press('Escape'); await sleep(800); }
  if (want('departments')) { await page.keyboard.press('d'); await sleep(4000); await page.screenshot({ path: path.join(out, '2-departments.png') }); await page.keyboard.press('Escape'); await sleep(800); }
  if (want('dept')) { await page.keyboard.press(process.env.DEPT_KEY || '2'); await sleep(Number(process.env.DEPT_WAIT || 12000)); await page.screenshot({ path: path.join(out, '3-department-focus.png') }); await page.keyboard.press('Escape'); await sleep(4000); }
  if (want('chat')) {
    await page.evaluate(() => document.querySelector('.flt[data-f="active"]')?.click());
    await page.evaluate(() => document.querySelector('.job[data-job]')?.click());
    await sleep(3500);
    await page.screenshot({ path: path.join(out, '4-chat.png') });
    await page.keyboard.press('Escape'); await sleep(1500);
  }
  await page.evaluate(() => document.activeElement?.blur());
  if (want('vault')) { await page.keyboard.press('v'); await sleep(5000); await page.screenshot({ path: path.join(out, '5-vault.png') }); await page.keyboard.press('Escape'); await sleep(500); }
  if (want('board')) { await page.keyboard.press('b'); await sleep(1500); await page.screenshot({ path: path.join(out, '6-board.png') }); await page.keyboard.press('Escape'); await sleep(500); }
  if (want('calendar')) { await page.keyboard.press('k'); await sleep(1500); await page.screenshot({ path: path.join(out, '7-calendar.png') }); }
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  await browser.close();
} catch (e) { console.log('FAILED', e); }
await new Promise(r => { server.once('exit', r); server.kill(); });
fs.rmSync(data, { recursive: true, force: true });
