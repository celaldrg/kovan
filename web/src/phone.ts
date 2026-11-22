import './phone.css';

type Pending = { id: string; project: string; tool: string; command: string; since: number; token: string; expires: number };
type Alert = { level: string; scope: string; key: string; ratio: number | null; limitUsd: number | null; period: string };
type Queue = { requests: Pending[]; alerts: Alert[]; runaway: { detail: string }[] };

const root = document.getElementById('phone')!;
const DB = 'kovan-phone';

function esc(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function saveDevice(token: string) {
  localStorage.setItem('kovan-device', token);
  const base = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = base.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(token, 'device');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function device() {
  return localStorage.getItem('kovan-device') || '';
}

async function pair(code: string) {
  const res = await fetch('/api/phone/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'rejected');
  await saveDevice(body.deviceToken);
  if (body.vapidPublicKey) localStorage.setItem('kovan-vapid', body.vapidPublicKey);
  history.replaceState(null, '', '/phone.html');
}

async function load(): Promise<Queue> {
  const res = await fetch('/api/phone/pending', { headers: { 'x-kovan-device': device() } });
  if (res.status === 401) { localStorage.removeItem('kovan-device'); throw new Error('unpaired'); }
  if (!res.ok) throw new Error('unreachable');
  return res.json();
}

async function decide(item: Pending, behavior: 'allow' | 'deny') {
  const res = await fetch('/api/phone/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kovan-device': device() },
    body: JSON.stringify({ requestId: item.id, token: item.token, behavior }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'rejected');
  return body as { behavior?: string };
}

function b64url(value: string) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function enablePush() {
  const vapid = localStorage.getItem('kovan-vapid') || '';
  if (!vapid || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('push unavailable');
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(vapid) });
  const res = await fetch('/api/phone/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kovan-device': device() },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error('push rejected');
}

function render(queue: Queue | null, note = '') {
  const requests = queue?.requests || [];
  const alerts = queue?.alerts || [];
  root.innerHTML = `
    <p class="kicker">Kovan</p>
    <h1>Approvals</h1>
    <p class="kicker">Allow and deny expire after 5 minutes. A failure never allows a tool.</p>
    ${note ? `<p class="err">${esc(note)}</p>` : ''}
    ${alerts.map(alert => `<section class="card alert ${esc(alert.level)}"><h2>${esc(alert.level)} · ${esc(alert.key || alert.scope)}</h2><p>${alert.ratio == null ? '' : `${Math.round(alert.ratio * 100)}% of the ${esc(alert.period)} budget.`}</p></section>`).join('')}
    ${requests.map(item => `<section class="card" data-id="${esc(item.id)}"><h2>${esc(item.project)}</h2><p class="tool">${esc(item.tool)} ${esc(item.command)}</p><div class="row"><button class="allow" data-go="allow">Allow</button><button class="deny" data-go="deny">Deny</button></div></section>`).join('') || '<p class="empty">Nothing is waiting.</p>'}
    <button class="wide" id="push" type="button">Turn on notifications</button>`;
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(btn => btn.onclick = async () => {
    const id = btn.closest<HTMLElement>('[data-id]')?.dataset.id;
    const item = requests.find(row => row.id === id);
    if (!item) return;
    btn.disabled = true;
    try {
      const result = await decide(item, btn.dataset.go === 'deny' ? 'deny' : 'allow');
      await tick(result.behavior === 'deny' && btn.dataset.go === 'allow' ? 'The budget turned that allow into a denial.' : '');
    } catch (err) { await tick(String(err instanceof Error ? err.message : err)); }
  });
  document.getElementById('push')!.onclick = async () => {
    try { await enablePush(); await tick('Notifications on for this device.'); }
    catch (err) { await tick(String(err instanceof Error ? err.message : err)); }
  };
}

async function tick(note = '') {
  if (!device()) { render(null, note || 'Pair this phone from the desktop hive.'); return; }
  try { render(await load(), note); }
  catch (err) { render(null, String(err instanceof Error ? err.message : err)); }
}

const code = new URLSearchParams(location.hash.replace(/^#/, '')).get('pair') || '';
(async () => {
  if (code) {
    try { await pair(code); } catch (err) { render(null, String(err instanceof Error ? err.message : err)); return; }
  }
  await tick();
  setInterval(() => { tick().catch(() => {}); }, 3000);
})();
