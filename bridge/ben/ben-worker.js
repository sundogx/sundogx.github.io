// BEN worker: BEN's bidding, opening lead and card play (ben-core.js) on BEN's networks (models/*.onnx) run by
// onnxruntime-web, with the app's DDS wasm for the double-dummy parts. The messages are specified in
// ben/INTERFACE.md; the page side is js/benbridge.js. BEN's parts that need native code (BBA, PIMC, SuitC) are
// left out, and each answer has a time budget below the page's wait (4 s for a call or card, 5 s for a lead).
// If the networks can't run, an answer comes from the app's own robots instead (js/bidding.js botCall,
// js/leads.js botLead, js/ddplay.js ddChoose), so a request is always answered.
// It is a classic worker (importScripts). To make it a module worker, set "worker": "module" in
// ben/models/manifest.json; js/benbridge.js reads that before it starts the worker.
//
// This folder (bridge/ben/) holds BEN-derived code and models under GPL-3.0 (github.com/lorserker/ben,
// by Lorand Dali and Thorvald Aagaard).

importScripts('../js/wasm/compiled.js', '../js/min/engine.js', '../js/min/bidding.js', '../js/min/leads.js', '../js/min/bots.js', '../js/min/ddplay.js', 'ort/ort.wasm.min.js', 'ben-core.js');

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

// Load the networks listed in models/manifest.json ({ models: [{ name, file, bytes }], total_bytes }) and
// onnxruntime's wasm, through MODEL_CACHE, with progress in bytes; then create one ORT session per network.
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';
const sessions = {};
let nn = null;
async function loadModels(base, progress) {
  const r = await fetch(base + 'models/manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('models/manifest.json: HTTP ' + r.status);
  const man = await r.json();
  const list = (man.models || man.files || []).map(f => ({ name: f.name.replace(/\.onnx$/, ''), file: f.file || f.name, bytes: +f.bytes || 0 }));
  const ortBytes = +man.ort_wasm_bytes || 14848852;
  const total = list.reduce((a, f) => a + f.bytes, 0) + ortBytes;
  let loaded = 0;
  const tick = n => { loaded += n; progress(Math.min(loaded, total), total); };
  progress(0, total);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = base + 'ort/';
  ort.env.wasm.wasmBinary = await cachedFetch(base + 'ort/' + ORT_WASM, tick);
  for (const f of list) {
    const buf = await cachedFetch(base + 'models/' + f.file, tick);
    sessions[f.name] = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  for (const k of ['bidder', 'binfo', 'lead_nt', 'lead_suit']) if (!sessions[k]) throw new Error('missing model ' + k);
  nn = {
    async run(name, feeds) {
      const f = {};
      for (const [k, v] of Object.entries(feeds)) f[k] = new ort.Tensor('float32', v.data, v.dims);
      const o = await sessions[name].run(f);
      const out = {};
      for (const [k, v] of Object.entries(o)) { out[k] = Float32Array.from(v.data); if (v.dispose) v.dispose(); }
      return out;
    },
  };
  progress(total, total);
}

// ---- The DDS solver (the app's wasm): raw solves for bidding and leads, ddRun jobs for card play ----
let ddP = null;
const ddInst = () => ddP || (ddP = fetch('../js/wasm/compiled.wasm').then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)).then(mod => ddInstance(create_dds_module, mod)));
let solverP = null;
const solver = () => solverP || (solverP = fetch('../js/wasm/compiled.wasm').then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)).then(mod => ddSolver(create_dds_module, mod)));
const dd = inst => (trump, first, trick, pbn) => ddSolveRaw(inst, trump, first, trick, pbn);

// Time budgets (ms) for each answer, below the page's waits.
const BUDGET = { bid: { ms: 1100, budget: 2600 }, lead: { ms: 1500, budget: 3600 }, play: { ms: 2400 } };

// ---- The answers ----
// bid: { hand, seat, dealer, auction, vul } -> { call }
async function bid(m) {
  if (!nn) return { call: botCall(m.hand, m.seat, m.dealer, m.auction, m.vul).call };
  const r = await BenCore.bid(nn, dd(await ddInst()), m, { ...BUDGET.bid, t0: BenCore.now() });
  return { call: r.call };
}
// lead: { hand, seat, dealer, auction, vul, contract } -> { card }
async function lead(m) {
  if (!nn) return { card: botLead(m.hand, m.auction, m.contract, m.seat) };
  const r = await BenCore.lead(nn, dd(await ddInst()), { ...m, auction: m.auction.map(a => a.call) }, { ...BUDGET.lead, t0: BenCore.now() });
  return { card: r.card };
}
// play: { view } -> { card }. view is js/ddplay.js ddView (see INTERFACE.md).
async function play(m) {
  if (nn) {
    const s = await solver();
    const r = await BenCore.play(nn, s, m.view, BUDGET.play);
    if (r && r.card) return { card: r.card };
  }
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
