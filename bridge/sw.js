// Lets the app open without a signal (practice with robots still works) and start fast.
// Cache first: every file comes from the copy saved for its version, and a saved copy is never replaced, so a page
// and the solver workers it starts always run one version. A new version reaches people only through a new CACHE
// name (bump it on every deploy): the browser then installs a new service worker, which fetches every file afresh
// and takes over at once. Pages that were open keep being served from their old copy (and so do the workers they
// start), are told a new version is ready and reload themselves at a safe moment (app.js, "feature: swreload");
// the old copy is deleted once no page or worker uses it. The game server (/api) is never cached.
const CACHE = 'bridge-v68';
const CORE = ['./', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'js/engine.js', 'js/par.js', 'js/bidding.js', 'js/leads.js', 'js/bots.js', 'js/ddplay.js', 'js/table.js', 'js/net.js', 'js/analysis.js', 'js/app.js', 'js/dds-worker.js', 'js/benbridge.js', 'js/skip.js', 'js/leadtrainer.js', 'js/showpoints.js', 'js/autoplay.js', 'js/suitorder.js', 'js/played.js', 'js/share.js', 'js/notify.js', 'js/card.js', 'js/explorer.js', 'js/flashcards.js', 'js/bidpractice.js', 'js/daily.js', 'js/stats.js', 'js/leaks.js', 'js/chatsym.js', 'js/deals.js', 'js/playfrom.js', 'js/rubber.js', 'js/minibridge.js', 'js/learn.js', 'js/ux.js', 'js/wasm/compiled.js', 'js/wasm/compiled.wasm'];
self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache, so a new version really fetches the new files
  // On a first visit (no older copy saved) the page has just downloaded these files, so the browser's own cache may
  // supply them instead of downloading them all twice. /* feature: perf */
  e.waitUntil(caches.keys().then(keys => {
    const mode = keys.some(isVersion) ? 'reload' : 'default';
    return caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: mode }))));
  }).then(() => self.skipWaiting()));
});
const META = 'bridge-meta'; // { current: CACHE of the active worker, pins: { client id: the older CACHE it was loaded from } }
const isVersion = k => k.startsWith('bridge-') && k !== META; // BEN's models ('ben-models-…') are not ours
const num = k => +(k.match(/\d+$/) || [0])[0];
// The pins live in Cache storage: the browser stops an idle service worker and its variables go with it.
let metaP = null, saveChain = Promise.resolve();
function meta() {
  return metaP || (metaP = caches.open(META).then(c => c.match('meta')).then(r => r ? r.json() : null).catch(() => null)
    .then(m => (m && typeof m === 'object' && m.pins ? m : { current: null, pins: {} })));
}
function saveMeta(m) {
  return saveChain = saveChain.then(() => caches.open(META)).then(c => c.put('meta', new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }))).catch(() => { });
}
// the app's pages and workers (blob workers have blob: addresses), not other pages on the same site
const ours = c => c.url.startsWith(self.registration.scope) || c.url.startsWith('blob:' + location.origin);
const allClients = () => self.clients.matchAll({ type: 'all', includeUncontrolled: true }).then(cs => cs.filter(ours));
// forget pages and workers that have closed, and delete old copies nobody uses any more
const pinnedAt = new Map(); // a worker pinned as its script is fetched isn't listed among the clients until it has loaded (a few seconds' grace)
async function prune() {
  const m = await meta(), live = new Set((await allClients()).map(c => c.id));
  let changed = false;
  for (const id of Object.keys(m.pins)) {
    if (live.has(id)) pinnedAt.delete(id);
    else if (!(Date.now() - (pinnedAt.get(id) || 0) < 10000)) { delete m.pins[id]; pinnedAt.delete(id); changed = true; }
  }
  if (changed) await saveMeta(m);
  const keep = new Set([CACHE, ...Object.values(m.pins)]);
  await Promise.all((await caches.keys()).filter(k => isVersion(k) && !keep.has(k)).map(k => caches.delete(k)));
}
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const m = await meta(), old = (await caches.keys()).filter(k => isVersion(k) && k !== CACHE);
    const open = old.length ? await allClients() : [];
    if (old.length) {
      // everything open now was loaded from the previous version: keep serving it that version
      const prev = m.current && old.includes(m.current) ? m.current : old.sort((a, b) => num(a) - num(b)).pop();
      for (const c of open) if (!m.pins[c.id]) m.pins[c.id] = prev;
    }
    m.current = CACHE;
    await saveMeta(m);
    await prune();
    await self.clients.claim();
    // pages opened with the previous version reload themselves at a safe moment
    for (const c of open) if (c.type === 'window' && m.pins[c.id]) c.postMessage({ type: 'updated', version: CACHE });
  })());
});
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'hello' || !e.source) return;
  // a page has loaded (an old one may just have reloaded): tidy up, and tell an old page it missed the news
  e.waitUntil(meta().then(m => { if (m.pins[e.source.id]) e.source.postMessage({ type: 'updated', version: CACHE }); }).then(prune));
});
// Which saved copy serves a request: the one its page or worker was loaded from.
const guess = new Map(); // blob worker id -> CACHE name, for this run of the service worker
async function cacheFor(e, m) {
  if (e.request.mode === 'navigate') return CACHE; // a (re)loaded page is new: the current version
  const id = e.clientId;
  if (m.pins[id]) {
    // a worker started by an old page: Chrome names its parent page as the client of the worker's script request
    if (e.request.destination === 'worker' && e.resultingClientId && !m.pins[e.resultingClientId]) { m.pins[e.resultingClientId] = m.pins[id]; pinnedAt.set(e.resultingClientId, Date.now()); saveMeta(m); }
    return m.pins[id];
  }
  if (!id || !Object.keys(m.pins).length) return CACHE;
  // A blob worker (the play solver, Learn) loads its scripts without a request that names its page. If every
  // page open is an old one on the same version, it belongs to one of them; with old and new pages open at once
  // there is no telling, and it gets the current version.
  if (!guess.has(id)) {
    const cs = await allClients(), me = cs.find(c => c.id === id);
    let v = CACHE;
    if (me && me.url.startsWith('blob:')) {
      const wins = new Set(cs.filter(c => c.type === 'window').map(c => m.pins[c.id] || CACHE));
      if (wins.size === 1) v = [...wins][0];
    }
    guess.set(id, v);
    if (v !== CACHE) { m.pins[id] = v; pinnedAt.set(id, Date.now()); saveMeta(m); }
  }
  return guess.get(id);
}
let pruneAt = 0;
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('/ben/models/')) return; // BEN's models: the BEN worker caches them itself
  e.respondWith((async () => {
    const m = await meta();
    let name = await cacheFor(e, m);
    if (name !== CACHE && !(await caches.has(name))) name = CACHE;
    if (name !== CACHE && Date.now() - pruneAt > 60000) { pruneAt = Date.now(); e.waitUntil(prune()); }
    const key = e.request.mode === 'navigate' ? './' : e.request;
    const c = await caches.open(name), hit = await c.match(key);
    if (hit) return hit;
    // not saved (a file outside CORE, e.g. BEN's scripts): fetch it, and keep it for offline use in the current
    // version's copy only if that copy doesn't have it yet (never replace a saved file mid-session)
    const res = await fetch(e.request);
    if (res.status === 200 && res.type === 'basic' && name === CACHE) e.waitUntil(c.put(key, res.clone()).catch(() => { }));
    return res;
  })().catch(() => Response.error()));
});
