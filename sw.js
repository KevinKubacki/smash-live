/* Service worker Smash Live : mise à jour automatique + notifications.
   ⚠ Changer VERSION à chaque livraison. */
const VERSION = 'smash-1.1-2026-10-20';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'logo.png', 'icon-192.png', 'badge.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Réseau d'abord (toujours la dernière version en ligne), copie locale si pas de réseau. */
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r && r.ok) { const c = r.clone(); caches.open(VERSION).then(ca => ca.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

/* Notifications Firebase (messages « data » envoyés par le script). */
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j; } catch (x) { d = { titre: 'Smash Live', texte: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cl.forEach(c => c.postMessage({ type: 'push', data: d }));
    await self.registration.showNotification(d.titre || 'Smash Live', {
      body: d.texte || '', icon: 'icon-192.png', badge: 'badge.png', tag: (d.tag || 'smash') + (d.lien || ''), renotify: true,
      vibrate: [120, 60, 120], data: { lien: d.lien || '' }
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || '';
  e.waitUntil((async () => {
    const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cl) { if ('focus' in c) { await c.focus(); c.postMessage({ type: 'open', lien }); return; } }
    await self.clients.openWindow('./' + lien);
  })());
});
