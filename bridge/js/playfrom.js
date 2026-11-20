// ======================= Play from here; Just declare / Just defend (feature: playfrom) =======================
// 1. "Play from here": in a hand record's card-by-card replay (and next to each costly card in the play review),
//    a button opens a practice table at that point: the same hands, dealer, vulnerability and auction, with the
//    cards so far already played (applied straight through the table actions, so the robots stay quiet), and you
//    play on against the robots. You take declarer's seat when your side declared, else your own seat; the board
//    is turned so that seat is South (a quarter turn swaps the vulnerability with the seats, so nothing changes).
//    The table is marked t.whatIf: it is never saved over your practice, and History/stats, daily posting, Skip
//    and Next board leave it alone. "Back to the hand record" returns to the table and record you came from.
// 2. "Just declare" / "Just defend" (Options, "Who bids in practice"): the robots bid all four hands, yours too,
//    and you only play. Deals (with the chosen deal type) are tried until the robots' contract is declared by the
//    side you want; if none turns up in time the board is turned round so it is. Scored as usual.
// Loaded before app.js; uses its globals (T, me, Prefs, act, openTable, showRecord, modal...) at run time.

const PF_TURN = (s, r) => SEATS[(SEATS.indexOf(s) + r) % 4]; // r quarter turns clockwise: N -> E -> S -> W
const pfVul = (v, r) => r % 2 && (v === 'NS' || v === 'EW') ? (v === 'NS' ? 'EW' : 'NS') : v;
// a board record (hands, dealer, vul, auction, contract, tricks) turned r quarter turns
function pfRotate(h, r) {
  const f = s => PF_TURN(s, r), hands = {};
  for (const s of SEATS) hands[s] = h.hands[PF_TURN(s, (4 - r % 4) % 4)].slice(); // in N E S W order
  return {
    ...h, hands, dealer: f(h.dealer), vul: pfVul(h.vul, r),
    auction: (h.auction || []).map(a => ({ ...a, by: f(a.by) })),
    contract: h.contract ? { ...h.contract, declarer: f(h.contract.declarer) } : null,
    tricks: (h.tricks || []).map(tr => ({ ...tr, leader: f(tr.leader), cards: tr.cards.map(pc => ({ ...pc, seat: f(pc.seat) })) })),
  };
}
const pfFlat = h => (h.tricks || []).flatMap(tr => tr.cards);
const pfTurnsTo = (from, to) => (SEATS.indexOf(to) - SEATS.indexOf(from) + 4) % 4;
// the seat you take: declarer's if your side declared (or you only watched), else your own
function pfSeat(h, seat) { const d = h.contract.declarer; return !seat || sameSide(seat, d) ? d : seat; }

// A practice table at card k of record h (k cards already played), for a player who sat `seat` (or null), or null
// if the record can't be replayed through the table actions.
function pfBuild(h, k, seat) {
  if (!h || !h.contract || !h.hands || SEATS.some(s => !h.hands[s] || h.hands[s].length !== 13 || h.hands[s].some(c => c[0] === '?'))) return null;
  const target = pfSeat(h, seat), r = pfTurnsTo(target, 'S'), g = pfRotate(h, r), flat = pfFlat(g);
  if (k < 0 || k > flat.length || k >= 52) return null;
  const t = newTable({ name: `What if, board ${h.board}`, local: true });
  t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: me.name || 'You' }, W: { kind: 'robot' } };
  t.board = h.board; t.dealer = g.dealer; t.vul = g.vul; t.hands = structuredClone(g.hands);
  t.auction = []; t.contract = null; t.play = { tricks: [] }; t.claim = null; t.replayOf = null;
  t.boardStart = Date.now(); t.lastActAt = Date.now(); t.timeUp = false; t.phase = 'auction';
  for (const a of g.auction) if (A.call(t, a.by, a.call, a.alert) === false) return null;
  if (t.phase !== 'play') return null;
  for (const pc of flat.slice(0, k)) if (A.card(t, pc.seat, pc.card) === false) return null;
  if (t.phase !== 'play') return null;
  const mine = h.declTricks != null ? (sideOf(target) === 'NS' ? h.scoreNS : -h.scoreNS) : null;
  t.whatIf = { board: h.board, k, turns: r, declTricks: h.declTricks, mine };
  t.chat = [];
  sysMsg(t, k ? `What if: board ${h.board} from trick ${Math.floor(k / 4) + 1}${k % 4 ? `, card ${k % 4 + 1}` : ''}` : `What if: board ${h.board} from the opening lead`);
  return t;
}

// ---------- the robots' auction for all four hands ----------
function pfAuction(hands, dealer, vul) {
  const au = [];
  while (!auctionOver(au) && au.length < 80) {
    const by = auctionTurn(dealer, au), r = botCall(hands[by], by, dealer, au, vul);
    au.push(r.alert ? { call: r.call, by, alert: r.alert } : { call: r.call, by });
  }
  return au;
}
// a deal of the chosen practice deal type (deals.js), quietly (no toast if the filter is slow)
function pfDeal(t) {
  const f = typeof DEAL_FILTERS !== 'undefined' && DEAL_FILTERS[Prefs.deals];
  if (!f) return deal();
  const end = Date.now() + 30;
  for (let n = 0; ; n++) {
    const h = deal(), i = {}; for (const s of SEATS) i[s] = dealInfo(h[s]);
    if (f(i, t.dealer) || ((n & 31) === 31 && Date.now() > end)) return h;
  }
}

const PlayFrom = {
  origins: {}, // what-if table id -> where "Back to the hand record" goes
  resume: null, // { key, k }: the replay to open at card k
  cur: null, // the record whose replay or play review is drawn
  recKey: h => h.hands.N.join('') + h.hands.E.join('') + '#' + pfFlat(h).map(pc => pc.card).join(''),

  // ----- buttons in the hand record -----
  // app.js startReplay: where its replay starts, and its button
  startStep(h) { const r = PlayFrom.resume; PlayFrom.cur = h; if (r && r.key === PlayFrom.recKey(h)) { PlayFrom.resume = null; return Math.min(r.k, pfFlat(h).length); } return 0; },
  replayButton(h, step) {
    PlayFrom.cur = h;
    return h.contract && step < 52 && step <= pfFlat(h).length ? `<button class="btn small" data-playfrom="${step}" title="Play on from here against the robots">Play from here</button>` : '';
  },
  // the play review's list of costly cards: play from just before card i
  tryButton(h, i) { PlayFrom.cur = h; return ` <button class="pftry" data-playfrom="${i}" title="Play on from just before this card against the robots">Play from here</button>`; },

  // where the open hand record came from, so that "Back" can show it again
  originOf(h) {
    const box = $('modalRoot').firstChild;
    const back = !T ? {} : T.local ? { table: T } : { code: T.id };
    if (box && box.dataset.hist) {
      const r = typeof Stats !== 'undefined' && Stats.list.find(x => x.id === box.dataset.hist);
      return { ...back, kind: 'hist', id: box.dataset.hist, seat: r ? r.seat : null };
    }
    if (T && openRecord !== null && T.history[openRecord] === h) {
      const seat = h.players ? SEATS.find(s => h.players[s] && h.players[s].id === me.id) || null : mySeat(T);
      return { ...back, kind: 'rec', board: h.board, seat };
    }
    return { ...back, kind: 'shared', h, seat: 'S' };
  },
  start(h, k, o) {
    if (!h) return;
    const t = pfBuild(h, k, o.seat);
    if (!t) { toast('This board can\'t be played on from here'); return; }
    o.key = PlayFrom.recKey(h); o.k = k;
    PlayFrom.origins[t.id] = o;
    selCard = null;
    openTable(t);
    if (t.whatIf.turns) toast(`Turned round: you play ${SEAT_NAME[pfSeat(h, o.seat)]}'s cards from South`);
  },
  back() {
    const o = T && T.whatIf && PlayFrom.origins[T.id];
    if (!o) { goHome(); return; }
    PlayFrom.resume = { key: o.key, k: o.k };
    const show = () => {
      if (o.kind === 'hist') { Stats.record(o.id); const b = $('replayBtn'); if (b) b.click(); return; }
      if (o.kind === 'shared') { showSharedDeal(o.h); return; }
      const i = T ? T.history.findIndex(x => x.board === o.board && x.hands && PlayFrom.recKey(x) === o.key) : -1;
      if (i >= 0) showRecord(i, true); else { PlayFrom.resume = null; toast('That board is no longer in this table\'s results'); }
    };
    if (o.code) { // an online table: reconnect, then open its record once its boards have arrived
      openOnline(o.code);
      const until = Date.now() + 12000;
      const wait = () => {
        if (T && T.id === o.code && Array.isArray(T.history) && (o.kind !== 'rec' || T.history.some(x => x.board === o.board))) { show(); return; }
        if (Date.now() < until && (!T || !T.local)) setTimeout(wait, 200);
      };
      wait();
    } else if (o.table) { openTable(o.table); show(); }
    else { goHome(); show(); }
  },
  click(e) {
    const b = e.target.closest && e.target.closest('[data-playfrom]');
    if (b) {
      const h = PlayFrom.cur, k = +b.dataset.playfrom;
      if (T && !T.local && mySeat(T) && (T.phase === 'auction' || T.phase === 'play')) { toast('Finish the board you are playing first'); return; }
      const o = PlayFrom.originOf(h); // before the record closes
      closeModal(); PlayFrom.start(h, k, o); return;
    }
    if (e.target.closest && e.target.closest('[data-whatifback]')) PlayFrom.back();
  },

  // ----- the what-if table -----
  render(t) {
    const b = $('whatIfBack'); if (b) b.classList.toggle('hidden', !(t && t.whatIf && PlayFrom.origins[t.id]));
    // Just declare/defend: before your first card, Undo would only reopen the robots' auction (which they bid again)
    if (t && t.just && t.just.board === t.board && t.phase === 'play' && !t.play.tricks.some(tr => tr.cards.some(pc => controllerOf(t, pc.seat) === mySeat(t)))) $('undoBtn').classList.add('hidden');
    // a what-if table: Undo never goes back past the starting position (into the auction, or the record's own cards)
    if (t && t.whatIf && t.phase === 'play' && mySeat(t)) {
      const p = { ...t, auction: t.auction.slice(), play: { tricks: t.play.tricks.slice() }, chat: [] };
      if (doUndo(p, mySeat(t)) !== false && (p.phase !== 'play' || pfFlat(p.play).length < t.whatIf.k)) { $('undoBtn').classList.add('hidden'); $('undoBtn').disabled = true; }
    }
  },
  // the end-of-board panel: the hand record's result to compare, Back and Again instead of Next board
  resultButtons(t, go) {
    const w = t.whatIf, h = t.history[t.history.length - 1];
    let cmp = '';
    if (w.mine != null && h) {
      const im = toImps(h.scoreNS - w.mine);
      cmp = `<p class="note" style="margin:4px 0 0">Hand record ${w.mine > 0 ? '+' : ''}${w.mine}: ${im ? `${im > 0 ? '+' : ''}${im} IMP${Math.abs(im) === 1 ? '' : 's'}` : 'no swing'}</p>`;
    }
    const back = PlayFrom.origins[t.id] ? '<button class="btn primary" data-whatifback="1">Back to the hand record</button>' : '';
    return `${cmp}<div class="row">${back}</div><div class="row"><button class="btn small" data-pfagain="1" title="Play on again from the same point">Play again</button></div>`;
  },
  again() {
    const t = T; if (!t || !t.whatIf || t.phase !== 'done') return;
    const h = t.history[t.history.length - 1]; // this table's own record: its first k cards are the start position
    const n = pfBuild({ ...h, declTricks: t.whatIf.declTricks }, t.whatIf.k, 'S');
    if (!n) return;
    n.whatIf.mine = t.whatIf.mine; n.whatIf.turns = t.whatIf.turns;
    if (PlayFrom.origins[t.id]) PlayFrom.origins[n.id] = PlayFrom.origins[t.id];
    openTable(n);
  },

  // ----- Just declare / Just defend -----
  justOn: () => Prefs.just === 'declare' || Prefs.just === 'defend',
  needJust: s => !!(s && s.local && !s.daily && !s.whatIf && !s.replayOf && PlayFrom.justOn() && s.phase === 'auction' && !s.auction.length && !(s.just && s.just.board === s.board)),
  // the robots bid every hand; deal again until the side you want declares (else turn the board so it does)
  justBid(s) {
    const mode = Prefs.just, want = d => mode === 'declare' ? sideOf(d) === 'NS' : sideOf(d) === 'EW';
    const end = Date.now() + 400;
    let pick = null, fallback = null;
    const tries = s.fixedDeal === s.board ? 1 : 40; // an imported deal (share.js) is played as dealt, at most turned round
    for (let n = 0; n < tries; n++) {
      if (n) s.hands = pfDeal(s);
      const au = pfAuction(s.hands, s.dealer, s.vul), c = finalContract(au);
      if (c && want(c.declarer)) { pick = { hands: s.hands, au, c }; break; }
      if (c && !fallback) fallback = { hands: s.hands, au, c };
      if (Date.now() > end) break;
    }
    pick = pick || fallback;
    if (!pick) return; // every deal passed out: bid this one yourself
    const d = pick.c.declarer;
    const r = mode === 'declare' ? pfTurnsTo(d, 'S') : want(d) ? 0 : 1;
    const g = pfRotate({ hands: pick.hands, dealer: s.dealer, vul: s.vul, auction: pick.au, contract: pick.c, tricks: [] }, r);
    s.hands = g.hands; s.dealer = g.dealer; s.vul = g.vul; s.auction = [];
    s.just = { board: s.board, mode };
    for (const a of g.auction) A.call(s, a.by, a.call, a.alert);
    if (!PlayFrom.told) { PlayFrom.told = true; toast(mode === 'declare' ? 'The robots bid all four hands: you declare' : 'The robots bid all four hands: you defend'); }
  },
  // undo back into a robots' auction: the robots bid it again (you only play in this mode)
  finishJust(s) {
    if (!(s.local && s.just && s.just.board === s.board && s.phase === 'auction')) return;
    while (!auctionOver(s.auction) && s.auction.length < 80) {
      const by = auctionTurn(s.dealer, s.auction), r = botCall(s.hands[by], by, s.dealer, s.auction, s.vul);
      if (A.call(s, by, r.call, r.alert) === false) break;
    }
  },
  // app.js act(): after each practice action
  afterAct(s) { if (PlayFrom.needJust(s)) PlayFrom.justBid(s); else PlayFrom.finishJust(s); },
  // app.js render(): a table opened at the start of a board (first practice board, Continue practice)
  onRender(t) {
    if (!PlayFrom.needJust(t)) return false;
    clearTimeout(robotTimer); robotTimer = null;
    act(s => PlayFrom.needJust(s) ? undefined : false); // afterAct does the bidding
    return true;
  },
  optionsHTML() {
    const v = Prefs.just || '';
    return `<label class="row" style="gap:8px;margin:4px 0 2px">Who bids in practice <select id="optJust">${[['', 'You bid'], ['declare', 'Just declare'], ['defend', 'Just defend']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="note" style="margin:0 0 8px">Just declare and Just defend: the robots bid all four hands, then you play as declarer (or as a defender). From the next board.</p>`;
  },
  optionsWire(m) { const el = m.querySelector('#optJust'); if (el) el.addEventListener('change', e => { Prefs.just = e.target.value; savePrefs(); }); },
};
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  PlayFrom.click(e);
  if (e.target.closest && e.target.closest('[data-pfagain]')) PlayFrom.again();
});

if (typeof module !== 'undefined') module.exports = { pfRotate, pfVul, pfAuction, pfTurnsTo, pfSeat, PF_TURN };
