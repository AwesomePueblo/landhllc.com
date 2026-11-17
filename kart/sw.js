// Kart Cup service worker.
// Pages: network first, so every deploy shows up right away; the last copy is used only when offline.
// Icons and scripts: served from cache and refreshed in the background.
// Live data (/api/kart) is never cached: results must always come from the server.
const CACHE = 'kart-cup-v1';
const SHELL = ['/kart/', '/kart/join/', '/kart/qrcode.js', '/kart/manifest.json', '/kart/icon-192.png', '/kart/icon-512.png', '/kart/apple-touch-icon.png', '/kart/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); return res; })
        .catch(() => caches.match(url.pathname).then((r) => r || caches.match('/kart/')))
    );
    return;
  }

  if (url.pathname.startsWith('/kart/')) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const fresh = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
