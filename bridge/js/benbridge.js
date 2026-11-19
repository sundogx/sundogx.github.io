// ======================= BEN robots (opt-in, practice tables only) =======================
// The page side of the "Use BEN robots" option. This file is the app's own code and contains no BEN code: it
// starts the BEN worker (ben/ben-worker.js, GPL-3.0, a separate program) only when it is needed, asks it for
// robots' calls, leads and cards over postMessage (the messages are in ben/INTERFACE.md), waits a limited time
// and falls back to the usual robots (js/bidding.js, js/leads.js, js/ddplay.js) on any error, timeout or illegal
// answer. A failure shows one quiet toast per page visit; the usual robots then play for the rest of the visit.
// Practice tables only: online tables run their robots on the server.
// Loaded before app.js; uses its helpers (toast, $, esc, T) and table.js (A, turnSeat, occupant) at run time.
const BenBridge = (() => {
  const KEY = 'bridge-ben';                 // localStorage: '1' when the player turned the option on
  const BASE = new URL('ben/', location.href).href;
  const MS = { bid: 4000, lead: 5000, play: 4000 }; // how long a robot waits for BEN before playing as usual
  const S = {
    w: null, state: 'off',                  // off | loading | ready | failed
    n: 0, wait: new Map(),                  // requests: id -> resolve
    loaded: 0, total: 0, misses: 0, toasted: false, manifest: undefined, readyP: null, readyRes: null,
  };
  // READY: set to true once the BEN port in ben/ben-worker.js plays real BEN (until then the option is hidden;
  // add ?ben=1 to the page URL to try it anyway).
  const READY = false || /[?&]ben=1/.test(location.search);
  const on = () => { if (!READY) return false; try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const setOn = v => { try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { } };
  // BEN plays a table's robots only in practice, with the option on, and while the worker hasn't failed this visit.
  const active = t => !!(t && t.local && on() && S.state !== 'failed' && typeof Worker !== 'undefined');

  // ben/models/manifest.json, written by whoever converts the models: its size (totalBytes, or the sum of
  // files[].bytes) is shown before the download, and worker: 'module' makes a module worker. null if absent.
  function manifest() {
    if (S.manifest !== undefined) return Promise.resolve(S.manifest);
    return fetch(BASE + 'models/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)
      .then(m => (S.manifest = m && typeof m === 'object' ? m : null));
  }
  const bytesOf = m => !m ? 0 : +m.totalBytes || +m.total || (Array.isArray(m.files) ? m.files.reduce((a, f) => a + (+f.bytes || +f.size || 0), 0) : 0);
  const mb = b => `${Math.max(1, Math.round(b / 1e6))} MB`;

  function fail(msg) {
    if (msg) console.warn('BEN robots:', msg);
    const was = S.state;
    S.state = 'failed';
    try { if (S.w) S.w.terminate(); } catch (e) { } S.w = null;
    for (const f of S.wait.values()) f(null);
    S.wait.clear();
    if (S.readyRes) { S.readyRes(false); S.readyRes = null; }
    progress();
    if (was !== 'off' && !S.toasted && typeof toast === 'function') { S.toasted = true; toast('BEN robots aren\'t available. The usual robots are playing.', 4000); }
  }
  // Start the worker (once) and load the models. Resolves true when ready, false on failure.
  function start() {
    if (S.state === 'ready') return Promise.resolve(true);
    if (S.state === 'failed') return Promise.resolve(false);
    if (S.readyP) return S.readyP;
    S.state = 'loading'; S.loaded = 0; S.total = 0; progress();
    const p = S.readyP = new Promise(res => { S.readyRes = res; });
    manifest().then(m => {
      if (S.state !== 'loading' || S.readyP !== p) return; // stopped (and maybe restarted) meanwhile
      let w;
      try { w = S.w = new Worker(BASE + 'ben-worker.js', m && m.worker === 'module' ? { type: 'module' } : undefined); }
      catch (e) { fail(String(e && e.message || e)); return; }
      w.onmessage = e => onMessage(e.data || {});
      w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); fail(e && e.message || 'worker error'); };
      w.onmessageerror = () => fail('unreadable message');
      w.postMessage({ type: 'init', base: BASE });
    });
    return S.readyP;
  }
  function onMessage(m) {
    if (m.type === 'progress') { S.loaded = +m.loaded || 0; S.total = +m.total || 0; progress(); return; }
    if (m.type === 'ready') { S.state = 'ready'; progress(); if (S.readyRes) { S.readyRes(true); S.readyRes = null; } return; }
    if (m.type === 'error' && m.id === undefined) { fail(m.message || 'load failed'); return; }
    const f = S.wait.get(m.id);
    if (f) { S.wait.delete(m.id); f(m.type === 'error' ? null : m); }
  }
  function stop() {
    try { if (S.w) S.w.terminate(); } catch (e) { }
    S.w = null; S.state = 'off'; S.readyP = null; if (S.readyRes) S.readyRes(false); S.readyRes = null;
    for (const f of S.wait.values()) f(null);
    S.wait.clear(); progress();
  }
  // One request: resolves to the worker's answer, or null (still loading, late, error). Waiting for the models to
  // load doesn't count against BEN; two answers late in a row count as a failure.
  function ask(msg) {
    const ms = MS[msg.type] || 4000, deadline = Date.now() + ms;
    return new Promise(res => {
      let done = false;
      const end = r => { if (!done) { done = true; res(r); } };
      const loadTimer = setTimeout(() => end(null), ms); // not loaded in time: the usual robot, this once
      start().then(ok => {
        clearTimeout(loadTimer);
        if (!ok || !S.w || done) return end(null);
        const id = ++S.n;
        const timer = setTimeout(() => {
          S.wait.delete(id); end(null);
          if (++S.misses >= 2) fail(`no answer to ${msg.type} in ${ms} ms`);
        }, Math.max(800, deadline - Date.now()));
        S.wait.set(id, r => { clearTimeout(timer); if (r) S.misses = 0; end(r); });
        try { S.w.postMessage({ ...msg, id }); } catch (e) { S.wait.delete(id); clearTimeout(timer); fail(String(e && e.message || e)); end(null); }
      }).catch(e => { console.error(e); end(null); });
    });
  }
  const auctionOf = t => (t.auction || []).map(a => ({ call: a.call, by: a.by }));

  // A robot's call: null if BEN isn't in use here, else a promise of { call, alert, explain, board, at } or null.
  function call(t, seat) {
    if (!active(t) || t.phase !== 'auction' || !t.hands || !t.hands[seat]) return null;
    const at = t.auction.length, board = t.board, id = t.id;
    return ask({ type: 'bid', hand: t.hands[seat].slice(), seat, dealer: t.dealer, auction: auctionOf(t), vul: t.vul })
      .then(r => r && typeof r.call === 'string' ? { call: r.call.toUpperCase(), alert: r.alert, explain: r.explain, at, board, id } : null);
  }
  // Make the call in table state s (inside app.js act) if the auction hasn't moved on and the call is legal; the
  // auction entry is marked ben: true (so it gets no 2/1 explanation) with BEN's explanation, if any. true if made.
  function applyCall(s, seat, r) {
    if (!r || s.id !== r.id || s.board !== r.board || s.phase !== 'auction' || s.auction.length !== r.at || turnSeat(s) !== seat) return false;
    const o = occupant(s, controllerOf(s, seat));
    if (!o || o.kind !== 'robot' || !isLegalCall(s.dealer, s.auction, r.call)) return false;
    const explain = typeof r.explain === 'string' && r.explain.trim() ? r.explain.trim().slice(0, 200) : null;
    const alert = r.alert ? (typeof r.alert === 'string' && r.alert.trim() ? r.alert.trim().slice(0, 200) : explain || 'Alerted') : null;
    if (A.call(s, seat, r.call, alert) === false) return false;
    const a = s.auction[s.auction.length - 1];
    if (a && a.by === seat) { a.ben = true; if (explain) a.explain = explain; }
    return true;
  }
  // A robot's opening lead or card: null if BEN isn't in use here, else a promise of a card or null.
  // (Legality is checked by the table, A.robotStep, which plays the usual robot's card otherwise.)
  function card(t, seat) {
    if (!active(t) || t.phase !== 'play' || typeof ddView !== 'function') return null;
    let view;
    try { view = ddView(t, seat); } catch (e) { console.error(e); return null; }
    const legal = ddLegal(view);
    if (legal.length === 1) return Promise.resolve(legal[0]); // nothing to decide
    const lead = !view.tricks.length;
    const msg = lead ? { type: 'lead', hand: view.known[seat].slice(), seat, dealer: t.dealer, auction: auctionOf(t), vul: t.vul, contract: { ...view.contract } }
      : { type: 'play', view };
    return ask(msg).then(r => r && typeof r.card === 'string' && legal.includes(r.card.toUpperCase()) ? r.card.toUpperCase() : null);
  }

  // ---- Options: the checkbox, the download question and a quiet progress bar ----
  function optionsHTML() {
    if (!READY) return '';
    return `<label class="row" style="gap:8px;margin-bottom:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="optBen" ${on() ? 'checked' : ''} style="margin-top:4px"> <span>Use BEN robots<br><span class="note">In practice, the robots bid, lead and play with BEN's neural networks, in this browser. Their calls aren't explained by the usual system.<br>BEN robots by Lorand Dali and Thorvald Aagaard, GPL-3.0 (<a href="https://github.com/sundogx/sundogx.github.io/tree/main/bridge/ben" target="_blank" rel="noopener">bridge/ben</a>, <a href="https://github.com/lorserker/ben" target="_blank" rel="noopener">GitHub</a>)</span></span></label>
      <div id="benBox" class="benbox"></div>`;
  }
  function wireOptions(root) {
    const cb = root.querySelector('#optBen'), box = root.querySelector('#benBox');
    if (!cb || !box) return;
    cb.addEventListener('change', () => {
      if (!cb.checked) { setOn(false); stop(); box.innerHTML = ''; return; }
      cb.checked = false; // on only once the download is confirmed
      box.innerHTML = '<p class="note">Checking the download size…</p>';
      manifest().then(m => {
        const b = bytesOf(m);
        box.innerHTML = `<p class="note">BEN's models are a download of ${b ? 'about ' + mb(b) : 'about 60–100 MB'}, once; they are kept in this browser.</p>
          <div class="row"><button class="btn small primary" id="benYes">Download</button><button class="btn small" id="benNo">Cancel</button></div>`;
        root.querySelector('#benYes').addEventListener('click', () => {
          cb.checked = true; setOn(true); box.innerHTML = '';
          if (S.state === 'failed') { S.state = 'off'; S.readyP = null; S.toasted = false; } // the player asked again
          start(); progress();
        });
        root.querySelector('#benNo').addEventListener('click', () => { box.innerHTML = ''; });
      });
    });
    progress();
  }
  // While the models load: a thin bar at the top of the page, and a line in Options when it is open.
  function progress() {
    if (typeof document === 'undefined') return;
    const loading = S.state === 'loading', pct = S.total > 0 ? Math.min(100, Math.round(100 * S.loaded / S.total)) : 0;
    let bar = document.getElementById('benLoad');
    if (loading && !bar) { bar = document.createElement('div'); bar.id = 'benLoad'; bar.className = 'benload'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Loading BEN robots'); bar.innerHTML = '<div></div>'; document.body.appendChild(bar); }
    if (bar) {
      if (!loading) bar.remove();
      else { bar.firstChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct)); }
    }
    const box = document.getElementById('benBox');
    if (box && !box.querySelector('#benYes')) {
      const size = S.total > 1e5 ? ` (${mb(S.loaded)} of ${mb(S.total)})` : '';
      box.innerHTML = loading ? `<div class="benbar"><div style="width:${pct}%"></div></div><p class="note">Loading BEN robots${size}…</p>`
        : S.state === 'failed' && on() ? '<p class="note">BEN robots couldn\'t be loaded here; the usual robots are playing.</p>' : '';
    }
  }
  return { active, call, applyCall, card, optionsHTML, wireOptions, start, stop, state: () => S.state };
})();
