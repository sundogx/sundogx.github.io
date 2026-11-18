// Lets the app open without a signal (practice with robots still works) and start fast.
// Stale-while-revalidate: files come from the saved copy straight away and are refreshed in the background,
// so a change reaches people on their next visit. Bumping CACHE makes a new service worker that fetches every
// file afresh, deletes the old copies and tells open pages a new version is ready. The game server (/api) is never cached.
const CACHE = 'bridge-v23';
const CORE = ['./', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'js/engine.js', 'js/par.js', 'js/bidding.js', 'js/leads.js', 'js/bots.js', 'js/ddplay.js', 'js/table.js', 'js/net.js', 'js/analysis.js', 'js/app.js', 'js/dds-worker.js', 'js/wasm/compiled.js', 'js/wasm/compiled.wasm'];
self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache, so a new version really fetches the new files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(async keys => {
    const old = keys.filter(k => k !== CACHE && k.startsWith('bridge-'));
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // pages opened with the previous version can offer a reload
    if (old.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated', version: CACHE });
  }));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  const fresh = fetch(e.request, { cache: 'no-cache' }).then(async res => {
    // keep the full responses only
    if (res.status === 200) await caches.open(CACHE).then(c => c.put(key, res.clone())).catch(() => { });
    return res;
  });
  // keep the worker alive until the background refresh is saved (registered now, while the event is still active)
  e.waitUntil(fresh.then(() => { }, () => { }));
  e.respondWith(caches.match(key).then(hit => hit || fresh.catch(() => Response.error())));
});
