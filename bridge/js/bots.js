// ===== Robots: card play and how robots answer claims (bidding is in js/bidding.js) =====
if (typeof require !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('./engine.js'));
if (typeof require !== 'undefined' && typeof botCall === 'undefined') Object.assign(globalThis, require('./bidding.js'));
if (typeof require !== 'undefined' && typeof botLead === 'undefined') Object.assign(globalThis, require('./leads.js'));
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
// Weights of the features in swF (a defender's lead after the opening lead), dsF (a discard), dlF (the declaring side's
// lead) and flF (following suit; only the groups listed, side + seat 1|2 + n|s), by contract kind: fitted with
// tests/heurfit.js (ridge regression, x10) to the average of the double-dummy result and a heuristic play-out (Y=mix).
// The defenders' discard weights are still the double-dummy fit.
const BOT_SWITCH_NAMES = ['sigUp', 'sigDown', 'partnerLed', 'iLed', 'trump', 'throughHonour', 'upToWeak', 'dummyRuffs', 'ruffSluff', 'kNoA', 'qNoAK', 'master', 'myLen', 'dummyLen', 'seqTop', 'doubletonRuff', 'singletonRuff', 'declBid', 'dummyBid', 'partnerBid', 'dummyMasters', 'dummyLongSuit', 'partnerRuffs', 'declVoid', 'aceNoK', 'masters2', 'trumpPassive', 'declRuffs', 'cashUrgent', 'intoTenace', 'noHonour', 'tenace', 'unseen'];
const BOT_DISCARD_NAMES = ['hcp', 'len', 'masters', 'mateLen', 'mateMasters', 'dummyLen', 'guardDummy', 'unguards', 'voidToRuff', 'singleton', 'sigUp', 'sigDown', 'ledSuit', 'higherUnseen', 'unseen', 'longCards', 'trump'];
const BOT_SWITCH_W = { NT: [1.6, 0.1, 1.1, 0.1, 0, 0.1, 1.2, 0, 0, -0.1, 0.6, 1.8, 0.2, -0.8, 0.9, 0, 0, -1.9, 0.1, 2.3, -0.7, 0.8, 0, 2, -1.3, 2.9, 0, 0, 0, 0.7, 0.4, 0.4, 0.3], suit: [0.5, 0, 0.3, -0.2, -1.7, 0, 0.8, -2.9, -0.8, -0.3, 0.2, 0.7, 0, -0.2, 0.5, 0, 0.5, -0.9, 0.2, 0.3, -0.5, -0.1, 0.6, -0.5, -0.4, 0.2, 2, 0.4, 0, -0.7, -0.1, 0.1, -0.2] };
const BOT_DLEAD_NAMES = ['rule', 'trump', 'trumpOppLeft', 'trumpNone', 'partnerRuffs', 'shortRuffs', 'oppRuffs', 'sure', 'gain', 'lost', 'myMasters', 'cashSure', 'oppLen', 'shortFirst', 'towardTenace', 'ruffRisk', 'crossruff', 'len', 'noHonour', 'toPartner', 'trumpShort', 'givesTrick', 'partnerMasters', 'trumpLong'];
const BOT_DLEAD_W = { NT: [0.7, 0, 0, 0, 0, 0, 0, 0.8, 0.9, -0.8, 0.4, 1, -0.5, 0, 0.9, 0, 0, 0.1, 1, 0.6, 0, -2.7, -0.1, 0], suit: [0.9, -0.8, 0.7, -1.4, 2.3, 0.1, -1.8, 0.8, 0.8, 0.4, 0.1, 0.3, 0, 0.1, 0.3, -1.3, 0.2, -0.3, 0.5, 0.6, -0.6, -1.1, 0.1, 0.3] };
const BOT_FOLLOW_NAMES = ['rule', 'low', 'wins', 'sureWin', 'overtake', 'above', 'honour', 'rank', 'coverHonour', 'setNow', 'nextBeats', 'endgame', 'unblock', 'finesse1', 'secondWin', 'honourDoubleton', 'high', 'ourLead', 'finFew', 'finMany', 'fin2Few'];
const BOT_FOLLOW_W = { decl1n: [-0.8, -0.8, 1.8, 2.8, 0, 0.9, -1.1, -0.5, 2.2, 2.8, 0, 0.4, 1.4, 0.8, -1, 0.5, -2.4, 0, -0.6, 0.8, 0.3], decl1s: [0, -0.7, 1.1, 1.9, 0, 0.5, -0.6, -0.4, 1.5, 1.9, 0, 0.7, 0.7, 0.6, -0.8, 0.5, -1.1, 0, 0.1, 0.5, -0.1], def1n: [0.4, -0.3, 3, 5.6, 0, 0.2, 0.4, -2.1, 0.6, 0.3, 1, 0.2, 0, -0.2, -2.6, 0.2, -0.6, 0, -1.8, 0.6, -0.5], def1s: [0.1, -0.3, 1.7, 3.2, 0, 0.3, 0.1, -1, 1.7, 0.3, 0.9, 0.4, 0, -0.3, -1.4, 0.5, -0.5, 0, 0, 0.2, -0.7], def2n: [2.4, -1.5, 2.4, 10.4, -6.1, 0.3, 2.1, -3.1, 0, 0.9, -0.5, 1.9, 0, 3.6, 0, 1, -0.1, 0, -1.9, 2.6, 2], def2s: [0.9, -0.3, 2.8, 7.7, -5.2, -0.1, 1.8, -1.9, 0, 1, 0, 0.4, 0, 1.1, 0, 0.2, -0.2, 0, -0.8, 1.8, -0.2] };
const BOT_DISCARD_W = { declNT: [0, 0.6, -0.9, 0, 0, 0, 0.1, -0.6, 0, 0, 0, 0, 0, 0.2, 0, 0.4, 0], declSuit: [-0.1, 0.3, -0.2, -0.1, 0.2, -0.1, 0.3, -0.3, 0.3, -0.5, 0, 0, 0, 0.2, 0.1, 0.1, 0], defNT: [0, 0.3, -0.3, 0, 0, -0.2, 0.5, -0.6, 0, -0.7, 0.2, -0.1, 0.1, 0.3, 0, 0.6, 0], defSuit: [-0.1, 0.3, -0.1, 0, 0, 0, 0.2, -0.7, 0.9, -0.4, 0, 0.2, 0, 0.1, 0, 0.3, 0] };
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
  // known voids: a seat that failed to follow suit is void in it
  const voidIn = (who, su) => play.tricks.some(tr => suitOf(tr.cards[0].card) === su && tr.cards.some(pc => pc.seat === who && suitOf(pc.card) !== su));

  // a defender's sure winner: a master that neither declarer (known void) nor dummy (void) can ruff
  const defSure = x => isMaster(x) && (!trump || x[0] === trump || (!(voidIn(decl, x[0]) && !voidIn(decl, trump)) && !(dummyUp && of(dummyCards, x[0]).length === 0 && of(dummyCards, trump).length)));

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

  // the declaring side on lead: the rules (declPlan first), then the fitted choice of suit (dlF, BOT_DLEAD_W) may override
  const declRule = () => {
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
  };
  // the card the declaring side leads in a suit: a master from the short hand, low toward partner's higher cards,
  // the top of a sequence, else low
  const declCardIn = s => {
    const mine = of(legal, s).sort((a, b) => rankOf(b) - rankOf(a)), oth = of(pCards, s).sort((a, b) => rankOf(b) - rankOf(a));
    const mm = mine.filter(isMaster);
    if (mm.length && (mine.length <= oth.length || !oth.some(isMaster))) return mm[0];
    if (oth.length && rankOf(oth[0]) > rankOf(mine[0])) return mine[mine.length - 1];
    if (mm.length || solid(mine[0])) return mine[0];
    return mine[mine.length - 1];
  };
  let dlInfo = null;
  const dlF = (s, rc) => {
    if (!dlInfo) dlInfo = suitCount();
    const { info, sure, need } = dlInfo, I = info[s], side = !!trump && s !== trump;
    const oppT = trump ? info[trump].O.length : 0, myT = trump ? info[trump].A.length : 0, pT = trump ? info[trump].B.length : 0;
    const lho = nextSeat(seat), rho = partnerOf(lho);
    const card = s === suitOf(rc) ? rc : declCardIn(s);
    const oth = I.B, mineM = I.A.filter(isMaster).length, othM = I.B.filter(isMaster).length;
    const ten = oth.length >= 2 && isMaster(oth[0]) && unseenAbove(oth[1]).length === 1;
    return [
      s === suitOf(rc) ? 1 : 0, s === trump ? 1 : 0, s === trump && oppT ? 1 : 0, s === trump && !oppT ? 1 : 0,
      side && !oth.length && pT ? 1 : 0, side && !oth.length && pT && pT < myT ? 1 : 0,
      side && oppT && ((voidIn(lho, s) && !voidIn(lho, trump)) || (voidIn(rho, s) && !voidIn(rho, trump))) ? 1 : 0,
      Math.min(I.sure, 5), I.dev - I.sure, I.lost, mineM, sure >= need ? Math.min(I.sure, 5) : 0, I.O.length,
      I.A.length <= oth.length && mineM ? 1 : 0, ten ? 1 : 0, side && oppT && I.O.length <= 3 ? 1 : 0,
      side && !oth.length && pT && myT && SUITS.some(x => x !== trump && x !== s && !info[x].A.length && info[x].B.length) ? 1 : 0,
      I.A.length + oth.length, Math.max(I.A.length ? rankOf(I.A[0]) : -1, oth.length ? rankOf(oth[0]) : -1) < 9 ? 1 : 0,
      othM && !mineM ? 1 : 0, s === trump && sure < need ? 1 : 0,
      !isMaster(card) && !solid(card) && !(oth.length && rankOf(oth[0]) > rankOf(card)) ? 1 : 0,
      othM, s === trump && oppT && myT + pT >= 2 * oppT ? 1 : 0,
    ];
  };

  // ---------- leading ----------
  if (!trick || trick.cards.length === 0) {
    if (play.tricks.length === 0 && !onDeclSide) return R('L48', botLead(hands[seat], t.auction || [], c, seat)); // opening lead: js/leads.js
    if (onDeclSide) {
      const rc = declRule(), rwhy = botWhy;
      const cand = SUITS.filter(s => of(legal, s).length);
      if (want === 'lead') return cand.length > 1 ? { group: trump ? 'suit' : 'NT', opts: cand.map(s => ({ f: dlF(s, rc), card: s === suitOf(rc) ? rc : declCardIn(s) })) } : null;
      if (OFF('dlfit') || cand.length < 2 || !BOT_DLEAD_W[trump ? 'suit' : 'NT']) return R(rwhy, rc);
      const W = BOT_DLEAD_W[trump ? 'suit' : 'NT'];
      let best = null, bs = -1e9;
      for (const s of cand) { const v = dlF(s, rc).reduce((a, x, i) => a + x * W[i], 0); if (v > bs) { bs = v; best = s; } }
      return best === suitOf(rc) ? R(rwhy, rc) : R('dlFit', declCardIn(best));
    }
    // defender leading later in the hand
    const firstLead = play.tricks[0].cards[0];
    const dummyLeft = nextSeat(seat) === dummy; // dummy plays right after me
    const cand = SUITS.filter(s => of(legal, s).length);
    // cash setting tricks: our side's sure winners are enough to beat the contract
    if (!OFF('setcash')) {
      const tw = tricksWon(play, c);
      const toSet = 13 - (c.level + 6) + 1 - tw.def;
      const sure = legal.filter(defSure);
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
    // dummy has a long suit it can run (discards for declarer's losers)
    const dmMaster = x => { for (let r = rankOf(x) + 1; r < 13; r++) { const y = x[0] + RANKS[r]; if (!played.has(y) && !dummyCards.includes(y)) return false; } return true; };
    const dummyRun = s0 => SUITS.some(x => x !== s0 && x !== trump && of(dummyCards, x).length >= 4 && of(dummyCards, x).filter(dmMaster).length >= 2);
    // dummy holds a tenace (two honours with exactly one unseen card between them)
    const dmTenace = dm => { const h = dm.filter(x => rankOf(x) >= 9).sort((a, b) => rankOf(b) - rankOf(a)); for (let i = 0; i + 1 < h.length; i++) { const gap = unseenAbove(h[i + 1]).filter(u => rankOf(u) < rankOf(h[i])).length; if (gap === 1 && isMaster(h[i])) return true; } return false; };
    const myTenace = srt => { for (let i = 0; i + 1 < srt.length; i++) if (rankOf(srt[i + 1]) >= 9 && rankOf(srt[i]) - rankOf(srt[i + 1]) === 2 && !known.has(srt[0][0] + RANKS[rankOf(srt[i]) - 1])) return true; return false; };
    const unseenN = s0 => { let n = 0; for (const r of RANKS) if (!known.has(s0 + r)) n++; return n; };
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
        has('A') && !has('K') && !dm.some(x => x[1] === 'K') && !played.has(s + 'K') ? 1 : 0, Math.min(2, mine.filter(isMaster).length) === 2 ? 1 : 0,
        s === trump && !mine.some(x => rankOf(x) >= 9 && !isMaster(x)) ? 1 : 0,
        side && voidIn(decl, s) && !voidIn(decl, trump) ? 1 : 0,
        mine.some(isMaster) && dummyRun(s) ? 1 : 0,
        !dummyLeft && dmTenace(dm) ? 1 : 0, mine.every(x => rankOf(x) < 9) ? 1 : 0, myTenace(srt) ? 1 : 0,
        unseenN(s) / 4,
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
    // features of following with card x (weights fitted by tests/heurfit.js, kind follow)
    const later = [1, 2, 3].filter(i => i > pos).map(i => SEATS[(SEATS.indexOf(trick.cards[0].seat) + i) % 4]);
    const visibleOf = who => who === seat ? my : (who === dummy && dummyUp) ? dummyCards : (onDeclSide && who === partner) ? pCards : null;
    const canBeat = (who, x) => { const v = visibleOf(who); if (!v) return null; const f = of(v, led); if (f.length) return f.some(y => rankOf(y) > rankOf(x)); return !!trump && led !== trump && of(v, trump).length > 0; };
    const sureWin = x => beats(x) && later.every(w => sameSide(w, seat) || (canBeat(w, x) === null ? unseenAbove(x).length === 0 && !(trump && led !== trump && voidIn(w, led) && !voidIn(w, trump)) : !canBeat(w, x)));
    let toSetF = null;
    const flF = (x, rc, sureW) => {
      const b = beats(x), k = unseenAbove(x).length, ledHon = rankOf(trick.cards[0].card) >= 9;
      if (toSetF === null) toSetF = onDeclSide ? 0 : 13 - (c.level + 6) + 1 - tricksWon(play, c).def - my.filter(y => suitOf(y) !== led && defSure(y)).length;
      const nextOpp = later.find(w => !sameSide(w, seat)), nb = nextOpp ? canBeat(nextOpp, x) : null;
      const mineL = of(my, led).length, othL = onDeclSide ? of(pCards, led).length : 0;
      const left = 13 - play.tricks.length + 1;
      let oppN = 0; for (const r of RANKS) if (!known.has(led + r)) oppN++;
      return [
        x === rc ? 1 : 0, x === low(follow) ? 1 : 0, b ? 1 : 0, sureW.includes(x) ? 1 : 0, partnerWinning && b ? 1 : 0,
        Math.min(k, 4), rankOf(x) >= 9 ? 1 : 0, Math.max(0, rankOf(x) - 8),
        pos === 1 && ledHon && b ? 1 : 0, sureW.includes(x) && toSetF <= 1 ? 1 : 0,
        nb === true ? 1 : 0, left <= 4 && b ? 1 : 0, onDeclSide && rankOf(x) >= 9 && mineL <= 2 && othL > mineL + 1 ? 1 : 0,
        b && k === 1 ? 1 : 0, pos === 1 && b && !sureW.includes(x) ? 1 : 0, mineL === 2 && rankOf(x) >= 9 ? 1 : 0,
        x === high(follow) ? 1 : 0, sameSide(trick.cards[0].seat, seat) ? 1 : 0,
        b && k === 1 && oppN <= 2 ? 1 : 0, b && k === 1 && oppN >= 4 ? 1 : 0, b && k === 2 && oppN <= 3 ? 1 : 0,
      ];
    };
    const followRule = () => {
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
        // defender: take a master when it and our other sure winners beat the contract
        if (!onDeclSide && m.length && !OFF('set2')) {
          const toSet = 13 - (c.level + 6) + 1 - tricksWon(play, c).def;
          if (1 + my.filter(x => suitOf(x) !== led && defSure(x)).length >= toSet) return R('set2', low(m));
        }
        return R('L183', low(follow));
      }
      // third hand
      // finesse: partner (our hand) led low; play the cheapest card that beats the current winner
      if (onDeclSide) {
        if (OFF('third')) return R('L196', low(winners));
        // card counting: the fourth hand known void wins nothing (unless it ruffs); the second hand showed out, so the
        // fourth hand holds every unseen card and a finesse can't work; otherwise finesse only against one missing card
        const fourth = nextSeat(seat), second = trick.cards[1].seat;
        if (voidIn(fourth, led)) {
          if (trump && led !== trump && oppTrumpsLeft() && !voidIn(fourth, trump)) return R('3rdRuffed', low(follow));
          return R('3rdVoid', low(winners));
        }
        const k = x => unseenAbove(x).length, kmin = Math.min(...winners.map(k));
        const lim = voidIn(second, led) || (kmin === 0 && !OFF('3safe') && (() => { const q = suitCount(); return q.sure >= q.need; })()) ? kmin : Math.max(1, kmin);
        return R(lim > kmin ? '3rdFin' : '3rdTop', low(winners.filter(x => k(x) <= lim)));
      }
      // defender third hand: high, but cheapest of equals
      const top = high(winners);
      const seq = follow.filter(x => rankOf(x) <= rankOf(top) && rankOf(x) >= rankOf(winCard) && unseenAbove(x).filter(u => rankOf(u) < rankOf(top)).length === 0 && beats(x));
      return R('L201', seq.length ? low(seq) : top);
    };
    const rc = followRule(), rwhy = botWhy;
    if (follow.length < 2 || OFF('flfit')) return R(rwhy, rc);
    // the fitted choice among a few candidate cards (flF, BOT_FOLLOW_W): the rule's card, low, the cheapest winner,
    // the cheapest sure winner, high; equal cards (no unseen card between them) count once, as the lowest
    const equal = (x, y) => { const lo = Math.min(rankOf(x), rankOf(y)), hi = Math.max(rankOf(x), rankOf(y)); for (let r = lo + 1; r < hi; r++) if (!known.has(led + RANKS[r]) || (!onDeclSide && dummyCards.includes(led + RANKS[r])) || (onDeclSide && pCards.includes(led + RANKS[r]))) return false; return true; };
    const sureW = winners.filter(x => sureWin(x));
    const opts = [];
    for (const x of [rc, low(follow), winners.length ? low(winners) : null, sureW.length ? low(sureW) : null, high(follow)]) {
      if (!x) continue;
      const lowest = follow.filter(y => equal(x, y)).reduce((m, y) => rankOf(y) < rankOf(m) ? y : m, x);
      const pick = x === rc ? rc : lowest;
      if (!opts.some(o => o === pick || (o !== rc && equal(o, pick)) || (o === rc && pick !== rc && equal(o, pick)))) opts.push(pick);
    }
    const group = (onDeclSide ? 'decl' : 'def') + pos + (trump ? 's' : 'n');
    if (want === 'follow') return opts.length > 1 ? { group, opts: opts.map(x => ({ f: flF(x, rc, sureW), card: x })) } : null;
    const W = BOT_FOLLOW_W[group];
    if (!W || opts.length < 2) return R(rwhy, rc);
    let best = rc, bs = -1e9;
    for (const x of opts) { const v = flF(x, rc, sureW).reduce((acc, f, i) => acc + f * W[i], 0); if (v > bs + 1e-9) { bs = v; best = x; } }
    return best === rc ? R(rwhy, rc) : R('flFit', best);
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

// ===== Claims: how robots answer them, and when robots claim =====
// A claim is judged on the actual cards. A claim of n tricks is accepted when the claimer's side takes at least n
// of the remaining tricks double dummy: whatever the opponents do, the claimer's side has a line that makes n.
// (Under Law 70 doubtful points go against the claimer; a finesse that happens to work is the doubtful case this
// doesn't catch. Robots' own claims are stricter: see robotClaimCount.)
// claimSolver is an exact double-dummy search in plain JavaScript (the server can't run the WebAssembly solver,
// and the page's is asynchronous): alpha-beta as a yes/no question ("can this side take n?"), one card of each run
// of equals, a transposition table at the start of each trick keyed by the relative order of the cards left, and a
// quick count of top winners for the side on lead. Up to 7 tricks left it always finishes within the server budget
// (p99 about 2 ms), 8 tricks 90% (p99 5 ms; tests/claimtest.js); past its node budget it answers null and the
// callers fall back to claimTopTricks.
const CL_SUIT = { S: 0, H: 1, D: 2, C: 3 }, CL_BUDGET = { budget: true };
// Node budgets (about 0.4 microseconds a node): answering a claim, and a robot deciding whether to claim (tried at
// each of its leads). The server has 10 ms of CPU for a whole request; a practice table in the page has more time.
const CLAIM_NODES = 20000, ROBOT_CLAIM_NODES = 6000;
const CLAIM_NODES_PAGE = 300000, ROBOT_CLAIM_NODES_PAGE = 30000;
const clBits = m => { m -= (m >>> 1) & 0x55555555; m = (m & 0x33333333) + ((m >>> 2) & 0x33333333); return (((m + (m >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
const clTop = m => 31 - Math.clz32(m); // highest rank in a mask, -1 if none
const clLow = m => 31 - Math.clz32(m & -m);

// The position on a table: remaining cards as rank masks h[seat * 4 + suit] (seats in SEATS order), the trump suit
// (-1 at no trumps), the leader of the trick in progress and the cards already played to it. `hands` (remaining
// cards by seat) replaces the real ones, for trying other layouts.
function claimPos(t, hands) {
  const play = t.play, c = t.contract, h = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (const x of hands ? hands[SEATS[i]] : remainingHand(t.hands, play, SEATS[i])) h[i * 4 + CL_SUIT[x[0]]] |= 1 << rankOf(x);
  const tr = play.tricks[play.tricks.length - 1], open = !!(tr && tr.cards.length < 4);
  const cur = open ? tr.cards.map(pc => [SEATS.indexOf(pc.seat), CL_SUIT[pc.card[0]], rankOf(pc.card)]) : [];
  return { h, trump: c.strain === 'N' ? -1 : CL_SUIT[c.strain], leader: SEATS.indexOf(open ? tr.leader : playTurn(play, c)), cur };
}

// side: 0 for N-S, 1 for E-W. Returns { win(n), value(), nodes() }: win(n) says whether `side` takes at least n of
// the remaining tricks (the one in progress included), value() how many it takes; both null past maxNodes.
let clTable = null;
function clTT() { // 2^16 entries, made once
  if (!clTable) { const n = 1 << 16; clTable = { K: new Int32Array(n * 4), V: new Int8Array(n * 3), G: new Int32Array(n), mask: n - 1, gen: 0 }; }
  return clTable;
}
function claimSolver(pos, side, maxNodes = CLAIM_NODES) {
  const h = Int32Array.from(pos.h), trump = pos.trump, k0 = pos.cur.length;
  // the cards of every trick on the search path (index: 4 * trick + place in the trick), and the moves tried there
  const tSeat = new Int8Array(56), tSuit = new Int8Array(56), tRank = new Int8Array(56);
  const mvBuf = new Int32Array(56 * 14), scBuf = new Int32Array(14);
  pos.cur.forEach(([s, su, r], k) => { tSeat[k] = s; tSuit[k] = su; tRank[k] = r; });
  let cards = 0; for (const m of h) cards += clBits(m);
  const L0 = (cards + k0) / 4;
  let leader = pos.leader, left = L0, nodes = 0;
  const winnerAt = b => { let w = b; for (let j = b + 1; j < b + 4; j++) if (tSuit[j] === tSuit[w] ? tRank[j] > tRank[w] : tSuit[j] === trump) w = j; return tSeat[w]; };

  // Tricks a hand can cash in a suit while it keeps the lead: its cards above every other card in the suit, and
  // all of them once the opponents are out of the suit and partner can't be forced to overtake.
  function cash(X, su) {
    const m = h[X * 4 + su]; if (!m) return 0;
    const pm = h[(X ^ 2) * 4 + su], a = h[((X + 1) & 3) * 4 + su], b = h[((X + 3) & 3) * 4 + su];
    const tops = clBits(m >>> (clTop(pm | a | b) + 1));
    return tops >= Math.max(clBits(a), clBits(b)) && (!pm || clTop(pm) < clLow(m)) ? clBits(m) : tops;
  }
  // Tricks the side on lead (L) can surely take straight off. In a trump contract where the opponents have trumps,
  // only the leader's top trumps count, plus its side winners if those top trumps draw the opponents' trumps.
  // Otherwise: the leader's winners, or the leader's winners, then a low card to partner's winners in one suit and
  // partner's winners elsewhere (when neither hand has to throw a counted winner meanwhile).
  function quick(L) {
    const P = L ^ 2;
    let oppTr = 0;
    if (trump >= 0) oppTr = Math.max(clBits(h[((L + 1) & 3) * 4 + trump]), clBits(h[((L + 3) & 3) * 4 + trump]));
    if (oppTr) {
      const m = h[L * 4 + trump], others = h[P * 4 + trump] | h[((L + 1) & 3) * 4 + trump] | h[((L + 3) & 3) * 4 + trump];
      const tops = m ? clBits(m >>> (clTop(others) + 1)) : 0;
      if (tops < oppTr) return tops;
    }
    let lc = 0; const pw = [0, 0, 0, 0];
    for (let su = 0; su < 4; su++) { lc += cash(L, su); pw[su] = cash(P, su); }
    let best = lc;
    for (let s = 0; s < 4; s++) {
      if (!pw[s] || !h[L * 4 + s] || clTop(h[L * 4 + s]) > clTop(h[P * 4 + s])) continue; // needs a low card to cross with
      let pc = 0; for (let su = 0; su < 4; su++) pc += pw[su];
      const lcs = lc - cash(L, s);
      if (lcs + pc <= left && lcs + pc > best) best = lcs + pc;
    }
    return Math.min(best, left);
  }
  // Sure tricks for side X however play goes: in a trump contract, trumps in one hand above all the other side's trumps.
  function topTrumps(X) {
    if (trump < 0) return 0;
    const opp = h[((X + 1) & 3) * 4 + trump] | h[((X + 3) & 3) * 4 + trump], hi = clTop(opp) + 1;
    return Math.max(clBits(h[X * 4 + trump] >>> hi), clBits(h[(X ^ 2) * 4 + trump] >>> hi));
  }
  // At most this many tricks for side X: a trick won in a suit uses up a card of it in each of X's hands, so no
  // more than the longer holding (plus, in a trump contract, one trick per trump X holds).
  function most(X) {
    let n = 0;
    for (let su = 0; su < 4; su++) {
      const a = clBits(h[X * 4 + su]), b = clBits(h[(X ^ 2) * 4 + su]);
      n += su === trump ? a + b : a > b ? a : b;
    }
    return n < left ? n : left;
  }
  // The transposition table (shared by all solvers, one at a time: entries of another solve count as empty). The key
  // is, suit by suit, who holds each remaining card from the top (relative ranks only), and the leader. An entry
  // holds bounds on the tricks this side takes from the position and the lead that settled it; an entry may be
  // overwritten by another position, which only loses the bounds.
  const T = clTT(), gen = T.gen = (T.gen + 1) | 0, KS = T.K, VS = T.V, GS = T.G, tmask = T.mask;
  let key0 = 0, key1 = 0, key2 = 0, key3 = 0;
  function keyOf() {
    for (let su = 0; su < 4; su++) {
      const b = h[4 + su], c = h[8 + su], d = h[12 + su];
      let v = 1;
      for (let m = h[su] | b | c | d; m;) { const r = clTop(m), bit = 1 << r; m ^= bit; v = (v << 2) | (b & bit ? 1 : c & bit ? 2 : d & bit ? 3 : 0); }
      if (su === 0) key0 = v | (leader << 28); else if (su === 1) key1 = v; else if (su === 2) key2 = v; else key3 = v;
    }
  }
  function slot() { // where the current key lives (or would): >= 0 if found, ~slot if not
    let x = Math.imul(key0 ^ Math.imul(key1, 0x9E3779B1) ^ Math.imul(key2, 0x85EBCA77) ^ Math.imul(key3, 0xC2B2AE3D), 0x27D4EB2F);
    x ^= x >>> 15;
    const i = x & tmask, j = i * 4;
    return GS[i] === gen && KS[j] === key0 && KS[j + 1] === key1 && KS[j + 2] === key2 && KS[j + 3] === key3 ? i : ~i;
  }
  function put(i, lo, hi, best) { const j = i * 4; GS[i] = gen; KS[j] = key0; KS[j + 1] = key1; KS[j + 2] = key2; KS[j + 3] = key3; VS[i * 3] = lo; VS[i * 3 + 1] = hi; VS[i * 3 + 2] = best; }
  let lastBest = -1; // the lead that settled the last trick searched from its start
  // The cards worth trying at place i of the search path (one of each run of equals), likeliest best first, into
  // mvBuf[i * 14 ...]; returns how many.
  function moves(seat, k, b, best) {
    const o0 = (b + k) * 14;
    let n = 0;
    const led = k ? tSuit[b] : -1;
    let w = b; for (let j = b + 1; j < b + k; j++) if (tSuit[j] === tSuit[w] ? tRank[j] > tRank[w] : tSuit[j] === trump) w = j;
    const partnerWins = k > 0 && (tSeat[w] & 1) === (seat & 1);
    const follow = k > 0 && h[seat * 4 + led] !== 0;
    for (let su = follow ? led : 0; su < (follow ? led + 1 : 4); su++) {
      const m = h[seat * 4 + su]; if (!m) continue;
      let others = h[((seat + 1) & 3) * 4 + su] | h[((seat + 2) & 3) * 4 + su] | h[((seat + 3) & 3) * 4 + su];
      for (let j = b; j < b + k; j++) if (tSuit[j] === su) others |= 1 << tRank[j];
      const all = others | m, top = clTop(others), pTop = clTop(h[(seat ^ 2) * 4 + su]);
      let prev = -1;
      for (let x = m; x;) {
        const r = clTop(x); x ^= 1 << r;
        if (prev >= 0 && (others & ((1 << prev) - (1 << (r + 1)))) === 0) { prev = r; continue; } // equal to the card above
        prev = r;
        const mv = (su << 4) | r;
        let s;
        if (best >= 0 && best >> 4 === su && clBits(all >>> (r + 1)) === (best & 15)) s = 1000;
        else if (!k) s = r > top ? 100 + clBits(m) : (pTop === top && top >= 0 ? 50 : 0) - r;
        else if (partnerWins) s = -r - (su === trump && su !== led ? 30 : 0) + (su !== led ? 3 * clBits(m) : 0);
        else if (su === tSuit[w] ? r > tRank[w] : su === trump) s = 60 - r;
        else s = -r - (su === trump ? 30 : 0) + (su !== led ? 3 * clBits(m) : 0);
        let i = n++;
        while (i > 0 && scBuf[i - 1] < s) { mvBuf[o0 + i] = mvBuf[o0 + i - 1]; scBuf[i] = scBuf[i - 1]; i--; }
        mvBuf[o0 + i] = mv; scBuf[i] = s;
      }
    }
    return n;
  }
  function trick(k, need, best) { // best: at the start of a trick, the lead that settled this position before
    if (++nodes > maxNodes) throw CL_BUDGET;
    const b = (L0 - left) * 4, seat = (leader + k) & 3, isMax = (seat & 1) === side, o0 = (b + k) * 14;
    const n = moves(seat, k, b, k ? -1 : best);
    if (k === 3) { // a card that ends the trick in a position whose bounds settle it
      for (let i = 0; i < n; i++) {
        const mv = mvBuf[o0 + i], su = mv >> 4, bit = 1 << (mv & 15);
        h[seat * 4 + su] ^= bit; tSeat[b + 3] = seat; tSuit[b + 3] = su; tRank[b + 3] = mv & 15;
        const w = winnerAt(b), old = leader, nd = need - ((w & 1) === side ? 1 : 0);
        leader = w; left--;
        let res = -1;
        if (nd <= 0) res = 1; else if (nd > left) res = 0;
        else if (left > 1) { keyOf(); const j = slot(); if (j >= 0) res = VS[j * 3] >= nd ? 1 : VS[j * 3 + 1] < nd ? 0 : -1; }
        leader = old; left++;
        h[seat * 4 + su] ^= bit;
        if (res === (isMax ? 1 : 0)) return isMax;
      }
    }
    for (let i = 0; i < n; i++) {
      const mv = mvBuf[o0 + i], su = mv >> 4, r = mv & 15, bit = 1 << r;
      h[seat * 4 + su] ^= bit; tSeat[b + k] = seat; tSuit[b + k] = su; tRank[b + k] = r;
      let res;
      if (k === 3) {
        const w = winnerAt(b), old = leader;
        leader = w; left--;
        res = search(need - ((w & 1) === side ? 1 : 0));
        leader = old; left++;
      } else res = trick(k + 1, need);
      h[seat * 4 + su] ^= bit;
      if (res === isMax) {
        if (!k) lastBest = (su << 4) | clBits((h[su] | h[4 + su] | h[8 + su] | h[12 + su]) >>> (r + 1));
        return res;
      }
    }
    if (!k) lastBest = -1;
    return !isMax;
  }
  function search(need) { // at the start of a trick
    if (need <= 0) return true;
    if (need > left) return false;
    if (left === 1) { // the last trick: one card each
      let w = -1, ws = 0, wr = 0;
      for (let i = 0; i < 4; i++) {
        const s = (leader + i) & 3; let su = 0; while (!h[s * 4 + su]) su++;
        const r = clTop(h[s * 4 + su]);
        if (w < 0 || (su === ws ? r > wr : su === trump)) { w = s; ws = su; wr = r; }
      }
      return (w & 1) === side;
    }
    keyOf();
    let i = slot(), lo, hi, best = -1;
    if (i >= 0) { lo = VS[i * 3]; hi = VS[i * 3 + 1]; best = VS[i * 3 + 2]; }
    else {
      const q = quick(leader), mine = (leader & 1) === side;
      lo = Math.max(mine ? q : 0, topTrumps(side), left - most(side ^ 1));
      hi = Math.min(mine ? left : left - q, left - topTrumps(side ^ 1), most(side));
      put(~i, lo, hi, -1);
    }
    if (lo >= need) return true;
    if (hi < need) return false;
    const k0_ = key0, k1 = key1, k2 = key2, k3 = key3;
    lastBest = -1;
    const res = trick(0, need, best);
    if (res) lo = need; else hi = need - 1;
    if (lastBest >= 0) best = lastBest;
    key0 = k0_; key1 = k1; key2 = k2; key3 = k3;
    i = slot();
    if (i >= 0) { lo = Math.max(lo, VS[i * 3]); hi = Math.min(hi, VS[i * 3 + 1]); } else i = ~i; // (another position may have taken the slot meanwhile)
    put(i, lo, hi, best);
    return res;
  }
  function win(n) {
    try { return n <= 0 ? true : n > L0 ? false : k0 ? trick(k0, n) : search(n); } catch (e) { if (e === CL_BUDGET) return null; throw e; }
  }
  return {
    win,
    value() {
      let lo = 0, hi = L0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1, r = win(mid); if (r === null) return null; if (r) lo = mid; else hi = mid - 1; }
      return lo;
    },
    nodes: () => nodes,
  };
}

// Does the claimer's side take at least n of the remaining tricks double dummy? null if too big to work out.
function claimHolds(t, by, n, maxNodes = CLAIM_NODES) {
  const left = 13 - completedTricks(t.play).length;
  if (n <= 0) return true;
  if (n > left) return false;
  return claimSolver(claimPos(t), SEATS.indexOf(by) & 1, maxNodes).win(n);
}
// A robot's answer to a claim of n tricks by `by`: exact when the search finishes, otherwise only a claim within
// the conservative count of sure winners is accepted. A concession of everything is always accepted.
function claimAccept(t, by, n, maxNodes = CLAIM_NODES) {
  if (n === 0) return true;
  const r = claimHolds(t, by, n, maxNodes);
  return r !== null ? r : n <= claimTopTricks(t, by);
}
// How many of the remaining tricks the claimer's side takes double dummy (the conservative count if too big).
function sureTricks(t, claimer) {
  const v = claimSolver(claimPos(t), SEATS.indexOf(claimer) & 1).value();
  return v !== null ? v : claimTopTricks(t, claimer);
}

// The claim a robot on lead at the start of a trick (seat) would make for its side, or null. It is the number of
// tricks its side takes double dummy, and only if that number doesn't depend on where the cards the robot can't
// see lie: it must hold for every way those cards could be split between the two hands it can't see (keeping
// to suits they have shown out of), so the claim needs no finesse or guess. Unseen cards next to each other in
// rank count as one group (only how many of a group each hand holds is varied). With more layouts than
// maxLayouts, or past the node budget, the robot doesn't claim.
function robotClaimCount(t, seat, maxNodes = CLAIM_NODES, maxLayouts = 120) {
  const play = t.play, c = t.contract;
  const tr = play.tricks[play.tricks.length - 1];
  if (!tr || tr.cards.length < 4) return null;
  const left = 13 - completedTricks(play).length;
  if (left < 2) return null;
  const side = SEATS.indexOf(seat) & 1;
  const S = claimSolver(claimPos(t), side, left > 8 ? Math.min(500, maxNodes) : maxNodes); // early in the play only the plainest claims
  const v = S.value();
  if (v === null) return null;
  let budget = maxNodes - S.nodes();
  const dummy = partnerOf(c.declarer);
  const hidden = SEATS.filter(s => s !== seat && s !== dummy);
  const rem = {}; for (const s of SEATS) rem[s] = remainingHand(t.hands, play, s);
  const out = { [hidden[0]]: new Set(), [hidden[1]]: new Set() }; // suits each has shown out of
  for (const x of play.tricks) for (const pc of x.cards.slice(1)) if (pc.card[0] !== x.cards[0].card[0] && out[pc.seat]) out[pc.seat].add(x.cards[0].card[0]);
  const seenCards = new Set(SEATS.filter(s => !hidden.includes(s)).flatMap(s => rem[s]));
  const pool = [...rem[hidden[0]], ...rem[hidden[1]]].sort((a, b) => SUITS.indexOf(a[0]) - SUITS.indexOf(b[0]) || rankOf(b) - rankOf(a));
  const groups = []; // runs of unseen cards with no seen card between them
  for (const x of pool) {
    const g = groups[groups.length - 1], y = g && g[g.length - 1];
    let together = !!y && y[0] === x[0];
    for (let r = rankOf(x) + 1; together && r < rankOf(y); r++) if (seenCards.has(x[0] + RANKS[r])) together = false;
    if (together) g.push(x); else groups.push([x]);
  }
  const nA = rem[hidden[0]].length, after = [];
  for (let i = groups.length - 1, n = 0; i >= 0; i--) { after[i] = n; n += groups[i].length; }
  const layouts = [];
  const pick = (gi, a, got) => { // how many of each group hidden[0] holds
    if (layouts.length > maxLayouts) return;
    if (gi === groups.length) { layouts.push(a.slice()); return; }
    const g = groups[gi], s = g[0][0];
    for (let k = 0; k <= g.length; k++) {
      if (got + k > nA || got + k + after[gi] < nA) continue;
      if ((k > 0 && out[hidden[0]].has(s)) || (k < g.length && out[hidden[1]].has(s))) continue;
      a.push(k); pick(gi + 1, a, got + k); a.pop();
    }
  };
  pick(0, [], 0);
  if (layouts.length > maxLayouts) return null;
  for (const a of layouts) {
    const hands = { ...rem, [hidden[0]]: [], [hidden[1]]: [] };
    groups.forEach((g, i) => g.forEach((x, j) => hands[j < a[i] ? hidden[0] : hidden[1]].push(x)));
    if (budget <= 0) return null;
    const L = claimSolver(claimPos(t, hands), side, budget);
    const r = L.win(v);
    budget -= L.nodes();
    if (r !== true) return null; // fails in some layout (or too big to tell): not obvious
  }
  return v;
}

// The conservative count used when the exact search is too big: winners that can't be lost (cards in the hand on
// lead, side suits only once the opponents' trumps are drawn), and nothing at all if the opponents are on lead or a
// trick is in progress. exactTricks is the plain minimax (every card tried), kept as the reference for tests.
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
function claimTopTricks(t, claimer) {
  const c = t.contract, play = t.play, hands = t.hands;
  const left = remainingHand(hands, play, claimer).length;
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
if (typeof module !== 'undefined') module.exports = { simulateBoard, botCall, botPlay, botPlayOld, botWhyLast: () => botWhy, botFeatures, botFeatureNames: k => k === "switch" ? BOT_SWITCH_NAMES : k === "lead" ? BOT_DLEAD_NAMES : k === "follow" ? BOT_FOLLOW_NAMES : BOT_DISCARD_NAMES, sureTricks, exactTricks, shown, claimSolver, claimPos, claimHolds, claimAccept, claimTopTricks, robotClaimCount };
