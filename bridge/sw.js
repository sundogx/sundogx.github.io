// Lets the app open without a signal (practice with robots still works) and start faster.
// Pages and files are fetched fresh when online and kept as a fallback; the game server (/api) is never cached.
const CACHE = 'bridge-v9';
const CORE = ['./', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'js/engine.js', 'js/par.js', 'js/bots.js', 'js/table.js', 'js/net.js', 'js/analysis.js', 'js/app.js', 'js/dds-worker.js', 'js/wasm/compiled.js', 'js/wasm/compiled.wasm'];
const SLOW_MS = 4000; // on a weak signal, use the saved copy after this long
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  const fromNet = fetch(e.request, { cache: 'no-cache' }).then(res => {
    // keep a copy for offline use (full responses only; stay alive until it is written)
    if (res.status === 200) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => { })); }
    return res;
  });
  const netOrCache = fromNet.catch(() => caches.match(key).then(r => r || Response.error()));
  const slow = new Promise(r => setTimeout(r, SLOW_MS)).then(() => caches.match(key)).then(r => r || netOrCache);
  e.respondWith(Promise.race([netOrCache, slow]));
});
