// Electron shell. It starts the existing Kovan server on 127.0.0.1 and opens it.
// Electron is used because the server is already Node. A Tauri shell would still
// need a Node process, plus a Rust toolchain, to run that server.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { kovanRoot, serverEnv, isAppUrl, windowOpenDecision } = require('./launch.cjs');

const port = Number(process.env.KOVAN_PORT || 4700);
const root = kovanRoot({
  resourcesPath: process.resourcesPath,
  moduleDir: __dirname,
  envRoot: process.env.KOVAN_DESKTOP_ROOT || '',
});

function waitFor(url) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(url, res => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - started > 20000) reject(new Error('Kovan did not start'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

let child;
function stopChild() {
  if (child && !child.killed) child.kill();
}

app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], {
    cwd: root,
    env: serverEnv(process.env, { port, dataDir, vault: path.join(root, 'vault') }),
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => { if (signal !== 'SIGTERM' && code) app.quit(); });
  await waitFor(`http://127.0.0.1:${port}/`);
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Kovan',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  const contents = window.webContents;
  const stay = (event, url) => { if (!isAppUrl(url, port)) event.preventDefault(); };
  contents.on('will-navigate', stay);
  contents.on('will-redirect', stay);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const decision = windowOpenDecision(url);
    if (decision.external) shell.openExternal(decision.external).catch(() => {});
    return { action: 'deny' };
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}).catch(err => {
  console.error(err && err.message ? err.message : err);
  stopChild();
  app.quit();
});

app.on('window-all-closed', () => { stopChild(); app.quit(); });
app.on('before-quit', stopChild);
