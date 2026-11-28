// ===== Your mistakes: drills from your own boards (feature: drills) =====
// Every card you played that cost a trick double dummy (as declarer, your cards and dummy's; on defence, yours) on the
// boards in History becomes a problem: the position just before that card, the hands you could see, the auction and
// the tricks so far. You pick a card; the position is solved (DDS) for every legal card, and you see the tricks each
// takes, the best cards and what you played at the table. Problems come back until you get them right three times in
// a row, with a few days between (a Leitner box: wrong -> box 0, due again this session; right -> next box).
// Like BBO's Bridge Master or Funbridge's deal review, but the problems are your own mistakes.
// The mistakes are found with the hand record's play review (js/analysis.js playReview, read-only, one board at a
// time, only while this screen is open), and the positions are solved by a small worker of its own (the same few lines
// as the play review's worker). Progress is kept in localStorage (`bridge-dr`). Self-contained: its own screen, built
// on first use; it adds its buttons to the home page and the table's More menu itself.

const DR = {
  KEY: 'bridge-dr', V: 1,
  SCAN: 200, // the newest boards checked
  MAX: 400, // problems kept
  GAP: [0, 864e5, 3 * 864e5, 7 * 864e5], // wait before a problem comes back, by box
  LEARNED: 3, // right this many times in a row (box 3): learned
  KINDS: [['all', 'All mistakes'], ['decl', 'Declarer play'], ['def', 'Defence'], ['lead', 'Opening leads'], ['bid', 'Bidding']],
  BV: 1, // version of the bidding check (s.bscanned)
  on: false, kind: 'all', cur: null, pick: null, sol: null, solErr: false, anyway: false,
  scanRec: null, timer: 0, w: null, url: null, idle: 0, n: 0, wait: new Map(), noSolver: false, done: 0,
};

// ---- Pure helpers (also used by tests/drilltest.js) ----
const drFlat = h => { const f = []; h.tricks.forEach((tr, k) => tr.cards.forEach((pc, j) => f.push({ ...pc, trick: k, pos: j, leader: tr.leader }))); return f; };
// whose mistakes a board's cards are: 'decl' (your cards and dummy's when you declared), 'lead', 'def', or null
function drKindOf(r, pc, i) {
  if (r.role === 'declarer') return sameSide(pc.seat, r.seat) ? 'decl' : null;
  if (r.role === 'defender') return pc.seat === r.seat ? (i === 0 ? 'lead' : 'def') : null;
  return null;
}
// the problems on a board, from its finished play review (en.res[i] = { loss, best, legal, tricks })
function drExtract(r, en) {
  const out = [];
  drFlat(r.h).forEach((pc, i) => {
    const x = en.res[i];
    if (!x || !(x.loss > 0)) return;
    const kind = drKindOf(r, pc, i); if (!kind) return;
    out.push({ k: r.id + '#' + i, rec: r.id, i, kind, card: pc.card, loss: x.loss, best: (x.best || []).slice(), date: r.date, box: 0, due: 0, tries: 0, right: 0 });
  });
  return out;
}
// the position just before card i: the cards left in each hand, the trick so far, the legal cards, tricks won so far
function drPosition(h, i) {
  const flat = drFlat(h), pc = flat[i], played = new Set(flat.slice(0, i).map(x => x.card));
  const hands = {}; SEATS.forEach(s => { hands[s] = h.hands[s].filter(c => !played.has(c)); });
  const trick = flat.slice(i - pc.pos, i);
  const led = trick.length ? suitOf(trick[0].card) : null, hand = hands[pc.seat];
  const follow = led ? hand.filter(c => suitOf(c) === led) : [];
  const legal = follow.length ? follow : hand.slice();
  let decl = 0, def = 0;
  h.tricks.slice(0, pc.trick).forEach(tr => { if (tr.cards.length === 4) (sameSide(trickWinner(tr, h.contract.strain), h.contract.declarer) ? decl++ : def++); });
  return { pc, hands, trick, legal, decl, def, mover: pc.seat, leader: pc.leader, trickNo: pc.trick };
}
// grade an answer: right moves the problem up a box (learned at DR.LEARNED), wrong sends it back to box 0
function drGrade(it, right, now) {
  it.tries++;
  if (right) { it.right++; it.box = Math.min(DR.LEARNED, it.box + 1); it.due = now + (DR.GAP[it.box] || 0); }
  else { it.box = 0; it.due = now; } // due again at once (drNext shows another problem first when there is one)
  return it;
}
const drLearned = it => it.box >= DR.LEARNED;
// a bidding problem's loss is in IMPs, a card's in tricks: about 3 IMPs to the trick, so neither kind crowds out the other
const drWeight = it => it.kind === 'bid' ? it.loss / 3 : it.loss;
// what to practise next: problems due now, of the kind chosen; new and missed ones first, then the costliest, then newest
function drQueue(items, kind, now, anyway) {
  return items.filter(it => !drLearned(it) && (kind === 'all' || it.kind === kind) && (anyway || it.due <= now))
    .sort((a, b) => a.box - b.box || (b.due <= now) - (a.due <= now) || drWeight(b) - drWeight(a) || b.date - a.date || a.i - b.i);
}
// merge newly found problems into the saved list (keeping progress), newest boards kept when over the limit
function drMerge(items, found, max) {
  const have = new Set(items.map(it => it.k));
  const out = items.concat(found.filter(it => !have.has(it.k)));
  out.sort((a, b) => b.date - a.date || a.i - b.i);
  return out.slice(0, max);
}

// ---- Saved state ----
function drLoad() {
  const v = (typeof Local !== 'undefined' && Local.get(DR.KEY)) || {};
  const st = {};
  for (const k of ['n', 'good', 'streak', 'bestStreak']) st[k] = Number.isFinite(+(v.st || {})[k]) ? +v.st[k] : 0;
  return {
    v: DR.V, st,
    items: Array.isArray(v.items) ? v.items.filter(it => it && typeof it.k === 'string' && typeof it.rec === 'string' && Number.isInteger(it.i)) : [],
    scanned: v.scanned && typeof v.scanned === 'object' ? v.scanned : {},
    bscanned: v.bscanned && typeof v.bscanned === 'object' ? v.bscanned : {}, // boards whose calls were checked
  };
}
let drState = null;
const drS = () => drState || (drState = drLoad());
function drSave() {
  const s = drS();
  // forget boards no longer in History
  if (typeof Stats !== 'undefined' && Stats.list.length) {
    const ids = new Set(Stats.list.map(r => r.id));
    s.items = s.items.filter(it => ids.has(it.rec));
    for (const id of Object.keys(s.scanned)) if (!ids.has(id)) delete s.scanned[id];
    for (const id of Object.keys(s.bscanned)) if (!ids.has(id)) delete s.bscanned[id];
  }
  Local.set(DR.KEY, s);
}
const drRec = id => typeof Stats !== 'undefined' ? Stats.list.find(r => r.id === id) : null;
const drNeedsCheck = r => (r.role === 'declarer' || r.role === 'defender') && r.h && r.h.contract && r.h.tricks && r.h.tricks.length > 0;

// ---- Finding the mistakes: the play review of one board at a time, newest first ----
function drToScan() {
  const s = drS(), out = [];
  const list = Stats.list;
  for (let i = list.length - 1; i >= 0 && list.length - i <= DR.SCAN; i--) { const r = list[i]; if (drNeedsCheck(r) && s.scanned[r.id] !== DR.V) out.push(r); }
  return out;
}
function drStep() {
  if (!DR.on || document.hidden || typeof playReview !== 'function') return;
  const s = drS();
  let changed = false;
  if (DR.scanRec) {
    const r = DR.scanRec, en = playReview(r.h);
    if (!en) { DR.noSolver = true; DR.scanRec = null; drRenderProgress(); return; }
    if (!en.done) return;
    s.items = drMerge(s.items, drExtract(r, en), DR.MAX);
    s.scanned[r.id] = DR.V; DR.scanRec = null; DR.done++; changed = true;
    // the leak finder wants the same review: store it in the record while we have it
    if (typeof Leaks !== 'undefined' && Leaks.absorb && Leaks.absorb(r)) Stats.put(r);
  }
  if (!DR.scanRec) {
    const next = drToScan()[0];
    if (next) { DR.scanRec = next; if (!playReview(next.h)) { DR.noSolver = true; DR.scanRec = null; } }
  }
  if (drBidStep()) changed = true;
  if (changed) { drSave(); if (!DR.cur) drNext(!document.activeElement || document.activeElement === document.body || drEl('drills').contains(document.activeElement)); else drRenderProgress(); }
}

// ---- Solving a position for every legal card ----
function drWorker() {
  if (DR.w) return DR.w;
  const u = p => JSON.stringify(new URL('js/' + p, location.href).href);
  const src = `importScripts(${u('wasm/compiled.js')}, ${u('engine.js')}, ${u('ddplay.js')});
let mod = null, solve = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.wasm) { mod = mod || m.wasm; return; }
  try {
    if (!solve) { if (!mod) mod = await WebAssembly.compile(await (await fetch(${u('wasm/compiled.wasm')})).arrayBuffer()); solve = ddSolver(create_dds_module, mod); }
    self.postMessage({ k: m.k, r: await solve(m.job) });
  } catch (err) { self.postMessage({ k: m.k, error: String(err && err.message || err) }); }
};`;
  DR.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = DR.w = new Worker(DR.url);
  if (typeof ddGiveWasm === 'function') ddGiveWasm(w);
  w.onmessage = e => { const f = DR.wait.get(e.data.k); if (f) { DR.wait.delete(e.data.k); f(e.data); } drIdle(); };
  w.onerror = () => { const fs = [...DR.wait.values()]; DR.wait.clear(); drDropWorker(); for (const f of fs) f({ error: 'worker failed' }); };
  return w;
}
// the worker and its blob URL go when the screen closes, or after a while with nothing to solve (frees the solver's memory)
function drDropWorker() {
  clearTimeout(DR.idle); DR.idle = 0;
  if (DR.w) { try { DR.w.terminate(); } catch (e) { } DR.w = null; }
  if (DR.url) { try { URL.revokeObjectURL(DR.url); } catch (e) { } DR.url = null; }
}
function drIdle() {
  clearTimeout(DR.idle);
  DR.idle = setTimeout(() => { DR.idle = 0; if (!DR.wait.size) drDropWorker(); }, typeof DD_IDLE_MS === 'number' ? DD_IDLE_MS : 30e3);
}
function drSolve(h, pos) {
  return new Promise(res => {
    let w; try { w = drWorker(); } catch (e) { res(null); return; }
    const k = ++DR.n;
    clearTimeout(DR.idle); DR.idle = 0;
    const t = setTimeout(() => { DR.wait.delete(k); res(null); }, 20000);
    DR.wait.set(k, m => { clearTimeout(t); res(m.error ? null : m.r); });
    w.postMessage({ k, job: { trump: DD_TRUMP[h.contract.strain], first: SEATS.indexOf(pos.leader), trick: pos.trick.map(x => x.card), pbn: ddPBN(pos.hands), hands: pos.hands, mover: pos.mover } });
  });
}

// ---- The screen ----
const drEl = id => document.getElementById(id);
function drBuild() {
  if (drEl('drills')) return;
  const s = document.createElement('section');
  s.id = 'drills'; s.className = 'hidden';
  s.innerHTML = `<div class="topbar"><span class="tt">Your mistakes</span><span class="code" id="drScore"></span>
    <select id="drKind" aria-label="Which mistakes">${DR.KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <button class="btn small" id="drLeave">Leave</button></div>
    <div class="bp-wrap"><div class="bp-main"><div id="drInfo"></div><div id="drTable"></div><div id="drResult"></div><p class="note" id="drProg"></p></div>
    <div class="bp-side" id="drAuction"></div></div>`;
  (drEl('leadTrainer') || drEl('tableView')).after(s);
  s.addEventListener('click', drClick);
  drEl('drKind').addEventListener('change', e => { DR.kind = e.target.value; try { localStorage.setItem('bridge-dr-kind', DR.kind); } catch (er) { } DR.anyway = false; if (!DR.pick) drNext(); else drRenderProgress(); });
}
function startDrills() {
  if (typeof T !== 'undefined' && T) { if (T.local) flushPractice(); goHome(); }
  if (typeof BP !== 'undefined' && BP.on) leaveBidPractice();
  if (typeof LT !== 'undefined' && LT.on) leaveLeadTrainer(false);
  drBuild();
  try { DR.kind = localStorage.getItem('bridge-dr-kind') || 'all'; } catch (e) { }
  DR.on = true; DR.cur = null; DR.pick = null; DR.anyway = false; DR.done = 0;
  if (typeof leaveModals === 'function') leaveModals();
  drEl('home').classList.add('hidden'); drEl('tableView').classList.add('hidden'); drEl('drills').classList.remove('hidden');
  drEl('drKind').value = DR.kind;
  clearInterval(lobbyTimer);
  drEl('drInfo').innerHTML = '<p class="note">Loading your boards…</p>';
  Stats.open().then(() => {
    if (!DR.on) return;
    drState = drLoad(); drSave();
    drNext(true);
    clearInterval(DR.timer); DR.timer = setInterval(() => { try { drStep(); } catch (e) { console.error(e); } }, 300);
    drStep();
  });
}
function leaveDrills(toHome = true) {
  DR.on = false; DR.cur = null; DR.pick = null; DR.scanRec = null;
  clearInterval(DR.timer); DR.timer = 0;
  drDropWorker(); DR.wait.clear();
  const s = drEl('drills'); if (s) s.classList.add('hidden');
  if (!toHome) return;
  drEl('home').classList.remove('hidden');
  { const b = drEl('drillsBtn'); if (b) b.focus({ preventScroll: true }); }
  if (typeof loadLobby === 'function') { loadLobby(); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000); }
}

function drNext(focus) {
  const s = drS(), now = Date.now();
  DR.pick = null; DR.sol = null; DR.solErr = false; DR.level = null; DR.bres = null;
  let q = drQueue(s.items, DR.kind, now, DR.anyway).filter(it => drRec(it.rec));
  if (q.length > 1 && DR.cur) q = q.filter(it => it.k !== DR.cur.k).concat(q.filter(it => it.k === DR.cur.k)); // not the same one twice running
  DR.cur = q[0] || null;
  drRender();
  if (focus) drFocus();
  if (DR.cur && DR.cur.kind !== 'bid') {
    const it = DR.cur, r = drRec(it.rec), pos = drPosition(r.h, it.i);
    drSolve(r.h, pos).then(sol => { if (DR.cur !== it) return; DR.sol = sol; DR.solErr = !sol; if (DR.pick) drRender(); });
  }
}

const drCount = () => {
  const s = drS(), now = Date.now(), mine = s.items.filter(it => DR.kind === 'all' || it.kind === DR.kind);
  return { left: mine.filter(it => !drLearned(it)).length, due: mine.filter(it => !drLearned(it) && it.due <= now).length, learned: mine.filter(drLearned).length, total: mine.length };
};
function drRenderScore() {
  const st = drS().st, el = drEl('drScore'); if (!el) return;
  el.textContent = st.n ? `Streak ${st.streak} · right ${st.good} of ${st.n} (${Math.round(100 * st.good / st.n)}%)` : '';
}
function drRenderProgress() {
  const el = drEl('drProg'); if (!el) return;
  const c = drCount(), left = typeof Stats !== 'undefined' && DR.on ? drToScan().length : 0;
  const parts = [];
  if (c.total) parts.push(`${c.due} to practise now${c.left > c.due ? `, ${c.left - c.due} later` : ''} · ${c.learned} learned`);
  if (DR.noSolver) parts.push('The double-dummy solver isn\'t available in this browser, so no more boards can be checked.');
  else if (left) parts.push(`Checking ${left} more board${left === 1 ? '' : 's'} from History…`);
  else if (DR.on && !DD.failed && drBidToScan().length) parts.push('Checking the bidding of your boards…');
  el.textContent = parts.join(' · ');
  if (!DR.cur && !DR.pick) drRender(true);
}
const drKindText = { decl: 'Declarer play', def: 'Defence', lead: 'Opening lead', bid: 'Bidding' };
function drRender(quiet) {
  drRenderScore();
  const info = drEl('drInfo'), tab = drEl('drTable'), box = drEl('drResult'), auc = drEl('drAuction');
  if (!info) return;
  const it = DR.cur;
  if (!it) {
    const c = drCount(), left = (DR.noSolver ? 0 : drToScan().length) + (DD.failed ? 0 : drBidToScan().length);
    const any = drS().items.length;
    let msg;
    if (c.left && !c.due) msg = `<p><b>All caught up.</b> ${c.left} problem${c.left === 1 ? '' : 's'} come${c.left === 1 ? 's' : ''} back in the next few days.</p><div class="row"><button class="btn primary" data-drany="1">Practise them now</button></div>`;
    else if (c.total && !c.left) msg = `<p><b>All ${c.learned} learned.</b> Play more boards and new mistakes will turn up here.</p>`;
    else if (left) msg = '<p class="note">Looking for mistakes in your boards…</p>';
    else if (any) msg = '<p class="note">No mistakes of this kind in your boards.</p>';
    else msg = `<p>No mistakes found yet.</p><p class="note">Play some boards. Each card that cost your side a trick double dummy becomes a problem here: the position before that card, to try again. So does each call that cost IMPs against what the robots would have bid.</p>`;
    info.innerHTML = msg; tab.innerHTML = ''; box.innerHTML = ''; auc.innerHTML = '';
    if (!quiet) drRenderProgress();
    return;
  }
  if (it.kind === 'bid') { drBidRender(it, quiet); return; }
  const r = drRec(it.rec), h = r.h, pos = drPosition(h, it.i), c = h.contract;
  const you = r.seat, dummy = partnerOf(c.declarer), mover = pos.mover;
  const youLbl = s => s === you ? 'You' : s === dummy ? 'Dummy' : s === c.declarer ? 'Declarer' : '';
  const role = r.role === 'declarer' ? (mover === you ? 'You declare' : `You declare; play from dummy (${SEAT_NAME[mover]})`) : (it.kind === 'lead' ? 'You are on lead' : 'You defend');
  const d = new Date(r.date);
  info.innerHTML = `<p class="dr-head"><b>${drKindText[it.kind]}</b> · board ${esc(h.board)}, ${esc(d.toLocaleDateString())}${r.mode !== 'practice' ? ` (${esc(r.mode)})` : ''}<br>
    ${contractHTML(c)}, ${vulText(h.vul)}. Trick ${pos.trickNo + 1}: declarer ${pos.decl}, defence ${pos.def}.<br>
    ${role}. ${DR.pick ? '' : '<b>Find the best card.</b>'}</p>`;
  // the hands you could see then: yours, and dummy's once the lead is made; with the answer, all four
  const seen = s => DR.pick || s === you || s === mover || (s === dummy && (it.i > 0 || r.role === 'declarer'));
  const legal = DR.pick ? [] : pos.legal;
  const hand = s => {
    const lbl = `<div class="lbl">${SEAT_NAME[s]}${youLbl(s) ? ' · ' + youLbl(s) : ''}</div>`;
    if (!seen(s)) return `<div class="dr-hid">${lbl}<div class="note">${pos.hands[s].length} cards</div></div>`;
    return `<div class="${s === mover ? 'dr-mover' : ''}">${lbl}${rowsHTML(pos.hands[s], s === mover ? legal : [], s)}</div>`;
  };
  const trickCards = pos.trick.concat(DR.pick ? [{ seat: mover, card: DR.pick }] : []);
  const centre = trickCards.length ? `<div class="tr cmp">${trickCards.map(x => `<div class="at-${x.seat}" title="${SEAT_NAME[x.seat]}">${cardHTML(x.card, x.card === DR.pick ? 'dr-you' : '', 'tabindex="-1"')}</div>`).join('')}</div>`
    : `<div class="tr"><span class="lbl">${SEAT_NAME[mover]} to lead</span></div>`;
  tab.innerHTML = `<div class="replay dr-table"><div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}${centre}${hand('E')}<div></div>${hand('S')}<div></div></div></div>`;
  const view = { seats: Object.fromEntries(SEATS.map(s => [s, { kind: 'robot' }])), auction: h.auction, phase: 'done' };
  auc.innerHTML = `<div class="dr-auc">${auctionGridHTML(view, h.auction.slice(), h.dealer, h.vul, you)}</div>${drPlayedHTML(h, it.i)}`;
  box.innerHTML = DR.pick ? drResultHTML(it, r, pos) : '';
  if (!quiet) drRenderProgress();
}
// the tricks before this one, compact: leader's card first, the winner bold
function drPlayedHTML(h, i) {
  const flat = drFlat(h), k = flat[i].trick;
  if (!k) return '';
  const rows = h.tricks.slice(0, k).map((tr, n) => {
    const w = trickWinner(tr, h.contract.strain);
    return `<li><span class="note">${n + 1}.</span> ${tr.cards.map(pc => `<span class="${pc.seat === w ? 'dr-win' : ''}" title="${SEAT_NAME[pc.seat]}">${pc.seat}&nbsp;${cardText(pc.card)}</span>`).join(' ')}</li>`;
  }).join('');
  return `<details class="dr-tricks"><summary>Tricks so far</summary><ol>${rows}</ol></details>`;
}
// the tricks each card takes for your side (the whole board), best first, equal cards together
function drCardsHTML(sol, pos, base) {
  const by = new Map();
  for (const c of pos.legal) if (c in sol) { const t = base + sol[c]; if (!by.has(t)) by.set(t, []); by.get(t).push(c); }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([t, cs]) => `<tr><td class="num">${t}</td><td>${sortForHand(cs).map(c => `<span class="${c === DR.pick ? 'dr-youc' : ''}">${cardText(c)}</span>`).join(' ')}</td></tr>`).join('');
}
function drResultHTML(it, r, pos) {
  const h = r.h, decl = sameSide(pos.mover, h.contract.declarer), base = decl ? pos.decl : pos.def;
  const side = decl ? 'your side' : 'the defence';
  const btns = `<div class="row"><button class="btn primary" data-drnext="1">Next</button>${typeof PlayFrom !== 'undefined' ? '<button class="btn" data-drplay="1">Play on from here</button>' : ''}<button class="btn" data-drrec="1">Hand record</button></div>`;
  const sol = DR.sol;
  const atTable = `At the table you played ${cardText(it.card)}${it.card === DR.pick ? ' too' : ''}, which cost ${it.loss} trick${it.loss > 1 ? 's' : ''}.`;
  if (!sol) {
    if (!DR.solErr) return '<p class="note">Solving the position…</p>';
    const right = it.best.includes(DR.pick);
    return `<div class="bp-res"><p>${right ? '<b>Right.</b>' : '<b>Not the best card.</b>'} Best: ${it.best.map(cardText).join(', ')}. ${atTable}</p><p class="note">The solver isn't available, so the other cards aren't rated.</p>${btns}</div>`;
  }
  const best = Math.max(...pos.legal.filter(c => c in sol).map(c => sol[c]));
  const mine = sol[DR.pick], bestCards = pos.legal.filter(c => sol[c] === best);
  const right = mine === best, cost = best - mine;
  const head = right
    ? `<p class="dr-ok"><b>Right.</b> ${cardText(DR.pick)} takes ${base + best} tricks for ${side}, the most there are.</p>`
    : `<p class="dr-bad"><b>${cardText(DR.pick)} costs ${cost} trick${cost > 1 ? 's' : ''}.</b> It takes ${base + mine} tricks for ${side}; ${bestCards.length === 1 ? `${cardText(bestCards[0])} takes` : bestCards.length <= 4 ? `${sortForHand(bestCards).map(cardText).join(' ')} take` : 'the best cards take'} ${base + best}.</p>`;
  return `<div class="bp-res">${head}<p>${atTable}</p>
    <table class="bp-cmp dr-cards"><tr><th class="num">Tricks</th><th>Cards</th></tr>${drCardsHTML(sol, pos, base)}</table>
    <p class="note">Tricks for ${side} in the whole board, double dummy (every hand known), after each card. ${right ? `Learned after ${DR.LEARNED} right in a row.` : 'This problem comes back.'}</p>${btns}</div>`;
}

function drChoose(card) {
  const it = DR.cur; if (!it || DR.pick) return;
  const r = drRec(it.rec), pos = drPosition(r.h, it.i);
  if (!pos.legal.includes(card)) return;
  DR.pick = card;
  const grade = () => {
    const right = DR.sol ? DR.sol[card] === Math.max(...pos.legal.filter(c => c in DR.sol).map(c => DR.sol[c])) : it.best.includes(card);
    const s = drS(), live = s.items.find(x => x.k === it.k) || it;
    drGrade(live, right, Date.now());
    s.st.n++; if (right) { s.st.good++; s.st.streak++; s.st.bestStreak = Math.max(s.st.bestStreak, s.st.streak); } else s.st.streak = 0;
    drSave();
  };
  if (DR.sol || DR.solErr) { grade(); drRender(); drFocus(); return; }
  drRender();
  const wait = setInterval(() => { // the solve is still running (it started when the problem was shown)
    if (DR.cur !== it || !DR.on) { clearInterval(wait); return; }
    if (DR.sol || DR.solErr) { clearInterval(wait); grade(); drRender(); drFocus(); }
  }, 50);
}
function drFocus() {
  const sc = drEl('drills'); if (!sc || !DR.on) return;
  const b = sc.querySelector(DR.pick ? '[data-drnext]' : DR.cur ? (DR.cur.kind === 'bid' ? '#drTable .bbox button:not(:disabled)' : '#drTable .rk.play') : '#drInfo button') || sc.querySelector('#drKind');
  if (b) b.focus({ preventScroll: true });
}
function drPlayOn() {
  const it = DR.cur, r = it && drRec(it.rec); if (!r) return;
  leaveDrills(false);
  PlayFrom.start(r.h, it.i, { kind: 'hist', id: r.id, seat: r.seat });
}
function drClick(e) {
  const b = e.target.closest('button, [data-alert]'); if (!b) return;
  const d = b.dataset;
  if (b.id === 'drLeave') leaveDrills();
  else if (d.play) drChoose(d.play);
  else if (d.drlevel) { DR.level = +d.drlevel; drBidBox(); const f = drEl('drTable').querySelector('.bbox .st button:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }
  else if (d.drcall) drBidChoose(d.drcall);
  else if (d.drnext) drNext(true);
  else if (d.drany) { DR.anyway = true; drNext(true); }
  else if (d.drplay) drPlayOn();
  else if (d.drrec) { const it = DR.cur; if (it) Stats.record(it.rec); }
  else if (d.alert) { if (drEl('explainPop')) hideExplain(); else showExplain(b, d.alert); }
  else return;
  e.stopPropagation();
}

// ---- Bidding problems: your calls that cost IMPs against what the robots would have bid ----
// For each call you made on a History board, the robots' system (js/bidding.js botCall, read-only) is asked what it
// would have bid in your seat with the auction as it went. Where its call differs, the robots bid on from there for all
// four hands, once after its call and once after yours, and each contract is scored double dummy (the board's DD
// table). The call becomes a problem when the robots' call does better both ways: against the contract you really
// reached, and with the robots bidding on after your call (so a partner's later slip isn't pinned on you). The loss is
// in IMPs against the contract reached at the table. The DD table is kept with the problem (20 hex digits).
const DR_DDS = ['N', 'E', 'S', 'W'], DR_DDST = ['N', 'S', 'H', 'D', 'C'];
const drDDPack = t => DR_DDS.map(d => DR_DDST.map(st => (t[d][st] | 0).toString(16)).join('')).join('');
const drDDUnpack = p => { const t = {}; DR_DDS.forEach((d, i) => { t[d] = {}; DR_DDST.forEach((st, j) => { t[d][st] = parseInt(p[i * 5 + j], 16); }); }); return t; };
const drDDScore = (c, dd, vul) => c ? scoreNS(c, dd[c.declarer][c.strain], vul) : 0;
const drSign = seat => seat === 'N' || seat === 'S' ? 1 : -1;
const drBidNeedsCheck = r => !!(r && r.h && Array.isArray(r.h.auction) && r.h.hands && r.h.hands[r.seat] && r.h.hands[r.seat].length === 13
  && auctionOver(r.h.auction) && r.h.auction.some(a => a.by === r.seat));
// the auction bid on by the robots for all four hands
function drRobotsOn(h, auction) {
  const au = auction.slice();
  while (!auctionOver(au) && au.length < 80) {
    const by = auctionTurn(h.dealer, au), r = botCall(h.hands[by], by, h.dealer, au, h.vul);
    au.push(r.alert ? { call: r.call, by, alert: r.alert } : { call: r.call, by });
  }
  return au;
}
// `call` in place of auction[i], the robots bidding on: { auction, contract, ns } (N-S score double dummy)
function drBidJudge(h, i, call, dd, alert) {
  const by = h.auction[i].by, au = drRobotsOn(h, h.auction.slice(0, i).concat([alert ? { call, by, alert } : { call, by }]));
  const c = finalContract(au);
  return { auction: au, contract: c, ns: drDDScore(c, dd, h.vul) };
}
// the bidding problems on a board, given its double-dummy table
function drBidExtract(r, dd) {
  const h = r.h, out = [], sg = drSign(r.seat);
  if (!drBidNeedsCheck(r)) return out;
  const table = drDDScore(finalContract(h.auction), dd, h.vul);
  h.auction.forEach((a, i) => {
    if (a.by !== r.seat) return;
    const rb = botCall(h.hands[r.seat], r.seat, h.dealer, h.auction.slice(0, i), h.vul);
    if (rb.call === a.call) return;
    const rob = drBidJudge(h, i, rb.call, dd, rb.alert);
    const loss = toImps(sg * (rob.ns - table)); if (loss <= 0) return;
    if (toImps(sg * (rob.ns - drBidJudge(h, i, a.call, dd).ns)) <= 0) return;
    out.push({ k: r.id + '#b' + i, rec: r.id, i, kind: 'bid', card: a.call, rcall: rb.call, loss, dd: drDDPack(dd), date: r.date, box: 0, due: 0, tries: 0, right: 0 });
  });
  return out;
}
function drBidToScan() {
  if (typeof Stats === 'undefined') return [];
  const s = drS(), list = Stats.list, out = [];
  for (let i = list.length - 1; i >= 0 && list.length - i <= DR.SCAN; i--) { const r = list[i]; if (s.bscanned[r.id] !== DR.BV && drBidNeedsCheck(r)) out.push(r); }
  return out;
}
// check the boards whose DD table is in (a few each step), and ask for the next tables; true when something changed
function drBidStep() {
  if (typeof requestDD !== 'function' || typeof botCall !== 'function' || DD.failed) return false;
  const s = drS(), t0 = Date.now();
  let changed = false, asked = 0;
  for (const r of drBidToScan()) {
    const en = ddEntry(r.h.hands);
    if (en && en.done) {
      s.items = drMerge(s.items, drBidExtract(r, en.table), DR.MAX); s.bscanned[r.id] = DR.BV; changed = true;
      if (Date.now() - t0 > 40) break; // keep the screen responsive
    } else if (asked++ < 2) requestDD(r.h.hands, false); else break;
  }
  return changed;
}

// the problem: your hand, the auction so far (every call explained by the system), the bidding box
function drBidRender(it, quiet) {
  const info = drEl('drInfo'), tab = drEl('drTable'), box = drEl('drResult'), auc = drEl('drAuction');
  const r = drRec(it.rec), h = r.h, you = r.seat, before = h.auction.slice(0, it.i), d = new Date(r.date);
  info.innerHTML = `<p class="dr-head"><b>Bidding</b> · board ${esc(h.board)}, ${esc(d.toLocaleDateString())}${r.mode !== 'practice' ? ` (${esc(r.mode)})` : ''}<br>
    Dealer ${SEAT_NAME[h.dealer]}, ${vulText(h.vul)}. You are ${SEAT_NAME[you]}.${DR.pick ? '' : ' <b>What do you bid?</b>'}</p>`;
  tab.innerHTML = DR.pick ? '' : `<div class="bp-hand">${bpHandHTML(h.hands[you])}</div><div class="dr-bbox"></div>`;
  if (!DR.pick) drBidBox();
  const view = { seats: Object.fromEntries(SEATS.map(s => [s, { kind: 'robot' }])), auction: before, phase: DR.pick ? 'done' : 'auction' };
  auc.innerHTML = `<div class="dr-auc">${auctionGridHTML(view, before, h.dealer, h.vul, you)}</div><p class="note">Tap a call for what it means.</p>`;
  box.innerHTML = DR.pick ? drBidResultHTML(it, r) : '';
  drRenderScore();
  if (!quiet) drRenderProgress();
}
function drBidBox() {
  const it = DR.cur, el = drEl('drTable') && drEl('drTable').querySelector('.dr-bbox'); if (!it || !el) return;
  const h = drRec(it.rec).h, legal = legalCalls(h.dealer, h.auction.slice(0, it.i)), lv = DR.level;
  const minLevel = [1, 2, 3, 4, 5, 6, 7].find(l => STRAINS.some(s => legal.includes(l + s)));
  el.innerHTML = `<div class="bbox"><div class="lv">${[1, 2, 3, 4, 5, 6, 7].map(l => `<button class="bcard ${lv === l ? 'sel' : ''}" data-drlevel="${l}" ${!minLevel || l < minLevel ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <div class="st">${STRAINS.map(s => `<button class="bcard ${isRed(s) ? 'red' : ''} s-${s}" data-drcall="${lv ? lv + s : ''}" aria-label="${lv ? lv + ' ' : ''}${STRAIN_WORD[s]}" ${lv && legal.includes(lv + s) ? '' : 'disabled'}>${SYM[s]}</button>`).join('')}</div>
    <div class="sp"><button class="bcard pass" data-drcall="P">Pass</button><button class="bcard dbl" data-drcall="X" aria-label="Double" ${legal.includes('X') ? '' : 'disabled'}>X</button><button class="bcard rdbl" data-drcall="XX" aria-label="Redouble" ${legal.includes('XX') ? '' : 'disabled'}>XX</button></div></div>`;
}
// what the robots' system says a call in your seat means
function drMeans(h, i, call, alert) {
  const by = h.auction[i].by;
  return describeCall(h.auction.slice(0, i).concat([alert ? { call, by, alert } : { call, by }]), i, h.vul) || (call === 'P' ? 'No more to say' : '');
}
function drBidChoose(call) {
  const it = DR.cur; if (!it || it.kind !== 'bid' || DR.pick) return;
  const r = drRec(it.rec), h = r.h, i = it.i;
  if (!legalCalls(h.dealer, h.auction.slice(0, i)).includes(call)) return;
  const dd = drDDUnpack(it.dd), rb = botCall(h.hands[r.seat], r.seat, h.dealer, h.auction.slice(0, i), h.vul);
  const ralert = rb.call === it.rcall ? rb.alert : undefined;
  const rob = drBidJudge(h, i, it.rcall, dd, ralert), mine = call === it.rcall ? rob : drBidJudge(h, i, call, dd);
  const diff = toImps(drSign(r.seat) * (rob.ns - mine.ns)); // IMPs your call loses against the robots' (0 when as good)
  const right = call === it.rcall || diff <= 0;
  DR.pick = call; DR.level = null; DR.bres = { rob, mine, ralert, diff, right, dd };
  const s = drS(), live = s.items.find(x => x.k === it.k) || it;
  drGrade(live, right, Date.now());
  s.st.n++; if (right) { s.st.good++; s.st.streak++; s.st.bestStreak = Math.max(s.st.bestStreak, s.st.streak); } else s.st.streak = 0;
  drSave();
  drRender(); drFocus();
}
function drBidResultHTML(it, r) {
  const h = r.h, b = DR.bres, sg = drSign(r.seat), pick = DR.pick, dd = b.dd, i = it.i;
  const C = cl => typeof bpCallHTML === 'function' ? bpCallHTML(cl) : callText(cl);
  const imps = v => `${v} IMP${v === 1 ? '' : 's'}`, sc = v => (v > 0 ? '+' : '') + v;
  const res = (c) => c ? `${contractHTML(c, true)} ${resultText(c, dd[c.declarer][c.strain])}` : 'Passed out';
  const tableC = finalContract(h.auction), tableNS = drDDScore(tableC, dd, h.vul);
  const head = b.right
    ? `<p class="dr-ok"><b>Right.</b> ${pick === it.rcall ? `The robots bid ${C(it.rcall)} too.` : `The robots bid ${C(it.rcall)}; with yours they reach a contract as good.`}</p>`
    : `<p class="dr-bad"><b>The robots bid ${C(it.rcall)}.</b> After your ${C(pick)} they bid on to ${res(b.mine.contract)}, ${imps(b.diff)} worse double dummy.</p>`;
  const row = (who, cl, means, c, ns, cls) => `<tr class="${cls || ''}"><td>${who}</td><td>${C(cl)}</td><td class="note">${redSym(esc(means || ''))}</td><td>${res(c)}</td><td class="num">${sc(sg * ns)}</td></tr>`;
  const rows = [row('Robots', it.rcall, drMeans(h, i, it.rcall, b.ralert), b.rob.contract, b.rob.ns, 'bp-diff')];
  const same = (x, y) => (x && x.level) === (y && y.level) && (x && x.strain) === (y && y.strain) && (x && x.declarer) === (y && y.declarer) && (x && x.doubled) === (y && y.doubled);
  if (pick !== it.rcall && !(pick === it.card && same(b.mine.contract, tableC))) rows.push(row('You now', pick, drMeans(h, i, pick), b.mine.contract, b.mine.ns));
  rows.push(row('At the table', it.card, drMeans(h, i, it.card), tableC, tableNS));
  const par = typeof parScore === 'function' ? parScore(dd, h.vul) : null, o = h.other;
  const hand = s => `<div><div class="lbl">${SEAT_NAME[s]}${s === r.seat ? ' · You' : ''}</div>${rowsHTML(h.hands[s], [], s)}</div>`;
  const grid = (au, label) => { const v = { seats: Object.fromEntries(SEATS.map(s => [s, { kind: 'robot' }])), auction: [], phase: 'done' }; return `<details class="dr-tricks"><summary>${label}</summary><div class="dr-auc">${auctionGridHTML(v, au.slice(), h.dealer, h.vul, r.seat)}</div></details>`; };
  return `<div class="bp-res">${head}
    <p>At the table you bid ${C(it.card)}, and the board cost ${imps(it.loss)} against the robots' call.</p>
    <table class="bp-cmp dr-bcmp"><tr><th></th><th>Call</th><th>Means</th><th>Contract</th><th class="num">You</th></tr>${rows.join('')}</table>
    <p class="note">Robots${rows.length > 2 ? ' and You now' : ''}: the robots bid on from there for all four hands. Contracts are played double dummy (every hand known); the score is your side's.${par ? ` Par: ${redSym(esc(par.text.replace(/(by \w+)([=+-])/, '$1 $2')))}, N-S ${sc(par.scoreNS)}.` : ''}${o ? ` Robot table: ${o.contract ? contractHTML(o.contract, true) + ' ' + resultText(o.contract, o.declTricks) : 'passed out'}.` : ''}</p>
    ${grid(b.rob.auction, 'The robots\' auction')}${pick !== it.rcall ? grid(b.mine.auction, 'The robots\' auction after your call') : ''}${grid(h.auction, 'The auction at the table')}
    <div class="replay dr-table"><div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}<div class="tr"><span class="lbl">${contractHTML(tableC, true)}</span></div>${hand('E')}<div></div>${hand('S')}<div></div></div></div>
    <p class="note">${b.right ? `Learned after ${DR.LEARNED} right in a row.` : 'This problem comes back.'}</p>
    <div class="row"><button class="btn primary" data-drnext="1">Next</button><button class="btn" data-drrec="1">Hand record</button></div></div>`;
}

// ---- Hooks: buttons on the home page and in the table's More menu, N for the next problem ----
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => {
    if (!DR.on || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName || '') || drEl('modalRoot').firstChild || drEl('explainPop')) return;
    if (e.key === 'Escape') { e.preventDefault(); leaveDrills(); }
    else if (DR.pick && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); drNext(true); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-drills]'); if (!b) return;
    // "Practise these" in History's "Where the IMPs went" opens one kind
    if (b.dataset.drkind) try { localStorage.setItem('bridge-dr-kind', b.dataset.drkind); } catch (er) { }
    startDrills();
  });
  const addBtns = () => {
    const home = drEl('leadTrainerBtn');
    if (home && !drEl('drillsBtn')) home.insertAdjacentHTML('afterend', '<button class="btn" id="drillsBtn" data-drills="1">Your mistakes</button>');
    const more = drEl('ltMoreBtn');
    if (more && !drEl('drMoreBtn')) {
      // at practice tables only, like Lead practice (leaving an online table would empty your seat): mirror its button
      more.insertAdjacentHTML('afterend', `<button class="btn small${more.classList.contains('hidden') ? ' hidden' : ''}" id="drMoreBtn" data-drills="1">Your mistakes</button>`);
      if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { const b = drEl('drMoreBtn'); if (b) b.classList.toggle('hidden', more.classList.contains('hidden')); }).observe(more, { attributes: true, attributeFilter: ['class'] });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBtns); else addBtns();
}
if (typeof module !== 'undefined') module.exports = { drFlat, drKindOf, drExtract, drPosition, drGrade, drQueue, drMerge, drLearned, drWeight, drBidExtract, drBidJudge, drRobotsOn, drDDPack, drDDUnpack, drBidNeedsCheck, DR };
