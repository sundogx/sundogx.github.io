// ======================= Double-dummy analysis, par and hand-record export =======================
// The solver runs in background workers (js/dds-worker.js); results are cached by deal.
// Loaded before app.js; uses its helpers at run time.

const DD = { cache: new Map(), queue: [], workers: [], failed: false };
const handsKey = h => SEATS.map(s => h[s].join('')).join('|');
function ddEntry(h) { return DD.cache.get(handsKey(h)); }
// Queue one job per strain; the contract's strain (if known) goes first.
function requestDD(h, urgent, firstStrain) {
  if (DD.failed && Date.now() - (DD.failedAt || 0) > 120e3) ddRetry();
  if (!h || DD.failed) return;
  const k = handsKey(h);
  let en = DD.cache.get(k);
  if (!en) {
    en = { table: { N: {}, E: {}, S: {}, W: {} }, done: false, strainsDone: 0, queued: true };
    DD.cache.set(k, en);
    const jobs = ['N', 'S', 'H', 'D', 'C'].map(st => ({ k, h, st }));
    if (urgent) DD.queue.unshift(...jobs); else DD.queue.push(...jobs);
  }
  if (firstStrain) {
    const i = DD.queue.findIndex(j => j.k === k && j.st === firstStrain);
    if (i > 0) DD.queue.unshift(DD.queue.splice(i, 1)[0]);
  }
  if (urgent) { // move this board's remaining jobs ahead of other boards
    const mine = DD.queue.filter(j => j.k === k), rest = DD.queue.filter(j => j.k !== k);
    DD.queue = mine.concat(rest);
  }
  pumpDD();
}
// Every solver worker gets the WebAssembly module compiled once by the page (it compiles its own if that fails).
let ddWasmP = null;
function ddWasm() {
  if (!ddWasmP) ddWasmP = (async () => {
    const r = await fetch('js/wasm/compiled.wasm'); if (!r.ok) throw new Error('solver not found');
    return WebAssembly.compileStreaming && /wasm/.test(r.headers.get('content-type') || '') ? WebAssembly.compileStreaming(r) : WebAssembly.compile(await r.arrayBuffer());
  })().catch(e => { ddWasmP = null; return null; });
  return ddWasmP;
}
/* feature: perf */ // Send the page's compiled solver first and hold the worker's other messages until it is ready
// (or has failed), so a warm-up or job that arrives early doesn't make the worker fetch and compile its own copy.
function ddGiveWasm(w) {
  const post = w.postMessage.bind(w);
  const ready = ddWasm().then(mod => { if (mod) try { post({ wasm: mod }); } catch (e) { } }, () => { });
  w.postMessage = (m, t) => { ready.then(() => { try { post(m, t); } catch (e) { if (w.onerror) w.onerror(e); } }); };
}
function ddNewWorker() {
  const w = new Worker('js/dds-worker.js');
  ddGiveWasm(w);
  return w;
}
const ddCores = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
// Hand-record analysis waits while a robot is thinking (RobotDD, LeadDD below), so it doesn't slow the robot down.
const ddRobotBusy = () => RobotDD.wait.size > 0 || LeadDD.wait.size > 0;
function makeWorker() {
  const w = ddNewWorker();
  w.job = null;
  w.onmessage = e => {
    const m = e.data, en = DD.cache.get(m.k);
    if (m.done) { w.job = null; if (en) { en.strainsDone++; if (en.strainsDone === 5) { en.done = true; ddVersion++; } } pumpDD(); }
    else if (en) en.table[m.decl][m.st] = m.v;
    if (en) onDDUpdate(m.k);
  };
  w.onerror = () => { // drop this worker, retry its job once on a new one, and give up only if that fails too
    const j = w.job; w.job = null;
    try { w.terminate(); } catch (e) { }
    DD.workers = DD.workers.filter(x => x !== w);
    if (j && !j.retried) { j.retried = true; DD.queue.unshift(j); pumpDD(); } else ddFail();
  };
  return w;
}
function ddFail() { // give up for now; try again when the connection returns or after two minutes
  DD.failed = true; DD.failedAt = Date.now();
  for (const w of DD.workers) try { w.terminate(); } catch (e) { } // don't leave idle solvers holding memory
  DD.workers = [];
  for (const [k, en] of DD.cache) if (!en.done) DD.cache.delete(k); // so they are queued afresh later
  DD.queue = [];
  ddDropWorkers();
}
// stop the analysis workers, so one still solving can't report into an entry made afresh after a retry
function ddDropWorkers() { for (const w of DD.workers) { w.onmessage = w.onerror = null; try { w.terminate(); } catch (e) { } } DD.workers = []; }
function ddRetry() { if (DD.failed) { DD.failed = false; ddDropWorkers(); if (T) renderSide(true); } }
window.addEventListener('online', ddRetry);
function pumpDD() {
  if (DD.failed || !DD.queue.length) return; // workers are made when there is work
  if (!DD.workers.length) {
    try {
      const n = ddCores() <= 4 ? 1 : 2;
      for (let i = 0; i < n; i++) DD.workers.push(makeWorker());
    } catch (err) { ddFail(); return; }
  }
  if (ddRobotBusy()) return; // resumed by robotDDDone
  for (const w of DD.workers) {
    if (w.job || !DD.queue.length) continue;
    w.job = DD.queue.shift();
    w.postMessage(w.job);
  }
}
let openRecord = null; // index of hand record currently shown
let ddFrame = 0;
const ddKeys = new Set();
function onDDUpdate(k) { // many messages arrive per board; redraw at most once per frame
  ddKeys.add(k);
  if (ddFrame) return;
  ddFrame = requestAnimationFrame(() => { ddFrame = 0; const ks = [...ddKeys]; ddKeys.clear(); ks.forEach(redrawDD); });
}
function redrawDD(k) {
  if (!T) return;
  if (openRecord !== null && T.history[openRecord] && handsKey(T.history[openRecord].hands) === k) {
    const el = $('ddBox'); if (el) el.innerHTML = ddHTML(T.history[openRecord]);
  }
  if (T.history.some(h => handsKey(h.hands) === k)) renderSide();
}
function parFor(h) {
  const en = ddEntry(h.hands);
  if (!en || !en.done) return null;
  return parScore(en.table, h.vul);
}
function ddHTML(h) {
  if (DD.failed) return '<p class="note">Double-dummy analysis isn\'t available in this browser.</p>';
  const en = ddEntry(h.hands);
  if (!en) { requestDD(h.hands, true); return '<p class="note">Starting analysis…</p>'; }
  if (!en.done && openRecord !== null && T.history[openRecord] === h) requestDD(h.hands, true);
  const cols = ['N', 'S', 'H', 'D', 'C'];
  const rows = ['N', 'S', 'E', 'W'].map(d => `<tr><th>${d}</th>${cols.map(c => { const v = en.table[d][c]; return `<td class="${v >= 7 ? 'mk' : ''}">${v === undefined ? '…' : v >= 7 ? v - 6 : '–'}</td>`; }).join('')}</tr>`).join('');
  const par = en.done ? parScore(en.table, h.vul) : null;
  let played = '';
  if (en.done && h.contract) {
    const dt = en.table[h.contract.declarer][h.contract.strain];
    played = `<p class="note">Double dummy, ${typeof contractHTML === "function" ? contractHTML(h.contract) : contractText(h.contract)} takes ${dt} tricks (${resultText(h.contract, dt)}). At the table: ${h.declTricks}.</p>`;
  }
  let parLine = '';
  if (par) {
    const sg = v => (v > 0 ? '+' : '') + v, im = toImps(h.scoreNS - par.scoreNS);
    parLine = `<p><b>Par:</b> ${redSym(esc(par.text.replace(/(by \w+)([=+-])/, '$1 $2')))}, N-S ${sg(par.scoreNS)}. At the table N-S ${sg(h.scoreNS)}${im ? `, ${sg(im)} IMP${Math.abs(im) === 1 ? '' : 's'} against par` : ', the par score'}.</p>`;
  }
  return `<table class="ddt"><tr><th></th>${cols.map(c => `<th class="${isRed(c) ? 'red' : ''}">${SYM[c]}</th>`).join('')}</tr>${rows}</table>
    <p class="note">Numbers are the level each declarer makes with perfect play by everyone; a dash means not even one level.${en.done ? '' : ' Still analysing…'}</p>
    ${parLine}${played}`;
}

// ---------- Play review: which cards played cost a trick, double dummy ----------
// Every card of a finished board is checked against the solver: the position just before it (the cards still
// held, the trick so far) is solved for the player to move, and a card that takes fewer tricks for its side than
// the best card there "cost" the difference. One worker of its own, made on first use, fed one position at a
// time and paused while a robot is thinking. Results are cached by deal and play.
const PlayDD = { w: null, cache: new Map(), queue: [], cur: null, failed: false };
function reviewKey(h) { return handsKey(h.hands) + '#' + h.tricks.map(tr => tr.cards.map(pc => pc.card).join('')).join('|'); }
function reviewFlat(h) { const f = []; h.tricks.forEach((tr, k) => tr.cards.forEach((pc, j) => f.push({ ...pc, trick: k, pos: j, leader: tr.leader }))); return f; }
function reviewWorker() {
  if (PlayDD.w) return PlayDD.w;
  // a worker from a few lines here, with the solver scripts the robots use (engine.js, ddplay.js, wasm/compiled.js)
  const u = p => JSON.stringify(new URL('js/' + p, location.href).href);
  const src = `importScripts(${u('wasm/compiled.js')}, ${u('engine.js')}, ${u('ddplay.js')});
let mod = null, solve = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.wasm) { mod = mod || m.wasm; return; }
  try {
    if (!solve) { if (!mod) mod = await WebAssembly.compile(await (await fetch(${u('wasm/compiled.wasm')})).arrayBuffer()); solve = ddSolver(create_dds_module, mod); }
    self.postMessage({ k: m.k, i: m.i, r: await solve(m.job) });
  } catch (err) { self.postMessage({ k: m.k, i: m.i, error: String(err && err.message || err) }); }
};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = PlayDD.w = new Worker(url);
  ddGiveWasm(w);
  w.onmessage = e => {
    const m = e.data, en = PlayDD.cache.get(m.k), j = PlayDD.cur; PlayDD.cur = null;
    if (m.error) { reviewFail(); return; }
    if (en && j) {
      const legalHere = j.legal, best = Math.max(...legalHere.map(c => m.r[c] ?? -1));
      const got = m.r[j.card];
      en.res[m.i] = got === undefined || best < 0 ? { loss: 0, best: [] } : { loss: Math.max(0, best - got), best: legalHere.filter(c => m.r[c] === best), legal: legalHere, tricks: got };
      en.n++; if (en.n >= en.res.length) en.done = true;
      onReviewUpdate(m.k);
    }
    pumpReview();
  };
  w.onerror = () => reviewFail();
  return w;
}
function reviewFail() {
  PlayDD.failed = true; PlayDD.queue = []; PlayDD.cur = null;
  try { if (PlayDD.w) PlayDD.w.terminate(); } catch (e) { } PlayDD.w = null;
  for (const [k, en] of PlayDD.cache) if (!en.done) PlayDD.cache.delete(k);
  if (T && openRecord !== null) onReviewUpdate(null);
}
// The review of a board's play: { res: [per card: null (not yet) or { loss, best, tricks }], done }, started on first ask.
function playReview(h) {
  if (!h || !h.contract || !h.tricks || !h.tricks.length || PlayDD.failed || typeof Worker === 'undefined') return null;
  if (SEATS.some(s => !h.hands[s] || h.hands[s].some(c => c[0] === '?'))) return null;
  const k = reviewKey(h);
  let en = PlayDD.cache.get(k);
  if (en) return en;
  const flat = reviewFlat(h), strain = h.contract.strain;
  en = { res: flat.map(() => null), n: 0, done: false };
  const played = new Set();
  flat.forEach((pc, i) => {
    const hands = {}; SEATS.forEach(s => { hands[s] = h.hands[s].filter(c => !played.has(c)); });
    const trick = flat.slice(i - pc.pos, i).map(x => x.card);
    const led = trick.length ? suitOf(trick[0]) : null, hand = hands[pc.seat];
    const follow = led && hand.filter(c => suitOf(c) === led);
    const legal = follow && follow.length ? follow : hand;
    played.add(pc.card);
    if (legal.length < 2 || (legal.every(c => suitOf(c) === suitOf(legal[0])) && ddRunOf(legal, hands, trick))) { en.res[i] = { loss: 0, best: [] }; en.n++; return; }
    const job = { trump: DD_TRUMP[strain], first: SEATS.indexOf(pc.leader), trick, pbn: ddPBN(hands), hands, mover: pc.seat };
    PlayDD.queue.push({ k, i, job, legal, card: pc.card });
  });
  if (en.n >= en.res.length) en.done = true;
  if (PlayDD.cache.size > 30) PlayDD.cache.delete(PlayDD.cache.keys().next().value);
  PlayDD.cache.set(k, en);
  pumpReview();
  return en;
}
// all the legal cards are one run of equals in one suit (no card anyone holds or has played to this trick between them): no choice to check
function ddRunOf(legal, hands, trick) {
  const s = suitOf(legal[0]), rs = legal.map(rankOf).sort((a, b) => a - b), others = new Set(SEATS.flatMap(x => hands[x]).concat(trick));
  for (let r = rs[0]; r <= rs[rs.length - 1]; r++) if (others.has(s + RANKS[r]) && !legal.includes(s + RANKS[r])) return false;
  return true;
}
let reviewWait = 0;
function pumpReview() {
  if (PlayDD.cur || PlayDD.failed || !PlayDD.queue.length) return;
  if (ddRobotBusy()) { if (!reviewWait) reviewWait = setTimeout(() => { reviewWait = 0; pumpReview(); }, 300); return; } // a robot is thinking: it goes first (one poll at a time)
  // the board in the open hand record goes first
  const want = openRecord !== null && T && T.history[openRecord] && T.history[openRecord].tricks ? reviewKey(T.history[openRecord]) : null;
  let i = want ? PlayDD.queue.findIndex(j => j.k === want) : -1; if (i < 0) i = 0;
  const j = PlayDD.cur = PlayDD.queue.splice(i, 1)[0];
  if (!PlayDD.cache.has(j.k)) { PlayDD.cur = null; pumpReview(); return; }
  try { reviewWorker().postMessage({ k: j.k, i: j.i, job: { trump: j.job.trump, first: j.job.first, trick: j.job.trick, pbn: j.job.pbn, hands: j.job.hands, mover: j.job.mover } }); }
  catch (e) { reviewFail(); }
}
let reviewFrame = 0;
function onReviewUpdate() { // redraw the open hand record's play table (at most once per frame)
  if (reviewFrame) return;
  reviewFrame = requestAnimationFrame(() => { reviewFrame = 0; if (typeof redrawReview === 'function') redrawReview(); });
}

// ---------- PBN export ----------
function pbnBoard(h, t) {
  const pbnHand = cards => ['S', 'H', 'D', 'C'].map(su => cards.filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => c[1]).join('')).join('.');
  const order = [h.dealer, nextSeat(h.dealer), partnerOf(h.dealer), nextSeat(partnerOf(h.dealer))];
  const vul = { None: 'None', NS: 'NS', EW: 'EW', Both: 'All' }[h.vul];
  const d = new Date();
  const name = s => { const o = t.seats[s]; return o ? (o.kind === 'robot' ? 'Robot' : o.name) : ''; };
  const L = [];
  L.push('[Event "' + (t.name || 'Bridge table').replace(/"/g, "'") + '"]', `[Date "${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}"]`, `[Board "${h.board}"]`);
  SEATS.forEach(s => L.push(`[${SEAT_NAME[s]} "${name(s).replace(/"/g, "'")}"]`));
  L.push(`[Dealer "${h.dealer}"]`, `[Vulnerable "${vul}"]`, `[Deal "${h.dealer}:${order.map(s => pbnHand(h.hands[s])).join(' ')}"]`);
  if (h.contract) {
    const c = h.contract;
    L.push(`[Declarer "${c.declarer}"]`, `[Contract "${c.level}${c.strain === 'N' ? 'NT' : c.strain}${c.doubled === 1 ? 'X' : c.doubled === 2 ? 'XX' : ''}"]`, `[Result "${h.declTricks}"]`);
  } else L.push('[Declarer ""]', '[Contract "Pass"]', '[Result ""]');
  L.push(`[Auction "${h.dealer}"]`);
  const calls = h.auction.map(a => a.call === 'P' ? 'Pass' : a.call.replace('N', 'NT'));
  for (let i = 0; i < calls.length; i += 4) L.push(calls.slice(i, i + 4).join(' '));
  if (h.contract && h.tricks && h.tricks.length) {
    const lead = nextSeat(h.contract.declarer);
    const cols = [lead, nextSeat(lead), partnerOf(lead), nextSeat(partnerOf(lead))];
    L.push(`[Play "${lead}"]`);
    h.tricks.forEach(tr => L.push(cols.map(s => { const pc = tr.cards.find(x => x.seat === s); return pc ? pc.card : '-'; }).join(' ')));
    if (h.tricks.length < 13) L.push('*');
  }
  const en = ddEntry(h.hands);
  if (en && en.done) {
    const par = parScore(en.table, h.vul);
    L.push(`[OptimumScore "NS ${par.scoreNS}"]`);
  }
  return L.join('\n');
}
// ---------- hand record as a document (Word, or printed to PDF) ----------
function recordDocHTML(h, t) {
  const col = s => (s === 'H' || s === 'D') ? '#c62828' : '#000';
  const sym = s => `<span style="color:${col(s)}">${SYM[s]}</span>`;
  const handHTML = s => `<b>${SEAT_NAME[s]}</b><br>${['S', 'H', 'D', 'C'].map(su => sym(su) + ' ' + (h.hands[s].filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => rankLabel(c[1])).join(' ') || '–')).join('<br>')}`;
  const callHTML = c => c === 'P' ? 'Pass' : c === 'X' ? '<span style="color:#c62828">X</span>' : c === 'XX' ? '<span style="color:#1f5fae">XX</span>' : c[0] + sym(c[1]);
  const order = ['W', 'N', 'E', 'S'];
  const cells = []; for (let i = 0; i < order.indexOf(h.dealer); i++) cells.push('');
  (h.auction || []).forEach(a => cells.push(callHTML(a.call) + (a.alert ? '*' : '')));
  const rows = []; for (let i = 0; i < cells.length; i += 4) rows.push('<tr>' + [0, 1, 2, 3].map(j => `<td>${cells[i + j] ?? ''}</td>`).join('') + '</tr>');
  const alerts = (h.auction || []).filter(a => a.alert).map(a => `<li>${callHTML(a.call)} by ${SEAT_NAME[a.by]}: ${esc(a.alert)}</li>`).join('');
  const result = h.contract ? `${contractText(h.contract)}, ${resultText(h.contract, h.declTricks)} (${h.declTricks} tricks). N-S ${h.scoreNS > 0 ? '+' : ''}${h.scoreNS}` : 'Passed out';
  let dd = '';
  const en = ddEntry(h.hands);
  if (en && en.done) {
    const st = ['N', 'S', 'H', 'D', 'C'];
    dd = `<h3>Double-dummy analysis</h3><table class="grid"><tr><th></th>${st.map(s => `<th>${s === 'N' ? 'NT' : sym(s)}</th>`).join('')}</tr>${['N', 'S', 'E', 'W'].map(d => `<tr><th>${d}</th>${st.map(s => { const v = en.table[d][s]; return `<td>${v >= 7 ? v - 6 : '–'}</td>`; }).join('')}</tr>`).join('')}</table>`;
    const par = parScore(en.table, h.vul); if (par) dd += `<p>Par: ${esc(par.text)}, N-S ${par.scoreNS > 0 ? '+' : ''}${par.scoreNS}</p>`;
  }
  let play = '';
  if (h.tricks && h.tricks.length && h.contract) play = `<h3>Play</h3><table class="grid"><tr><th>Trick</th>${['N', 'E', 'S', 'W'].map(s => `<th>${s}</th>`).join('')}</tr>${h.tricks.map((tr, k) => {
    const w = tr.cards.length === 4 ? trickWinner(tr, h.contract.strain) : null;
    return `<tr><td>${k + 1}</td>${['N', 'E', 'S', 'W'].map(s => { const pc = tr.cards.find(x => x.seat === s); return `<td>${pc ? (s === w ? '<b><u>' : '') + sym(pc.card[0]) + rankLabel(pc.card[1]) + (s === w ? '</u></b>' : '') : ''}</td>`; }).join('')}</tr>`;
  }).join('')}</table><p style="font-size:10pt">The underlined card won each trick.</p>`;
  const title = `Board ${h.board}${t && t.name ? ' · ' + esc(t.name) : ''}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#000;margin:24px}
h2{margin:0 0 4px}h3{margin:18px 0 6px;font-size:13pt}
table{border-collapse:collapse}td,th{padding:3px 9px;text-align:center}
.grid td,.grid th{border:1px solid #999}.diag td{vertical-align:top;text-align:left;padding:6px 16px;line-height:1.5}
</style></head><body><h2>${title}</h2><p>Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
<table class="diag"><tr><td></td><td>${handHTML('N')}</td><td></td></tr><tr><td>${handHTML('W')}</td><td></td><td>${handHTML('E')}</td></tr><tr><td></td><td>${handHTML('S')}</td><td></td></tr></table>
<h3>Auction</h3><table class="grid"><tr>${order.map(s => `<th>${SEAT_NAME[s]}</th>`).join('')}</tr>${rows.join('')}</table>${alerts ? `<ul style="font-size:10pt">${alerts}</ul>` : ''}
<h3>Result</h3><p>${result}</p>${dd}${play}</body></html>`;
}
function exportRecord(h, kind) {
  const base = `board-${h.board}`;
  if (kind === 'pbn') return downloadText(base + '.pbn', pbnBoard(h, T) + '\n');
  const html = recordDocHTML(h, T);
  if (kind === 'doc') return downloadText(base + '.doc', html, 'application/msword'); // Word opens HTML saved as .doc
  // PDF: open the record and the print dialog; choose "Save as PDF" there
  let w = null; try { w = window.open('', '_blank'); } catch (e) { }
  if (w) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 300); }
  else {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
  }
  toast('In the print window, choose "Save as PDF".', 4000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to the clipboard'); } catch (e2) { toast('Copying is blocked here. Select the text and copy it yourself.'); }
    ta.remove();
  }
}
function downloadText(name, text, type = 'text/plain') {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { copyText(text); }
}

// ---- Robot card play in practice games: double-dummy sampling (js/ddplay.js) in a worker of its own ----
// robotDDCard(t, seat) resolves to the card the solver picks, or null (no need, too slow, or no solver),
// in which case the robot plays its heuristic card. Only ddView(t, seat), what the robot may see, is sent.
// Opening leads go to robotDDLead below (js/leads.js), several workers at once.
// After the opening lead the robots also read the cards played so far (BEN-style play-consistency weighting,
// js/ddplay.js ddConsistency): 96 layouts are dealt and the K that best fit the play so far are solved, weighted by fit.
// relax/stop (ddSample): a player whose auction limits almost no layout meets (a human's odd bid) has them dropped, and
// dealing stops early when few layouts fit.
const RobotDD = { w: null, n: 0, wait: new Map(), fails: 0, K: 24, MIN_K: 8, BUDGET_MS: 1500, LEADS: true, LEAD_TOL: 30, SPLIT_TRICKS: 2,
  DECL: { pool: 96, weigh: 1, wOpp: 0.8, relax: 0.05, stop: 1 }, DEF: { pool: 96, weigh: 1, wOpp: 0.8, wPart: 0.8, relax: 0.05, stop: 1 } };
function robotDDWorker() {
  if (RobotDD.w) return RobotDD.w;
  const w = RobotDD.w = ddNewWorker();
  w.busy = new Map(); // requests the worker hasn't answered yet (also those the page stopped waiting for): k -> sent at
  w.onmessage = e => {
    const m = e.data, f = RobotDD.wait.get(m.k);
    w.busy.delete(m.k);
    if (m.error) { RobotDD.fails++; console.warn('robot solver:', m.error); } else if (m.card) RobotDD.fails = 0;
    if (f) { RobotDD.wait.delete(m.k); f(m.card || null); }
    robotDDDone();
  };
  w.onerror = () => robotDDDrop(true);
  return w;
}
function robotDDDrop(failed) { // stop this worker; anything waiting gets the heuristic card
  try { if (RobotDD.w) RobotDD.w.terminate(); } catch (e) { }
  RobotDD.w = null; if (failed) RobotDD.fails++;
  for (const f of RobotDD.wait.values()) f(null);
  RobotDD.wait.clear();
  robotDDDone();
}
function robotDDDone() { if (!ddRobotBusy()) setTimeout(pumpDD, 0); } // a robot decision ended: let the analysis go on
function robotDDCard(t, seat) {
  // "Use BEN robots" (js/benbridge.js, practice only): BEN's card, else (no answer in time, error) the usual robot's
  const ben = typeof BenBridge !== 'undefined' ? BenBridge.card(t, seat) : null;
  if (ben) return ben.then(card => card || robotDDCardStd(t, seat));
  return robotDDCardStd(t, seat);
}
function robotDDCardStd(t, seat) {
  let view, prefer;
  try {
    if (typeof ddView !== 'function') return Promise.resolve(null);
    view = ddView(t, seat);
    prefer = botPlay(t, seat); // the heuristic's card wins ties (sequence leads, signals)
  } catch (e) { console.error(e); return Promise.resolve(null); }
  return robotDDSolve(view, prefer);
}
// The options of a robot's card decision (js/ddplay.js ddChoose).
function robotDDOpts(prefer) {
  return { k: RobotDD.K, minK: RobotDD.MIN_K, ms: RobotDD.BUDGET_MS, hardMs: RobotDD.BUDGET_MS + 400, prefer, lead: 'conv', leadTol: RobotDD.LEAD_TOL, declarer: RobotDD.DECL, defender: RobotDD.DEF };
}
// Solve a robot's view (from ddView). Also used for online tables: the server sends a robot's view to a
// player's browser to work out, since the solver needs more CPU time than the server's free plan allows.
function robotDDSolve(view, prefer) {
  if (RobotDD.fails >= 3 || typeof Worker === 'undefined' || typeof ddWorthIt !== 'function') return Promise.resolve(null);
  try {
    if (!ddWorthIt(view)) return Promise.resolve(null);
    if (!RobotDD.LEADS && !view.tricks.length) return Promise.resolve(null);
    if (!view.tricks.length && view.prior && typeof leadPick === 'function') return robotDDLead(view);
    if (view.tricks.length <= RobotDD.SPLIT_TRICKS && LeadDD.ws.length > 1 && typeof ddDecide === 'function') return robotDDSplit(view, prefer);
    leadWorkersClose(); // past the first tricks: the helper workers aren't needed until the next board
  } catch (e) { console.error(e); return Promise.resolve(null); }
  const k = ++RobotDD.n;
  return new Promise(res => {
    const timer = setTimeout(() => { // too slow: play the heuristic card. The worker finishes the job and goes on;
      // it is restarted only if it seems stuck (an answer more than 10 seconds late)
      RobotDD.wait.delete(k); res(null);
      const w = RobotDD.w;
      if (w && [...w.busy.values()].some(t0 => Date.now() - t0 > 10e3)) robotDDDrop(false); else robotDDDone();
    }, RobotDD.BUDGET_MS + 500);
    RobotDD.wait.set(k, card => { clearTimeout(timer); res(card); });
    try { const w = robotDDWorker(); w.busy.set(k, Date.now()); w.postMessage({ k, play: view, opts: robotDDOpts(prefer) }); }
    catch (e) { RobotDD.wait.delete(k); clearTimeout(timer); robotDDDrop(true); res(null); }
  });
}

// Opening leads (js/leads.js): one decision per board, so it uses several workers at once (half the device's
// cores, 1 to 4), each dealing and solving its share of the layouts within the time budget. Results stream back
// one by one, so a worker that runs late still contributes what it has; the page pools them and picks the lead
// (leadPick: average tricks plus the lead-rule prior). The workers also share the decisions of the first tricks
// (robotDDSplit), are closed after that (each holds a solver's memory) and made again for the next board, warmed up during the auction (robotDDWarm).
const LeadDD = { ws: [], n: 0, wait: new Map(), K: 48, BUDGET_MS: 1700, MIN: 8 };
function leadWorkers() {
  const want = Math.max(1, Math.min(4, Math.floor(ddCores() / 2)));
  while (LeadDD.ws.length < want) {
    const w = ddNewWorker();
    w.onmessage = e => { const f = LeadDD.wait.get(e.data.k); if (f) f(e.data); };
    w.onerror = () => { LeadDD.ws = LeadDD.ws.filter(x => x !== w); try { w.terminate(); } catch (e) { } };
    LeadDD.ws.push(w);
  }
  return LeadDD.ws;
}
function leadWorkersClose() { if (LeadDD.wait.size) return; for (const w of LeadDD.ws) try { w.terminate(); } catch (e) { } LeadDD.ws = []; }
function robotDDLead(view) {
  let ws;
  try { ws = leadWorkers(); } catch (e) { return Promise.resolve(null); }
  const per = Math.ceil(LeadDD.K / ws.length);
  const parts = ws.map(w => new Promise(res => {
    const k = ++LeadDD.n, got = [];
    const end = r => { clearTimeout(timer); LeadDD.wait.delete(k); res(r); };
    const timer = setTimeout(() => end(got), LeadDD.BUDGET_MS + 500); // late: keep what has arrived
    LeadDD.wait.set(k, m => {
      if (m.result) got.push(m.result);
      else if (m.results || m.error) end(m.results || got);
    });
    try { w.postMessage({ k, leadSamples: view, opts: { k: per, minK: 2, ms: LeadDD.BUDGET_MS } }); } catch (e) { end(got); }
  }));
  return Promise.all(parts).then(rs => {
    if (!RobotDD.SPLIT_TRICKS) leadWorkersClose(); // else kept for the first tricks (robotDDSplit)
    robotDDDone();
    const results = [].concat(...rs);
    if (results.length < LeadDD.MIN) return null;
    return leadPick(view, leadCards(view.known[view.seat], view.contract.strain), results).card;
  }).catch(() => { leadWorkersClose(); robotDDDone(); return null; });
}
// The first tricks: with most cards still out, each layout takes tens of milliseconds to solve (a few hundred on a
// phone), so these decisions are split between the lead's workers, kept open until then: each deals its share of the
// layouts (and of the pool for the play check), solves them and streams the results back with their weights. The page
// pools them and decides (ddDecide), the same way ddChoose does in one worker.
function robotDDSplit(view, prefer) {
  const ws = LeadDD.ws.slice();
  const o = { ...ddOpts(view, robotDDOpts(prefer)), declarer: null, defender: null };
  const per = Math.ceil(o.k / ws.length), pool = o.pool ? Math.ceil(o.pool * per / o.k) : 0;
  const parts = ws.map(w => new Promise(res => {
    const k = ++LeadDD.n, got = [], wts = [];
    const end = () => { clearTimeout(timer); LeadDD.wait.delete(k); res({ got, wts }); };
    const timer = setTimeout(end, RobotDD.BUDGET_MS + 500); // late: keep what has arrived
    LeadDD.wait.set(k, m => {
      if (m.result) { got.push(m.result); wts.push(m.weight); }
      else if (m.done || m.error) end();
    });
    try { w.postMessage({ k, playSamples: view, opts: { ...o, k: per, pool, minK: 1, hardMs: 0, prefer: null } }); } catch (e) { end(); }
  }));
  return Promise.all(parts).then(rs => {
    robotDDDone();
    const results = [].concat(...rs.map(r => r.got)), weights = [].concat(...rs.map(r => r.wts));
    const r = ddDecide(view, results, o.weigh ? weights : null, o);
    return r ? r.card : null;
  }).catch(() => { robotDDDone(); return null; });
}
// Warm up the solver workers during the auction of a practice game, so the opening lead and the first cards
// don't wait for workers to start (js/app.js calls this while robots bid). Cheap to call repeatedly.
function robotDDWarm() {
  if (RobotDD.fails >= 3 || typeof Worker === 'undefined') return;
  try {
    if (!RobotDD.w) robotDDWorker().postMessage({ warm: true });
    if (RobotDD.LEADS && !LeadDD.ws.length) for (const w of leadWorkers()) w.postMessage({ warm: true });
  } catch (e) { }
}
