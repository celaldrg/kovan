const DB = 'kovan-phone';

function readDevice() {
  return new Promise(resolve => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve('');
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get('device');
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '');
        req.onerror = () => resolve('');
      } catch { resolve(''); }
    };
  });
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.type === 'budget' ? 'Kovan budget' : 'Kovan needs you';
  const body = data.type === 'budget'
    ? 'A budget threshold was crossed.'
    : `${data.project || 'Session'}: ${data.tool || 'tool'} ${data.command || ''}`.trim().slice(0, 160);
  const actions = data.token ? [{ action: 'allow', title: 'Allow' }, { action: 'deny', title: 'Deny' }] : [];
  event.waitUntil(self.registration.showNotification(title, { body, data, actions }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action === 'allow' || event.action === 'deny' ? event.action : '';
  event.waitUntil((async () => {
    if (action && data.token && data.id) {
      const device = await readDevice();
      if (!device) return;
      try {
        await fetch('/api/phone/approve', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kovan-device': device },
          body: JSON.stringify({ requestId: data.id, token: data.token, behavior: action }),
        });
      } catch { /* a failed push action is not an allow */ }
      return;
    }
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open[0]) return open[0].focus();
    if (self.clients.openWindow) return self.clients.openWindow('/phone.html');
  })());
});
