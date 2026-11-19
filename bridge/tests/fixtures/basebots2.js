// ===== Robots: card play and how robots answer claims (bidding is in js/bidding.js) =====
if (typeof require !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('../../js/engine.js'));
if (typeof require !== 'undefined' && typeof botCall === 'undefined') Object.assign(globalThis, require('../../js/bidding.js'));
if (typeof require !== 'undefined' && typeof botLead === 'undefined') Object.assign(globalThis, require('../../js/leads.js'));
// ---- Card play ----
function botPlayOld(t, seat) {
  // t: table state; seat: seat whose card is chosen (may be dummy when declarer is robot)
  const c = t.contract, play = t.play, hands = t.hands;
  const trump = c.strain === 'N' ? null : c.strain;
  const legal = legalPlays(hands, play, c, seat);
  if (legal.length === 1) return legal[0];
  const my = remainingHand(hands, play, seat);
  const partner = partnerOf(seat);
  const dummy = partnerOf(c.declarer);
  const dummyVisible = play.tricks.length > 0 && play.tricks[0].cards.length > 0;
  const known = new Set([...playedCards(play), ...my]);
  if (dummyVisible) remainingHand(hands, play, dummy).forEach(x => known.add(x));
  const onDeclSide = sameSide(seat, c.declarer);
  if (onDeclSide) remainingHand(hands, play, partner).forEach(x => known.add(x));
  const ourCards = new Set(onDeclSide ? [...my, ...remainingHand(hands, play, partner)] : my);
  const isMaster = card => { // no unseen higher card in the suit
    const s = suitOf(card);
    for (let r = rankOf(card) + 1; r < 13; r++) { const x = s + RANKS[r]; if (!known.has(x) || (!ourCards.has(x) && !playedCards(play).has(x))) return false; }
    return true;
  };
  const low = arr => arr.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
  const high = arr => arr.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
  const bySuit = s => legal.filter(x => suitOf(x) === s);
  const discard = () => {
    // throw lowest card from the weakest non-trump suit
    const cands = SUITS.filter(s => s !== trump && bySuit(s).length);
    const pool = cands.length ? cands : SUITS.filter(s => bySuit(s).length);
    pool.sort((a, b) => hcp(bySuit(a)) - hcp(bySuit(b)) || bySuit(b).length - bySuit(a).length);
    return low(bySuit(pool[0]));
  };
  const trick = currentTrick(play);

  // --- Leading ---
  if (!trick || trick.cards.length === 0) {
    const first = play.tricks.length === 0;
    if (first && !onDeclSide) {
      // opening lead: partner's suit, else sequence, else longest (vs NT) / safe (vs suit)
      const pBids = t.auction.filter(a => a.by === partner && /^[1-7][CDHS]$/.test(a.call)).map(a => a.call[1]);
      for (const s of pBids.reverse()) if (bySuit(s).length) { const h = bySuit(s); return h.length <= 2 || /[AK]/.test(h[0][1]) && h[1] && rankOf(h[0]) - rankOf(h[1]) === 1 ? high(h) : low(h); }
      for (const s of SUITS) { const h = bySuit(s).sort((a, b) => rankOf(b) - rankOf(a)); if (h.length >= 2 && rankOf(h[0]) >= 10 && rankOf(h[0]) - rankOf(h[1]) === 1 && s !== trump) return h[0]; }
      if (trump) {
        const single = SUITS.find(s => s !== trump && bySuit(s).length === 1 && hcp(bySuit(s)) === 0 && bySuit(trump).length > 0);
        if (single) return bySuit(single)[0];
        const safe = SUITS.filter(s => s !== trump && bySuit(s).length && !bySuit(s).some(x => x[1] === 'A'));
        if (safe.length) { safe.sort((a, b) => bySuit(b).length - bySuit(a).length); const h = bySuit(safe[0]); return h.length === 2 ? high(h) : low(h); }
      }
      const s = SUITS.filter(x => x !== trump && bySuit(x).length).sort((a, b) => bySuit(b).length - bySuit(a).length)[0] || suitOf(legal[0]);
      const h = bySuit(s); return h.length >= 4 ? h.sort((a, b) => rankOf(b) - rankOf(a))[3] : h.length === 2 ? high(h) : low(h);
    }
    if (onDeclSide && trump) {
      // draw trumps while defenders still hold some
      const outstanding = [];
      for (const r of RANKS) { const x = trump + r; if (!known.has(x)) outstanding.push(x); }
      if (outstanding.length && bySuit(trump).length) {
        const masters = bySuit(trump).filter(isMaster);
        return masters.length ? high(masters) : low(bySuit(trump));
      }
    }
    const masters = legal.filter(x => isMaster(x) && (!trump || x[0] !== trump || onDeclSide));
    if (masters.length) return high(masters);
    // lead low from longest non-trump suit
    const s = SUITS.filter(x => x !== trump && bySuit(x).length).sort((a, b) => bySuit(b).length - bySuit(a).length)[0] || suitOf(legal[0]);
    return low(bySuit(s));
  }

  // --- Following ---
  const led = suitOf(trick.cards[0].card);
  const winSeat = trickWinner(trick, c.strain);
  const winCard = trick.cards.find(x => x.seat === winSeat).card;
  const pos = trick.cards.length; // 1 = second hand, 3 = last
  const beats = card => {
    const ws = suitOf(winCard), s = suitOf(card);
    if (s === ws) return rankOf(card) > rankOf(winCard);
    return trump && s === trump && ws !== trump;
  };
  const partnerWinning = winSeat === partner;
  const following = suitOf(legal[0]) === led && legal.every(x => suitOf(x) === led);
  if (following) {
    const winners = legal.filter(beats);
    if (partnerWinning && (pos === 3 || isMaster(winCard))) return low(legal);
    if (!winners.length) return low(legal);
    if (pos === 3) return low(winners);
    if (pos === 1) { const m = winners.filter(isMaster); return m.length && !onDeclSide ? low(legal) : (m.length ? low(m) : low(legal)); }
    // third hand: play high enough
    const m = winners.filter(isMaster);
    return m.length ? low(m) : high(winners);
  }
  // void in led suit
  if (trump && bySuit(trump).length && !(partnerWinning && (pos === 3 || isMaster(winCard)))) {
    const ruffs = bySuit(trump).filter(beats);
    if (ruffs.length) return low(ruffs);
  }
  return discard();
}


const BOT_DEFAULT_OFF = ['trlead', 'holdup']; // measured as neutral or harmful against the previous heuristic (tests/heurstim.js)
const OFF = k => ((typeof globalThis !== 'undefined' && globalThis.BOT_OFF) || BOT_DEFAULT_OFF).includes(k);
// ---- Card play v2: finesses, hold-ups, covering honours, ruffing in the short hand, signals ----
// Weights of the features in swF (a defender's lead after the opening lead) and dsF (a discard), by contract kind:
// fitted to double-dummy results with tests/heurfit.js (ridge regression, x10).
const BOT_SWITCH_NAMES = ['sigUp', 'sigDown', 'partnerLed', 'iLed', 'trump', 'throughHonour', 'upToWeak', 'dummyRuffs', 'ruffSluff', 'kNoA', 'qNoAK', 'master', 'myLen', 'dummyLen', 'seqTop', 'doubletonRuff', 'singletonRuff', 'declBid', 'dummyBid', 'partnerBid', 'dummyMasters', 'dummyLongSuit', 'partnerRuffs', 'declVoid'];
const BOT_DISCARD_NAMES = ['hcp', 'len', 'masters', 'mateLen', 'mateMasters', 'dummyLen', 'guardDummy', 'unguards', 'voidToRuff', 'singleton', 'sigUp', 'sigDown', 'ledSuit', 'higherUnseen', 'unseen', 'longCards', 'trump'];
const BOT_SWITCH_W = { NT: [1.9, -0.4, 0.6, -0.7, 0, 0.2, 1, 0, 0, 0, -0.1, 2.7, 0.2, -0.7, 2.2, 0, 0, -2.2, -0.2, 0.3, -1.5, -0.2, 0, 4.2], suit: [0.9, -0.5, 0.4, 0.4, -0.5, 0.4, 0.2, -4.2, -1.4, -0.2, 0.1, 1.7, 0, -0.2, 0.6, -0.2, 0, -1, 0.3, 1.1, -1, -0.4, 0.9, -0.6] };
const BOT_DISCARD_W = { declNT: [-0.2, 0.8, -0.3, 0, 0, 0, 0.1, -0.9, 0, -0.8, 0, 0, 0, 0.2, 0, 0.1, 0], declSuit: [-0.2, 0.5, 0.1, 0, -0.1, 0, 0.4, 0.1, 1.1, -0.6, 0, 0, 0, 0.4, 0, -0.2, 0], defNT: [0, 0.3, -0.3, 0, 0, -0.2, 0.5, -0.6, 0, -0.7, 0.2, -0.1, 0.1, 0.3, 0, 0.6, 0], defSuit: [-0.1, 0.3, -0.1, 0, 0, 0, 0.2, -0.7, 0.9, -0.4, 0, 0.2, 0, 0.1, 0, 0.3, 0] };
function botFeatures(t, seat, kind) { const r = botPlay(t, seat, kind); return r && r.opts ? r : null; }
let botWhy = ''; // which rule chose the last card (tests/heurstim.js leak report)
const R = (why, card) => { botWhy = why; return card; };
function botPlay(t, seat, want) { // want (tests/heurfit.js): return the features of a decision instead of a card
  const c = t.contract, play = t.play, hands = t.hands;
  const trump = c.strain === 'N' ? null : c.strain;
  const legal = legalPlays(hands, play, c, seat);
  if (legal.length === 1) return want ? null : R('L5', legal[0]);
  const decl = c.declarer, dummy = partnerOf(decl);
  const partner = partnerOf(seat);
  const onDeclSide = sameSide(seat, decl);
  const played = playedCards(play);
  const my = remainingHand(hands, play, seat);
  const dummyUp = play.tricks.length > 0 && play.tricks[0].cards.length > 0;
  const dummyCards = dummyUp ? remainingHand(hands, play, dummy) : [];
  const pCards = onDeclSide ? remainingHand(hands, play, partner) : (seat === dummy ? [] : (partner === dummy ? dummyCards : []));
  const known = new Set([...played, ...my, ...dummyCards, ...pCards]);
  const ours = new Set([...my, ...(onDeclSide ? pCards : [])]);
  const low = arr => arr.reduce((a, b) => rankOf(b) < rankOf(a) ? b : a);
  const high = arr => arr.reduce((a, b) => rankOf(b) > rankOf(a) ? b : a);
  const of = (arr, s) => arr.filter(x => suitOf(x) === s);
  const unseenAbove = card => { // unseen cards higher than `card` in its suit
    const s = suitOf(card), out = [];
    for (let r = rankOf(card) + 1; r < 13; r++) { const x = s + RANKS[r]; if (!known.has(x)) out.push(x); }
    return out;
  };
  const isMaster = card => { // no higher card outside our side
    const s = suitOf(card);
    for (let r = rankOf(card) + 1; r < 13; r++) { const x = s + RANKS[r]; if (!played.has(x) && !ours.has(x)) return false; }
    return true;
  };
  const oppTrumpsLeft = () => {
    if (!trump) return 0;
    let n = 0; for (const r of RANKS) { const x = trump + r; if (!played.has(x) && !ours.has(x)) n++; }
    return n;
  };
  // signals: partner's first discard/follow in each suit (high spot = encourage)
  const signals = {};
  if (!onDeclSide) for (const tr of play.tricks) {
    const ledS = suitOf(tr.cards[0].card);
    for (const pc of tr.cards.slice(1)) if (pc.seat === partner) {
      const s = suitOf(pc.card);
      if (signals[s] !== undefined) continue;
      if (s !== ledS || tr.cards[0].seat === seat) signals[s] = rankOf(pc.card) >= 5 ? 1 : -1; // 7 or higher encourages
    }
  }
  const trick = currentTrick(play);

  // ---- declarer's count (both hands are visible to the declaring side) ----
  // For each suit: our cards in this hand (A) and partner's (B), the opponents' (O), all high to low;
  // sure: tricks from the top; dev: tricks once the suit is developed (round by round, our top card wins if it
  // beats theirs, else we duck and their top card wins), lost: rounds lost while developing it.
  const suitCount = () => {
    const desc = arr => arr.slice().sort((a, b) => rankOf(b) - rankOf(a));
    const info = {};
    let sure = 0;
    for (const s of SUITS) {
      const A = desc(of(my, s)), B = desc(of(pCards, s)), O = [];
      for (let r = 12; r >= 0; r--) { const x = s + RANKS[r]; if (!played.has(x) && !ours.has(x)) O.push(x); }
      const L = Math.max(A.length, B.length), oTop = O.length ? rankOf(O[0]) : -1;
      const mast = A.filter(x => rankOf(x) > oTop).length + B.filter(x => rankOf(x) > oTop).length;
      const sr = !O.length || mast >= O.length ? L : Math.min(mast, L);
      const a = A.map(rankOf), b = B.map(rankOf), o = O.map(rankOf);
      let won = 0, lost = 0;
      for (let r = 0; r < L; r++) {
        const ta = a.length ? a[0] : -1, tb = b.length ? b[0] : -1, their = o.length ? o[0] : -1;
        if (Math.max(ta, tb) > their) { won++; if (ta >= tb) { a.shift(); b.pop(); } else { b.shift(); a.pop(); } o.pop(); o.pop(); }
        else { lost++; a.pop(); b.pop(); o.shift(); o.pop(); }
      }
      info[s] = { A, B, O, L, sure: sr, dev: won, lost };
      sure += s === trump && O.length ? Math.min(sr, L) : sr;
    }
    return { info, sure, need: c.level + 6 - tricksWon(play, c).decl };
  };
  // a card that forces out higher cards without losing to lower ones: we hold a lower card with no opponents' card between
  const solid = x => {
    const s = suitOf(x);
    for (let r = rankOf(x) - 1; r >= 0; r--) { const y = s + RANKS[r]; if (ours.has(y)) return true; if (!played.has(y)) return false; }
    return false;
  };
  // the declaring side on lead
  const declPlan = () => {
    const { info, sure, need } = suitCount();
    const other = pCards;
    if (trump) {
      const T = info[trump];
      const ourTop = Math.max(T.A.length ? rankOf(T.A[0]) : -1, T.B.length ? rankOf(T.B[0]) : -1);
      // ruff losers in the short trump hand
      if (!OFF('ruff') && (T.O.length || !OFF('ruff2')) && T.B.length > 0 && T.B.length < T.A.length) {
        for (const s of SUITS) if (s !== trump && !info[s].B.length && info[s].A.length && !info[s].A.every(isMaster)) return R('ruffShort', low(info[s].A));
      }
      // draw trumps, but leave the opponents' trumps that are higher than all of ours
      if (T.O.length && (OFF('leaveT') || T.O.some(x => rankOf(x) < ourTop))) {
        if (T.A.length) {
          const m = T.A.filter(isMaster);
          if (m.length) return R('drawTrump', high(m));
          if (T.B.length && rankOf(T.B[0]) > rankOf(T.A[0])) return R('drawTrumpToward', low(T.A));
          if (solid(T.A[0])) return R('drawTrumpSeq', T.A[0]);
          return R('drawTrumpLow', low(T.A));
        }
        for (const s of SUITS) if (s !== trump && info[s].A.length && info[s].B.some(isMaster)) return R('toDrawTrump', low(info[s].A));
      }
    }
    if (sure >= need || OFF('dev')) return null; // enough winners: cash them (below), short hand first
    // not enough: develop the suit that gains the most tricks, rather than cashing winners
    let best = null, gain = 0;
    for (const s of SUITS) {
      if (s === trump) continue;
      const I = info[s]; if (!I.A.length) continue;
      const g = I.dev - I.sure;
      if (g > gain || (g === gain && best && g > 0 && I.lost < info[best].lost)) { best = s; gain = g; }
    }
    if (!best) return null;
    const { A, B } = info[best];
    if (B.length && rankOf(B[0]) > rankOf(A[0])) return R('devToward', low(A)); // toward the honours
    if (isMaster(A[0]) || solid(A[0])) return R('devHigh', A[0]);
    return R('devLow', low(A));
  };

  // ---------- leading ----------
  if (!trick || trick.cards.length === 0) {
    if (play.tricks.length === 0 && !onDeclSide) return R('L48', botLead(hands[seat], t.auction || [], c, seat)); // opening lead: js/leads.js
    if (onDeclSide) {
      const other = pCards;
      const masters = legal.filter(isMaster);
      if (!OFF('plan')) { const p = declPlan(); if (p) return p; }
      if (trump) {
        const opp = oppTrumpsLeft();
        const myT = of(my, trump).length, otT = of(other, trump).length;
        // ruff losers in the short trump hand before drawing trumps
        if (!OFF('ruff') && opp && otT > 0 && otT < myT) {
          for (const s of SUITS) if (s !== trump && of(other, s).length === 0 && of(my, s).length && !of(my, s).every(isMaster)) return R('ruffShort', low(of(my, s)));
        }
        if (opp && myT) { const tm = of(legal, trump); const m = tm.filter(isMaster); return R('drawTrump', m.length ? high(m) : low(tm)); }
        if (opp && !myT && otT) {
          // get to the other hand to draw trumps: lead a suit where partner has a master
          for (const s of SUITS) if (of(my, s).length && of(other, s).some(isMaster)) return R('toDrawTrump', low(of(my, s)));
        }
      }
      // NT / trumps drawn: cash established winners in a suit where we keep the lead or unblock the short hand
      if (!OFF('unblock')) for (const s of SUITS) {
        const mine = of(my, s), oth = of(other, s);
        if (!mine.length) continue;
        const mm = mine.filter(isMaster);
        if (mm.length && (mine.length <= oth.length ? true : mm.length === mine.length || !oth.some(isMaster))) {
          // play from the short hand first (unblock)
          if (mine.length <= oth.length || !oth.length) return R('L72', high(mm));
        }
      }
      // finesse: lead low toward a tenace in the other hand (e.g. AQ, KJ)
      if (!OFF('fin')) for (const s of SUITS) {
        const mine = of(my, s), oth = of(other, s).sort((a, b) => rankOf(b) - rankOf(a));
        if (!mine.length || oth.length < 2) continue;
        const top = oth[0];
        if (isMaster(top)) {
          const gap = unseenAbove(oth[1]);
          if (gap.length === 1 && rankOf(oth[1]) >= 8) return R('L82', low(mine)); // missing exactly one card between: finesse
        }
      }
      if (masters.length) return R('L85', high(masters));
      // establish our longest combined suit
      const best = SUITS.filter(s => of(my, s).length && s !== trump).sort((a, b) => (of(my, b).length + of(other, b).length) - (of(my, a).length + of(other, a).length))[0];
      if (best) { const m = of(my, best); const seq = m.sort((a, b) => rankOf(b) - rankOf(a)); return R('establish', seq.length >= 2 && rankOf(seq[0]) - rankOf(seq[1]) === 1 && rankOf(seq[0]) >= 9 ? seq[0] : low(m)); }
      return R('L89', low(legal));
    }
    // defender leading later in the hand
    const firstLead = play.tricks[0].cards[0];
    const dummyLeft = nextSeat(seat) === dummy; // dummy plays right after me
    const cand = SUITS.filter(s => of(legal, s).length);
    // known voids: a seat that failed to follow suit is void in it
    const voidIn = (who, su) => play.tricks.some(tr => suitOf(tr.cards[0].card) === su && tr.cards.some(pc => pc.seat === who && suitOf(pc.card) !== su));
    // cash setting tricks: our side's sure winners are enough to beat the contract
    if (!OFF('setcash')) {
      const tw = tricksWon(play, c);
      const toSet = 13 - (c.level + 6) + 1 - tw.def;
      const declTrumps = trump && !voidIn(decl, trump);
      const sure = legal.filter(x => isMaster(x) && (!trump || x[0] === trump || (!(voidIn(decl, x[0]) && declTrumps) && !(of(dummyCards, x[0]).length === 0 && of(dummyCards, trump).length))));
      if (toSet > 0 && sure.length >= toSet) return want ? null : R('L103', high(sure));
    }
    const scoreSuit = s => {
      let sc = 0;
      if (signals[s] === 1) sc += 50;
      if (signals[s] === -1) sc -= 30;
      if (firstLead.seat === partner && suitOf(firstLead.card) === s) sc += 40;
      if (s === trump) sc -= 25;
      const dm = of(dummyCards, s);
      if (dummyLeft) sc += dm.some(x => rankOf(x) >= 9 && !isMaster(x)) ? 15 : 0;   // lead through strength
      else sc += dm.length && dm.every(x => rankOf(x) < 9) ? 15 : 0;                // up to weakness
      if (trump && dm.length === 0 && of(dummyCards, trump).length) sc -= 35;     // don't give a ruff in dummy
      if (of(my, s).some(x => x[1] === 'K') && !of(my, s).some(x => x[1] === 'A')) sc -= 12; // don't lead away from a king
      if (of(legal, s).some(isMaster)) sc += 20;
      // ruff and discard: both declarer and dummy void while they hold trumps
      if (!OFF('sluff') && trump && s !== trump && dm.length === 0 && voidIn(decl, s) && of(dummyCards, trump).length) sc -= 60;
      // lead trumps to stop ruffs when dummy is short in a side suit and has trumps
      if (!OFF('trlead') && trump && s === trump && of(dummyCards, trump).length >= 1 && SUITS.some(x => x !== trump && of(dummyCards, x).length <= 1 && of(my, x).length >= 2)) sc += 30;
      return sc;
    };
    const leadCardIn = s => { // a winner, the top of a sequence or of a doubleton, else low
      const m = of(legal, s), mm = m.filter(isMaster);
      if (mm.length) return high(mm);
      const sorted = m.slice().sort((a, b) => rankOf(b) - rankOf(a));
      if (sorted.length >= 2 && rankOf(sorted[0]) - rankOf(sorted[1]) === 1 && rankOf(sorted[0]) >= 9) return sorted[0];
      return sorted.length === 2 ? sorted[0] : low(m);
    };
    // features of leading each suit (weights fitted to double-dummy results by tests/heurfit.js)
    const bidBy = (who, s) => (t.auction || []).some(a => a.by === who && /^[1-7][CDHS]$/.test(a.call) && a.call[1] === s);
    const swF = s => {
      const dm = of(dummyCards, s), mine = of(my, s), dT = trump ? of(dummyCards, trump).length : 0, myT = trump ? of(my, trump).length : 0;
      const srt = mine.slice().sort((a, b) => rankOf(b) - rankOf(a)), side = trump && s !== trump;
      const has = r => mine.some(x => x[1] === r);
      return [
        signals[s] === 1 ? 1 : 0, signals[s] === -1 ? 1 : 0,
        firstLead.seat === partner && suitOf(firstLead.card) === s ? 1 : 0, firstLead.seat === seat && suitOf(firstLead.card) === s ? 1 : 0,
        s === trump ? 1 : 0,
        dummyLeft && dm.some(x => rankOf(x) >= 9 && !isMaster(x)) ? 1 : 0, !dummyLeft && dm.length && dm.every(x => rankOf(x) < 9) ? 1 : 0,
        side && !dm.length && dT ? 1 : 0, side && !dm.length && voidIn(decl, s) && dT ? 1 : 0,
        has('K') && !has('A') ? 1 : 0, has('Q') && !has('K') && !has('A') ? 1 : 0, mine.some(isMaster) ? 1 : 0,
        mine.length, dm.length,
        srt.length >= 2 && rankOf(srt[0]) >= 8 && rankOf(srt[0]) - rankOf(srt[1]) === 1 ? 1 : 0,
        side && myT && mine.length === 2 ? 1 : 0, side && myT && mine.length === 1 ? 1 : 0,
        bidBy(decl, s) ? 1 : 0, bidBy(dummy, s) ? 1 : 0, bidBy(partner, s) ? 1 : 0,
        dm.filter(isMaster).length, dm.length >= 4 && dm.some(x => rankOf(x) >= 10) ? 1 : 0,
        side && voidIn(partner, s) && !voidIn(partner, trump) ? 1 : 0, voidIn(decl, s) ? 1 : 0,
      ];
    };
    if (want === 'switch') return cand.length > 1 ? { group: trump ? 'suit' : 'NT', opts: cand.map(s => ({ f: swF(s), card: leadCardIn(s) })) } : null;
    if (!OFF('swfit') && BOT_SWITCH_W[trump ? 'suit' : 'NT']) {
      const W = BOT_SWITCH_W[trump ? 'suit' : 'NT'], sc = {};
      for (const s of cand) sc[s] = swF(s).reduce((a, v, i) => a + v * W[i], 0);
      cand.sort((a, b) => sc[b] - sc[a]);
    } else cand.sort((a, b) => scoreSuit(b) - scoreSuit(a));
    return R('defSwitch', leadCardIn(cand[0]));
  }

  // ---------- following ----------
  const led = suitOf(trick.cards[0].card);
  const winSeat = trickWinner(trick, c.strain);
  const winCard = trick.cards.find(x => x.seat === winSeat).card;
  const pos = trick.cards.length; // 1 second hand, 2 third hand, 3 fourth hand
  const beats = card => {
    const ws = suitOf(winCard), s = suitOf(card);
    if (s === ws) return rankOf(card) > rankOf(winCard);
    return !!trump && s === trump && ws !== trump;
  };
  const partnerWinning = winSeat === partner;
  // is partner's card sure to win? (4th hand can't beat it)
  const safe = () => {
    if (!partnerWinning) return false;
    if (pos === 3) return true;
    const lhoNext = nextSeat(seat);
    const lhoCards = lhoNext === dummy && dummyUp ? dummyCards : (onDeclSide && lhoNext === partner ? pCards : null);
    if (lhoCards) { const f = of(lhoCards, led); const cand = f.length ? f : (trump ? of(lhoCards, trump) : []); return !cand.some(x => (suitOf(x) === suitOf(winCard) && rankOf(x) > rankOf(winCard)) || (trump && suitOf(x) === trump && suitOf(winCard) !== trump)); }
    return isMaster(winCard) || unseenAbove(winCard).length === 0;
  };
  const follow = of(legal, led);
  if (follow.length) {
    const winners = follow.filter(beats);
    // signal attitude when not trying to win (defender)
    const signal = () => {
      if (onDeclSide) return R('L157', low(follow));
      const likes = of(my, led).some(x => rankOf(x) >= 10) && trick.cards[0].seat === partner;
      if (likes) { const spots = follow.filter(x => rankOf(x) < 9); if (spots.length) return high(spots); }
      return R('L160', low(follow));
    };
    // declarer in notrump, the opponents' suit: hold up the single stopper (rule of 7) unless the winners are already enough
    const holdUp = () => {
      if (OFF('holdup') || trump || !onDeclSide || sameSide(trick.cards[0].seat, decl)) return false;
      const ourS = [...of(my, led), ...of(pCards, led)];
      if (ourS.filter(isMaster).length !== 1) return false;
      const orig = of(hands[decl], led).length + of(hands[dummy], led).length;
      const rounds = play.tricks.filter(tr => tr.cards.length === 4 && suitOf(tr.cards[0].card) === led).length;
      if (rounds >= 7 - orig) return false;
      const { sure, need } = suitCount();
      return sure < need;
    };
    if (partnerWinning && safe()) return R('L162', signal());
    if (!winners.length) return R('L163', signal());
    if ((pos === 3 || pos === 1) && holdUp()) return R('holdUp', low(follow));
    if (pos === 3) return R('L164', low(winners));
    if (pos === 1) {
      // second hand low, but cover an honour with an honour
      const ledCard = trick.cards[0].card;
      if (rankOf(ledCard) >= 9 && !onDeclSide) {
        const cover = winners.filter(x => rankOf(x) >= 9);
        const nextIsDummy = nextSeat(seat) === dummy && dummyUp;
        const dummyHasSeq = nextIsDummy && of(dummyCards, led).some(x => rankOf(x) === rankOf(ledCard) - 1);
        if (cover.length && !dummyHasSeq) return R('L172', low(cover));
      }
      const m = winners.filter(isMaster);
      if (!OFF('second') && onDeclSide && m.length) return R('L182', low(m));
      return R('L183', low(follow));
    }
    // third hand
    // finesse: partner (our hand) led low; play the cheapest card that beats the current winner
    if (onDeclSide) return R('L196', low(winners));
    // defender third hand: high, but cheapest of equals
    const top = high(winners);
    const seq = follow.filter(x => rankOf(x) <= rankOf(top) && rankOf(x) >= rankOf(winCard) && unseenAbove(x).filter(u => rankOf(u) < rankOf(top)).length === 0 && beats(x));
    return R('L201', seq.length ? low(seq) : top);
  }
  // void in the led suit
  if (trump && of(legal, trump).length && !(partnerWinning && safe())) {
    const ruffs = of(legal, trump).filter(beats);
    if (ruffs.length) return R('L206', low(ruffs));
  }
  // discard: as defender, signal with a high spot in a suit we like, else throw from the weakest suit
  const cands = SUITS.filter(s => s !== trump && of(legal, s).length);
  const pool = cands.length ? cands : SUITS.filter(s => of(legal, s).length);
  // features of discarding from each suit (weights fitted to double-dummy results by tests/heurfit.js)
  const dsF = s => {
    const mine = of(my, s), mate = onDeclSide ? of(pCards, s) : [], dm = seat === dummy ? of(pCards, s) : of(dummyCards, s);
    const unseen = []; for (let r = 0; r < 13; r++) { const x = s + RANKS[r]; if (!known.has(x)) unseen.push(x); }
    const top = mine.length ? Math.max(...mine.map(rankOf)) : -1, has = r => mine.some(x => x[1] === r);
    const myT = trump ? of(my, trump).length : 0;
    return [
      hcp(mine), mine.length, mine.filter(isMaster).length, mate.length, mate.filter(isMaster).length, dm.length,
      mine.length >= dm.length && dm.length >= 3 ? 1 : 0, (has('K') && mine.length === 2) || (has('Q') && mine.length === 3) ? 1 : 0,
      mine.length === 1 && trump && s !== trump && myT ? 1 : 0, mine.length === 1 ? 1 : 0,
      signals[s] === 1 ? 1 : 0, signals[s] === -1 ? 1 : 0, !onDeclSide && suitOf(play.tricks[0].cards[0].card) === s ? 1 : 0,
      unseen.filter(x => rankOf(x) > top).length, unseen.length, mine.length > unseen.length ? 1 : 0, s === trump ? 1 : 0,
    ];
  };
  const dsKey = (onDeclSide ? 'decl' : 'def') + (trump ? 'Suit' : 'NT');
  if (want === 'discard') return pool.length > 1 ? { group: dsKey, opts: pool.map(s => ({ f: dsF(s), card: low(of(legal, s)) })) } : null;
  if (!OFF('dsfit') && pool.length > 1 && BOT_DISCARD_W[dsKey]) {
    const W = BOT_DISCARD_W[dsKey], sc = {};
    for (const s of pool) sc[s] = dsF(s).reduce((a, v, i) => a + v * W[i], 0);
    const best = pool.slice().sort((a, b) => sc[b] - sc[a])[0];
    return R('discFit', low(of(legal, best)));
  }
  if (!onDeclSide) {
    const liked = pool.find(s => of(my, s).some(x => rankOf(x) >= 11) && signals[s] === undefined);
    if (liked && of(legal, liked).length >= 3) { const spots = of(legal, liked).filter(x => rankOf(x) < 9); if (spots.length) return R('discSignal', high(spots)); }
  }
  pool.sort((a, b) => (hcp(of(my, a)) - hcp(of(my, b))) || (of(my, b).length - of(my, a).length));
  return R('L216', low(of(legal, pool[0])));
}

// Robot response to a claim: how many of the remaining tricks the claimer's side is sure to take.
// With 4 or fewer tricks left this is exact (every line of play is tried). With more it only counts
// winners that can't be lost: cards in the hand on lead, side suits only once the opponents' trumps
// are drawn, and nothing at all if the opponents are on lead with a trick to cash.
function exactTricks(t, claimer) {
  const c = t.contract, trump = c.strain === 'N' ? null : c.strain;
  const rem = {}; for (const s of SEATS) rem[s] = remainingHand(t.hands, t.play, s).slice();
  const cur = t.play.tricks.length && t.play.tricks[t.play.tricks.length - 1].cards.length < 4 ? t.play.tricks[t.play.tricks.length - 1].cards.slice() : [];
  const ours = s => sameSide(s, claimer);
  const beats = (x, y, led) => { // does card x beat card y (y currently winning)?
    if (suitOf(x) === suitOf(y)) return rankOf(x) > rankOf(y);
    if (trump && suitOf(x) === trump) return true;
    return false;
  };
  function go(trick, turn) {
    if (SEATS.every(s => !rem[s].length) && !trick.length) return 0;
    let cards = rem[turn];
    if (trick.length) { const f = cards.filter(x => suitOf(x) === suitOf(trick[0].card)); if (f.length) cards = f; }
    const max = ours(turn);
    let best = max ? -1 : 99;
    for (const card of [...new Set(cards)]) {
      const i = rem[turn].indexOf(card); rem[turn].splice(i, 1);
      const nt = trick.concat([{ seat: turn, card }]);
      let v;
      if (nt.length === 4) {
        let w = nt[0]; for (const pc of nt.slice(1)) if (beats(pc.card, w.card)) w = pc;
        v = (ours(w.seat) ? 1 : 0) + go([], w.seat);
      } else v = go(nt, nextSeat(turn));
      rem[turn].splice(i, 0, card);
      if (max ? v > best : v < best) best = v;
    }
    return best;
  }
  const turn = cur.length ? nextSeat(cur[cur.length - 1].seat) : playTurn(t.play, c);
  return go(cur, turn);
}
function sureTricks(t, claimer) {
  const c = t.contract, play = t.play, hands = t.hands;
  const left = remainingHand(hands, play, claimer).length;
  if (left <= 4) return exactTricks(t, claimer);
  const tr = play.tricks[play.tricks.length - 1];
  if (tr && tr.cards.length && tr.cards.length < 4) return 0; // mid-trick: only exact endings are accepted
  const leader = playTurn(play, c);
  const trump = c.strain === 'N' ? null : c.strain;
  const o1 = nextSeat(claimer), o2 = partnerOf(o1);
  const oppHands = [remainingHand(hands, play, o1), remainingHand(hands, play, o2)];
  const opp = [...oppHands[0], ...oppHands[1]];
  const topIn = (cards, s) => Math.max(-1, ...cards.filter(x => suitOf(x) === s).map(rankOf));
  if (!sameSide(leader, claimer)) return 0; // opponents on lead with 5+ tricks left: too many ways to go wrong
  // our side is on lead: count winners in the hand on lead only (no reliance on entries to partner)
  const mine = remainingHand(hands, play, leader);
  const partner = remainingHand(hands, play, partnerOf(leader));
  const winnersIn = s => {
    // a card counts only if it beats every card the opponents AND partner hold in the suit,
    // so partner can never be forced to overtake and strand the rest
    const m = mine.filter(x => suitOf(x) === s), top = Math.max(topIn(opp, s), topIn(partner, s));
    const tops = m.filter(x => rankOf(x) > top).length;
    const oppLen = Math.max(...oppHands.map(h => h.filter(x => suitOf(x) === s).length));
    return tops >= oppLen ? m.length : tops; // once the opponents are out of the suit, the rest are winners too
  };
  let n = 0;
  if (trump) {
    const trumpTops = winnersIn(trump);
    const oppTrumpLen = Math.max(...oppHands.map(h => h.filter(x => suitOf(x) === trump).length));
    n += trumpTops;
    if (oppTrumpLen === 0 || trumpTops >= oppTrumpLen) for (const s of SUITS) if (s !== trump) n += winnersIn(s);
  } else for (const s of SUITS) n += winnersIn(s);
  return Math.min(n, left);
}

function simulateBoard(hands, dealer, vul) {
  const auction = [];
  while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = botCall(hands[s], s, dealer, auction, vul); auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s }); }
  const contract = finalContract(auction);
  if (!contract) return { auction, contract: null, declTricks: null, scoreNS: 0, tricks: [] };
  const t = { hands, auction, contract, play: { tricks: [] } };
  for (let i = 0; i < 52; i++) { const s = playTurn(t.play, contract); applyPlay(t.play, contract, s, botPlay(t, s)); }
  const d = tricksWon(t.play, contract).decl;
  return { auction, contract, declTricks: d, scoreNS: scoreNS(contract, d, vul), tricks: t.play.tricks };
}
if (typeof module !== 'undefined') module.exports = { simulateBoard, botCall, botPlay, botPlayOld, botWhyLast: () => botWhy, botFeatures, botFeatureNames: k => k === "switch" ? BOT_SWITCH_NAMES : BOT_DISCARD_NAMES, sureTricks, exactTricks, shown };
