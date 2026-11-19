// BEN worker: STUB. The messages are specified in ben/INTERFACE.md; the page side is js/benbridge.js.
//
// This stub answers with the app's own robots (js/bidding.js botCall, js/leads.js botLead, js/ddplay.js ddChoose
// with the DDS solver), so the "Use BEN robots" option works end to end before the BEN port exists. The porting
// work replaces the three answer functions below (bid, lead, play) and loadModels with BEN's networks run by
// onnxruntime-web; the message loop at the bottom, cachedFetch and the reply shapes should stay as they are.
// It is a classic worker (importScripts). To make it a module worker, set "worker": "module" in
// ben/models/manifest.json; js/benbridge.js reads that before it starts the worker.
//
// This folder (bridge/ben/) is meant for BEN-derived code and models under GPL-3.0 (github.com/lorserker/ben,
// by Lorand Dali and Thorvald Aagaard). The stub itself contains no BEN code.

importScripts('../js/wasm/compiled.js', '../js/engine.js', '../js/bidding.js', '../js/leads.js', '../js/bots.js', '../js/ddplay.js');

// The models are kept with the Cache API under a name of their own, so they download once and survive app updates
// (sw.js deletes only its own 'bridge-' caches and doesn't touch ben/models/). Bump the name to replace the models.
const MODEL_CACHE = 'ben-models-v1';

// fetch(url) through MODEL_CACHE, reporting bytes as they arrive: onBytes(n) is called with each chunk's size.
async function cachedFetch(url, onBytes) {
  const cache = typeof caches !== 'undefined' ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  const hit = cache && await cache.match(url).catch(() => null);
  if (hit) { const b = await hit.arrayBuffer(); if (onBytes) onBytes(b.byteLength); return b; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const parts = [], reader = r.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); n += value.byteLength; if (onBytes) onBytes(value.byteLength);
  }
  const buf = new Uint8Array(n); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.byteLength; }
  if (cache) await cache.put(url, new Response(buf.buffer, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' } })).catch(() => { });
  return buf.buffer;
}

// Load everything listed in models/manifest.json ({ files: [{ name, bytes }], totalBytes }), with progress.
// With no manifest (the stub's usual case) there is nothing to load. The port would create its ORT sessions here.
const models = {};
async function loadModels(base, progress) {
  const r = await fetch(base + 'models/manifest.json', { cache: 'no-cache' }).catch(() => null);
  const man = r && r.ok ? await r.json() : null;
  const files = man && Array.isArray(man.files) ? man.files : [];
  const total = +man?.totalBytes || files.reduce((a, f) => a + (+f.bytes || 0), 0) || files.length || 1;
  let loaded = 0;
  progress(0, total);
  for (const f of files) {
    models[f.name] = await cachedFetch(base + 'models/' + f.name, n => { loaded += n; progress(loaded, total); });
  }
  progress(total, total);
}

// ---- The answers (stub: the app's own robots) ----
// bid: { hand, seat, dealer, auction, vul } -> { call, alert?, explain? }
function bid(m) {
  const r = botCall(m.hand, m.seat, m.dealer, m.auction, m.vul);
  return { call: r.call }; // BEN gives no system explanation; a port may add alert / explain
}
// lead: { hand, seat, dealer, auction, vul, contract } -> { card }
function lead(m) {
  return { card: botLead(m.hand, m.auction, m.contract, m.seat) };
}
// play: { view } -> { card }. view is js/ddplay.js ddView (see INTERFACE.md).
let solverP = null;
const solver = () => solverP || (solverP = fetch('../js/wasm/compiled.wasm').then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)).then(mod => ddSolver(create_dds_module, mod)));
async function play(m) {
  const r = await ddChoose(m.view, await solver(), { k: 16, minK: 4, ms: 1500 }).catch(() => null);
  return { card: r ? r.card : ddLegal(m.view)[0] };
}

// ---- Message loop ----
self.onmessage = async e => {
  const m = e.data || {};
  if (m.type === 'init') {
    try {
      await loadModels(m.base, (loaded, total) => self.postMessage({ type: 'progress', loaded, total }));
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    return;
  }
  const answer = { bid, lead, play }[m.type];
  if (!answer) return;
  try { self.postMessage({ type: m.type, id: m.id, ...(await answer(m)) }); }
  catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};
