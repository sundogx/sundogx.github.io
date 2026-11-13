// Lets the app open without a signal (practice with robots still works) and start faster.
// Pages and files are fetched fresh when online and kept as a fallback; the game server (/api) is never cached.
const CACHE = 'bridge-v7';
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    // keep a copy for offline use (full responses only; stay alive until it is written)
    if (res.status === 200) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => { })); }
    return res;
  }).catch(() => caches.match(key).then(r => r || Response.error())));
});
