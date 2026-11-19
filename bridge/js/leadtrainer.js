// ===== Opening-lead practice (feature: leadtrainer) =====
// Like BridgeTricks' Lead Trainer: a deal where the opponents declare and you, South, are on lead. The robots bid all
// four hands (botCall), the auction is shown with every call explained, and you pick a card. Then every card in your
// hand (equal cards together) is rated on ~100-200 layouts of the unseen hands consistent with the auction, the way
// the robots' own lead is chosen (js/leads.js leadSample: ddView/leadView limits, solved by DDS in js/dds-worker.js):
// the defenders' average tricks, how often it sets the contract, and its cost against the best card. "Play it out"
// carries on from your lead as a normal practice board. A streak and accuracy counter is kept in localStorage.
// Self-contained: its own screen, built on first use. Loaded before app.js; uses app.js / analysis.js helpers at run time.
const LT = {
  on: false, board: 0, hands: null, dealer: 'N', vul: 'None', auction: [], contract: null, pick: null,
  phase: 'idle', // 'dealing', 'lead' (your choice), 'eval' (solving), 'done'
  res: null, actual: null, t0: 0, ms: 0, err: null, scored: false, gen: 0,
  ws: [], n: 0, wait: new Map(), timer: null, prog: null,
  // layouts wanted, soft time budget (each worker stops before a solve that would end past it) and hard stop.
  // A lead solve (13 cards each) is slow: ~70-680 ms per layout on a desktop core, heavy tail, so on a slow phone
  // the budget, not K, decides how many layouts are used (see README).
  K: 200, BUDGET_MS: 11000, HARD_MS: 14500, MIN: 12,
  kind: 'any',
};
try { LT.kind = localStorage.getItem('bridge-lt-kind') || 'any'; } catch (e) { }
const LT_KINDS = [['any', 'Any contract'], ['game', 'Games and slams'], ['nt', 'Notrump'], ['suit', 'Suit contracts']];
const ltEl = id => document.getElementById(id);
const ltStats = () => Object.assign({ n: 0, good: 0, streak: 0, bestStreak: 0, cost: 0 }, (typeof Local !== 'undefined' && Local.get('bridge-lt')) || {});

function ltBuild() {
  if (ltEl('leadTrainer')) return;
  const s = document.createElement('section');
  s.id = 'leadTrainer'; s.className = 'hidden';
  s.innerHTML = `<div class="topbar"><span class="tt">Lead practice</span><span class="code" id="ltScore"></span>
    <select id="ltKind" aria-label="Contracts">${LT_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <button class="btn small" id="ltLeave">Leave</button></div>
    <div class="bp-wrap"><div class="bp-main"><div id="ltInfo" class="note"></div><div id="ltHand" class="lt-hand"></div>
    <div id="ltResult"></div></div><div class="bp-side" id="ltAuction"></div></div>`;
  ltEl('tableView').after(s);
  s.addEventListener('click', ltClick);
  ltEl('ltKind').addEventListener('change', e => {
    LT.kind = e.target.value; try { localStorage.setItem('bridge-lt-kind', LT.kind); } catch (er) { }
    if (LT.phase === 'lead') ltNext(); // not chosen yet: deal one of the new kind
  });
}
function startLeadTrainer() {
  if (typeof T !== 'undefined' && T) { if (T.local) flushPractice(); goHome(); } // from a practice table's More menu
  if (typeof BP !== 'undefined' && BP.on) leaveBidPractice();
  ltBuild();
  LT.on = true;
  if (typeof leaveModals === 'function') leaveModals();
  ltEl('home').classList.add('hidden'); ltEl('tableView').classList.add('hidden'); ltEl('leadTrainer').classList.remove('hidden');
  ltEl('ltKind').value = LT.kind;
  clearInterval(lobbyTimer);
  for (const w of ltWorkers()) try { w.postMessage({ warm: true }); } catch (e) { } // solver ready by the time you lead
  ltNext();
}
// toHome false: another screen (the practice table) takes over
function leaveLeadTrainer(toHome = true) {
  LT.on = false; LT.gen++; ltStop(); ltClose();
  const s = ltEl('leadTrainer'); if (s) s.classList.add('hidden');
  if (!toHome) return;
  ltEl('home').classList.remove('hidden');
  { const b = ltEl('leadTrainerBtn'); if (b) b.focus({ preventScroll: true }); }
  if (typeof loadLobby === 'function') { loadLobby(); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000); }
}

// ---- The deal: robots bid all four hands until East declares (South on lead) a contract of the chosen kind ----
function ltAuction(hands, dealer, vul) {
  const a = [];
  while (!auctionOver(a)) {
    const s = auctionTurn(dealer, a), r = botCall(hands[s], s, dealer, a, vul);
    a.push(r.alert ? { by: s, call: r.call, alert: r.alert } : { by: s, call: r.call });
  }
  return a;
}
function ltWanted(c, kind) {
  if (!c || c.declarer !== 'E') return false;
  if (kind === 'game') return c.strain === 'N' ? c.level >= 3 : (c.strain === 'S' || c.strain === 'H') ? c.level >= 4 : c.level >= 5;
  if (kind === 'nt') return c.strain === 'N';
  if (kind === 'suit') return c.strain !== 'N';
  return true;
}
// Deals in slices of ~40 ms so the page stays responsive (an auction takes ~15 ms; about 1 deal in 4 has East declaring).
function ltFind(kind, gen, done) {
  const t0 = Date.now(), slice = () => {
    if (gen !== LT.gen) return;
    const end = Date.now() + 40;
    while (Date.now() < end) {
      const board = 1 + Math.floor(Math.random() * 16), dealer = boardDealer(board), vul = boardVul(board), hands = deal();
      const auction = ltAuction(hands, dealer, vul), c = finalContract(auction);
      // a rare kind (notrump games...) that doesn't turn up within 3 s: take any contract East declares
      if (ltWanted(c, kind) || (Date.now() - t0 > 3000 && ltWanted(c, 'any'))) return done({ board, dealer, vul, hands, auction, contract: c });
    }
    setTimeout(slice, 0);
  };
  slice();
}
function ltNext() {
  ltStop();
  const gen = ++LT.gen;
  Object.assign(LT, { phase: 'dealing', pick: null, res: null, actual: null, err: null, scored: false });
  ltRender();
  ltFind(LT.kind, gen, d => { if (gen !== LT.gen) return; Object.assign(LT, d, { phase: 'lead' }); ltRender(); ltFocus(); });
}

// ---- Workers: the page's DDS worker (js/dds-worker.js leadSamples), kept while this screen is open ----
function ltWorkers() {
  const want = Math.max(1, Math.min(4, ddCores() - 1));
  while (LT.ws.length < want) {
    const w = ddNewWorker();
    w.onmessage = e => { const f = LT.wait.get(e.data.k); if (f) f(e.data); };
    w.onerror = () => { LT.ws = LT.ws.filter(x => x !== w); try { w.terminate(); } catch (e) { } for (const f of w.ltJobs || []) f({ error: 'worker failed' }); };
    LT.ws.push(w);
  }
  return LT.ws;
}
function ltClose() { for (const w of LT.ws) try { w.terminate(); } catch (e) { } LT.ws = []; LT.wait.clear(); }
function ltStop() { clearTimeout(LT.timer); clearInterval(LT.prog); LT.timer = LT.prog = null; if (LT.wait.size) ltClose(); }

// The robots' view of the lead (ddView + leadView: auction limits for the sampler) from South's seat.
function ltTable() { return { hands: LT.hands, auction: LT.auction, contract: LT.contract, vul: LT.vul, play: { tricks: [] } }; }
// Solves the layouts in all workers at once; resolves { results: [{card: defenders' tricks}], actual: {card: tricks} | null }.
function ltEvaluate(gen) {
  let ws;
  try { ws = ltWorkers(); } catch (e) { return Promise.reject(e); }
  if (!ws.length) return Promise.reject(new Error('no workers'));
  const view = ddView(ltTable(), 'S');
  const full = { ...view, known: structuredClone(LT.hands) }; // the real deal, every hand known: one layout
  const per = Math.ceil(LT.K / ws.length), got = [];
  let actual = null;
  const job = (w, msg, onResult) => new Promise(res => {
    const k = ++LT.n;
    const end = () => { LT.wait.delete(k); w.ltJobs = (w.ltJobs || []).filter(f => f !== fin); res(); };
    const fin = m => { if (m.result) onResult(m.result); else if (m.results || m.error) end(); };
    w.ltJobs = (w.ltJobs || []).concat(fin);
    LT.wait.set(k, fin);
    try { w.postMessage({ k, ...msg }); } catch (e) { end(); }
  });
  const parts = ws.map(w => job(w, { leadSamples: view, opts: { k: per, minK: 2, ms: LT.BUDGET_MS } }, r => { got.push(r); }));
  parts.push(job(ws[0], { leadSamples: full, opts: { k: 1, minK: 1 } }, r => { actual = r; }));
  LT.got = got;
  const all = Promise.all(parts);
  // a solve that runs far past the budget (the slowest layouts take seconds): keep what has arrived
  const hard = new Promise(res => { LT.timer = setTimeout(res, LT.HARD_MS); });
  return Promise.race([all, hard]).then(() => {
    clearTimeout(LT.timer);
    if (LT.wait.size) ltClose(); // late workers are still solving: drop them (made afresh for the next board)
    return { results: got.slice(), actual };
  });
}
function ltChoose(card) {
  if (LT.phase !== 'lead' || !LT.hands.S.includes(card)) return;
  LT.pick = card; LT.phase = 'eval'; LT.t0 = performance.now();
  const gen = LT.gen;
  ltRender();
  LT.prog = setInterval(ltProgress, 200);
  ltEvaluate(gen).then(r => {
    if (gen !== LT.gen) return;
    LT.ms = performance.now() - LT.t0;
    LT.res = r.results; LT.actual = r.actual;
    if (LT.res.length < LT.MIN) LT.err = 'Too few layouts could be solved in time.';
  }, e => { if (gen === LT.gen) LT.err = 'The double-dummy solver isn\'t available in this browser.'; })
    .then(() => { if (gen !== LT.gen) return; clearInterval(LT.prog); LT.prog = null; LT.phase = 'done'; ltRender(); ltFocus(); });
}
function ltProgress() {
  const bar = ltEl('ltBar'); if (!bar || LT.phase !== 'eval') return;
  const n = LT.got ? LT.got.length : 0, t = performance.now() - LT.t0;
  const f = Math.min(1, Math.max(n / LT.K, t / LT.BUDGET_MS));
  bar.style.width = Math.round(f * 100) + '%';
  const tx = ltEl('ltBarText'); if (tx) tx.textContent = `${n} layout${n === 1 ? '' : 's'} solved`;
}

// ---- Scoring the leads ----
// Groups of South's cards that are equal whatever the layout: a run of adjacent ranks in one suit.
function ltGroups(hand) {
  const out = [];
  for (const s of UI_SUITS) {
    const cs = hand.filter(c => suitOf(c) === s).sort((a, b) => rankOf(b) - rankOf(a));
    let cur = null;
    for (const c of cs) {
      if (cur && rankOf(cur[cur.length - 1]) - rankOf(c) === 1) cur.push(c);
      else out.push(cur = [c]);
    }
  }
  return out;
}
// One row per group: average defenders' tricks, how often the contract goes down, cost against the best group.
function ltRows(results, hand, contract, actual) {
  const need = 8 - contract.level; // defenders' tricks that set it
  const ok = results.filter(r => r && hand.every(c => c in r));
  const rows = ltGroups(hand).map(g => {
    const c = g[0];
    let tk = 0, set = 0;
    for (const r of ok) { tk += r[c]; if (r[c] >= need) set++; }
    return { cards: g, tricks: ok.length ? tk / ok.length : 0, set: ok.length ? set / ok.length : 0, actual: actual && c in actual ? actual[c] : null };
  });
  const best = Math.max(...rows.map(r => r.tricks));
  rows.forEach(r => { r.cost = best - r.tricks; r.best = r.cost < 0.005; });
  rows.sort((a, b) => b.tricks - a.tricks || b.set - a.set);
  return { rows, n: ok.length, need };
}
const LT_GOOD = 0.05; // within this many tricks of the best card counts as the best lead (sampling noise)
function ltScore(rows) {
  if (LT.scored) return;
  LT.scored = true;
  const mine = rows.find(r => r.cards.includes(LT.pick));
  const st = ltStats(), good = mine.cost < LT_GOOD;
  st.n++; st.cost += mine.cost;
  if (good) { st.good++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else st.streak = 0;
  Local.set('bridge-lt', st);
}

// ---- Drawing ----
const ltGroupHTML = g => `<span class="${isRed(suitOf(g[0])) ? 'red ' : ''}s-${suitOf(g[0])}">${SYM[suitOf(g[0])]}</span>${g.map(c => rankLabel(c[1])).join('')}`;
const ltCardHTML = c => ltGroupHTML([c]);
function ltRenderScore() {
  const st = ltStats(), el = ltEl('ltScore'); if (!el) return;
  el.textContent = st.n ? `Streak ${st.streak} · best lead ${st.good} of ${st.n} (${Math.round(100 * st.good / st.n)}%) · ${(st.cost / st.n).toFixed(2)} tricks lost a lead` : '';
}
function ltRender() {
  ltRenderScore();
  const info = ltEl('ltInfo'), hand = ltEl('ltHand'), box = ltEl('ltResult'), auc = ltEl('ltAuction');
  if (LT.phase === 'dealing' || !LT.hands) { info.textContent = 'Dealing…'; hand.innerHTML = ''; box.innerHTML = ''; auc.innerHTML = ''; return; }
  info.innerHTML = `Board ${LT.board}. Dealer ${SEAT_NAME[LT.dealer]}, ${vulText(LT.vul)}. You are South, on lead against ${contractHTML(LT.contract)}.`;
  const can = LT.phase === 'lead';
  hand.innerHTML = rowsHTML(LT.hands.S, can ? LT.hands.S : [], 'S') + `<div class="note">${hcp(LT.hands.S)} HCP${can ? ' · choose your lead' : ''}</div>`;
  if (!can && LT.pick) { // outline the card you led
    const row = hand.querySelector(`.r .s.s-${suitOf(LT.pick)}`), rk = row && [...row.closest('.r').querySelectorAll('.rk')].find(x => x.textContent === rankLabel(LT.pick[1]));
    if (rk) rk.classList.add('lt-pick');
  }
  const view = { seats: { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'robot' }, W: { kind: 'robot' } }, auction: LT.auction, phase: 'done' };
  auc.innerHTML = auctionGridHTML(view, LT.auction.slice(), LT.dealer, LT.vul, 'S'); // a copy: every call explained
  if (LT.phase === 'lead') box.innerHTML = '';
  else if (LT.phase === 'eval') box.innerHTML = `<p>You lead ${ltCardHTML(LT.pick)}. Solving layouts that fit the auction…</p>
    <div class="lt-prog" role="progressbar" aria-label="Analysis"><div id="ltBar"></div></div><p class="note" id="ltBarText"></p>`;
  else box.innerHTML = ltResultHTML();
  if (LT.phase === 'eval') ltProgress();
}
function ltResultHTML() {
  const btns = `<div class="row"><button class="btn primary" data-ltnext="1">Next</button><button class="btn" data-ltplay="1">Play it out</button></div>`;
  if (LT.err && !(LT.res && LT.res.length)) return `<p class="note">${esc(LT.err)}</p>${btns}`;
  const { rows, n, need } = ltRows(LT.res, LT.hands.S, LT.contract, LT.actual);
  if (!n) return `<p class="note">${esc(LT.err || 'No layouts were solved.')}</p>${btns}`;
  ltScore(rows);
  ltRenderScore();
  const mine = rows.find(r => r.cards.includes(LT.pick)), best = rows.filter(r => r.best);
  const pct = v => Math.round(v * 100) + '%';
  const head = mine.best
    ? `<p><b>${ltCardHTML(LT.pick)} is the best lead</b>: ${mine.tricks.toFixed(2)} tricks on average, sets the contract ${pct(mine.set)} of the time.</p>`
    : `<p>${ltCardHTML(LT.pick)}: ${mine.tricks.toFixed(2)} tricks, sets ${pct(mine.set)}. Best: ${best.map(r => ltGroupHTML(r.cards)).join(', ')}, ${best[0].tricks.toFixed(2)} tricks, sets ${pct(best[0].set)}. <b>Cost ${mine.cost.toFixed(2)} tricks</b>${mine.cost < LT_GOOD ? ' (about the same)' : ''}.</p>`;
  const act = LT.actual ? `<th title="Double dummy, on the real deal">This deal</th>` : '';
  const body = rows.map(r => `<tr class="${r.cards.includes(LT.pick) ? 'lt-you' : ''} ${r.best ? 'lt-best' : ''}"><td>${ltGroupHTML(r.cards)}</td><td>${r.tricks.toFixed(2)}</td><td>${pct(r.set)}</td><td>${r.best ? '' : '−' + r.cost.toFixed(2)}</td>${LT.actual ? `<td>${r.actual == null ? '' : r.actual + (r.actual >= need ? ' ✓' : '')}</td>` : ''}</tr>`).join('');
  return `<div class="bp-res">${head}
    <table class="bp-cmp lt-tab"><tr><th>Lead</th><th>Tricks</th><th>Sets</th><th>Cost</th>${act}</tr>${body}</table>
    <p class="note">Defenders' tricks double dummy, on ${n} layouts of the other hands that fit the auction (${(LT.ms / 1000).toFixed(1)} s). Your lead is outlined, the best in bold. ${need} trick${need === 1 ? '' : 's'} set${need === 1 ? 's' : ''} ${contractHTML(LT.contract)}${LT.actual ? '; ✓ marks the leads that set it on the real deal' : ''}.</p>
    <details class="lt-deal"><summary>The deal</summary>${ltDiagramHTML()}</details>
    ${btns}</div>`;
}
function ltDiagramHTML() {
  const h = s => `<div><div class="lbl">${SEAT_NAME[s]}</div>${rowsHTML(LT.hands[s])}</div>`;
  return `<div class="diagram"><div></div>${h('N')}<div></div>${h('W')}<div class="lbl">${contractHTML(LT.contract)}</div>${h('E')}<div></div>${h('S')}<div></div></div>`;
}
function ltFocus() {
  const b = ltEl('leadTrainer') && ltEl('leadTrainer').querySelector(LT.phase === 'done' ? '[data-ltnext]' : '#ltHand .rk.play');
  if (b) b.focus({ preventScroll: true });
}

// ---- Play it out: a practice board from your lead ----
function ltPlayOut() {
  if (LT.phase !== 'done' || !LT.pick) return;
  const t = newTable({ name: 'Practice', local: true });
  t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: me.name || 'You' }, W: { kind: 'robot' } };
  t.board = LT.board - 1;
  startBoard(t, { dealer: LT.dealer, vul: LT.vul, hands: structuredClone(LT.hands) });
  t.replayOf = null;
  t.auction = LT.auction.map(a => ({ ...a }));
  t.contract = finalContract(t.auction); t.phase = 'play';
  A.card(t, 'S', LT.pick);
  leaveLeadTrainer(false);
  openTable(t);
}

function ltClick(e) {
  const b = e.target.closest('button, [data-alert]'); if (!b) return;
  const d = b.dataset;
  if (b.id === 'ltLeave') leaveLeadTrainer();
  else if (d.play) ltChoose(d.play);
  else if (d.ltnext) { ltNext(); }
  else if (d.ltplay) ltPlayOut();
  else if (d.alert) { if (ltEl('explainPop')) hideExplain(); else showExplain(b, d.alert); }
  else return;
  e.stopPropagation();
}
document.addEventListener('keydown', e => { // N for the next deal once the analysis is shown
  if (!LT.on || LT.phase !== 'done' || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName || '')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); ltNext(); }
});
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-leadtrainer]')) startLeadTrainer(); });
// the practice table's More menu offers it at practice tables only
const LeadTrainer = { render(t) { const b = ltEl('ltMoreBtn'); if (b) b.classList.toggle('hidden', !(t && t.local)); } };
