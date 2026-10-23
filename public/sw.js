// The Number's service worker: keeps the app shell available offline and shows alerts.
// Prices (/api/*) always go to the network.
const VERSION = 'number-8d6848a2bd';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/fonts/archivo-wdth.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // A fresh app when the network answers quickly; the saved copy on a weak signal.
    const net = fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('/', copy));
      }
      return res;
    });
    const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => caches.match('/'));
    e.respondWith(Promise.race([net.catch(() => caches.match('/')), slow.then((hit) => hit || net)]).then((r) => r || net));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('/#edges');
  }));
});
