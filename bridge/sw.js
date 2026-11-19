// Lets the app open without a signal (practice with robots still works) and start fast.
// Stale-while-revalidate: files come from the saved copy straight away and are refreshed in the background,
// so a change reaches people on their next visit. Bumping CACHE makes a new service worker that fetches every
// file afresh, deletes the old copies and tells open pages a new version is ready. The game server (/api) is never cached.
const CACHE = 'bridge-v49';
const CORE = ['./', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'js/engine.js', 'js/par.js', 'js/bidding.js', 'js/leads.js', 'js/bots.js', 'js/ddplay.js', 'js/table.js', 'js/net.js', 'js/analysis.js', 'js/app.js', 'js/dds-worker.js', 'js/benbridge.js', 'js/skip.js', 'js/leadtrainer.js', 'js/showpoints.js', 'js/autoplay.js', 'js/suitorder.js', 'js/played.js', 'js/share.js', 'js/notify.js', 'js/card.js', 'js/explorer.js', 'js/flashcards.js', 'js/bidpractice.js', 'js/daily.js', 'js/stats.js', 'js/leaks.js', 'js/chatsym.js', 'js/deals.js', 'js/playfrom.js', 'js/rubber.js', 'js/minibridge.js', 'js/wasm/compiled.js', 'js/wasm/compiled.wasm'];
self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache, so a new version really fetches the new files
  // On a first visit (no older copy saved) the page has just downloaded these files, so the browser's own cache may
  // supply them instead of downloading them all twice. /* feature: perf */
  e.waitUntil(caches.keys().then(keys => {
    const mode = keys.some(k => k.startsWith('bridge-')) ? 'reload' : 'default';
    return caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: mode }))));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(async keys => {
    const old = keys.filter(k => k !== CACHE && k.startsWith('bridge-'));
    await Promise.all(old.map(k => caches.delete(k))); // only the app's own caches: BEN's models ('ben-models-…') are kept
    await self.clients.claim();
    // pages opened with the previous version can offer a reload
    if (old.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated', version: CACHE });
  }));
});
const REFRESH_MS = 60000, refreshed = new Map(); // url -> { at, p: the refresh in flight }
function refresh(req, key, id) {
  const en = { at: Date.now(), p: null };
  refreshed.set(id, en);
  return en.p = fetch(req, { cache: 'no-cache' }).then(async res => {
    // keep the full responses only
    if (res.status === 200) await caches.open(CACHE).then(c => c.put(key, res.clone())).catch(() => { });
    return res;
  }).finally(() => { en.p = null; en.at = Date.now(); });
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('/ben/models/')) return; // BEN's models: the BEN worker caches them itself
  const key = e.request.mode === 'navigate' ? './' : e.request;
  // feature: perf. Each file is refreshed at most once a minute: the solver workers load the same scripts and the
  // solver many times over when a board starts, and each copy needn't be fetched again.
  const id = e.request.mode === 'navigate' ? './' : url.href, last = refreshed.get(id);
  const fresh = last && (last.p || Date.now() - last.at < REFRESH_MS) ? null : refresh(e.request, key, id);
  if (!fresh) return e.respondWith(caches.match(key).then(hit => hit || fetch(e.request)).catch(() => Response.error()));
  // keep the worker alive until the background refresh is saved (registered now, while the event is still active)
  e.waitUntil(fresh.then(() => { }, () => { }));
  e.respondWith(caches.match(key).then(hit => hit || fresh.catch(() => Response.error())));
});
