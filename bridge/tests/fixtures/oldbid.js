// The robots' bidding before the 2/1 rewrite (bridge/js/bots.js at commit 0485bf8), kept unchanged as the
// baseline that tests/bidddsim.js measures the current system against. Not loaded by the page or the server.
Object.assign(globalThis, require('../../js/engine.js'));
const OFF = k => ['fin', 'hold', 'second', 'trlead', 'balance'].includes(k);

function isBalanced(L) {
  const v = Object.values(L).sort((a, b) => a - b);
  return v[0] >= 2 && v[1] >= 3; // 4333, 4432, 5332
}
// What a seat has shown, read from its calls in the auction
function shown(auction, seat) {
  const info = { pts: 0, len: { S: 0, H: 0, D: 0, C: 0 }, bid: false, nt: false };
  const mine = auction.filter(a => a.by === seat);
  mine.forEach((a, k) => {
    const idx = auction.indexOf(a);
    const before = auction.slice(0, idx);
    const anyBid = before.some(b => bidValue(b.call) >= 0);
    const partnerBids = before.filter(b => b.by === partnerOf(seat) && bidValue(b.call) >= 0);
    const nb = before.length;
    const balSeat = !OFF('balance') && !info.bid && !partnerBids.length && nb >= 3 && before[nb - 1].call === 'P' && before[nb - 2].call === 'P' && (() => { const l = lastBid(before); return l && !sameSide(l.by, seat) && +l.call[0] <= 2; })();
    if (a.call === 'X') {
      const lb = lastBid(before);
      if (lb && !sameSide(lb.by, seat) && !info.bid) { info.pts = Math.max(info.pts, balSeat ? 10 : 12); SUITS.forEach(s => { if (s !== lb.call[1]) info.len[s] = Math.max(info.len[s], 3); }); }
      return;
    }
    if (bidValue(a.call) < 0) return;
    if (a.alert) {
      const m = /Transfer: 5\+ (hearts|spades)/.exec(a.alert);
      if (m) { const su = m[1] === 'hearts' ? 'H' : 'S'; info.len[su] = Math.max(info.len[su], 5); }
      if (/Stayman/.test(a.alert)) info.pts = Math.max(info.pts, 8);
      if (/Shows 4 (hearts|spades)/.test(a.alert)) { const su = /hearts/.test(a.alert) ? 'H' : 'S'; info.len[su] = Math.max(info.len[su], 4); }
      if (/Completes the transfer/.test(a.alert)) { const su = a.call[1]; info.len[su] = Math.max(info.len[su], 2); }
      info.bid = true; return;
    }
    const lvl = +a.call[0], st = a.call[1];
    const jump = +a.call[0] > cheapest(before, a.call[1]);
    if (!anyBid) { // opening
      if (st === 'N') { info.pts = lvl === 1 ? 16 : lvl === 2 ? 20 : 25; info.nt = true; SUITS.forEach(s => info.len[s] = Math.max(info.len[s], 2)); }
      else if (a.call === '2C') info.pts = 22;
      else if (lvl === 1) { info.pts = 13; info.len[st] = Math.max(info.len[st], (st === 'S' || st === 'H') ? 5 : 3); }
      else { info.pts = 8; info.len[st] = Math.max(info.len[st], lvl === 2 ? 6 : 7); }
    } else if (st === 'N') {
      info.nt = true; SUITS.forEach(s => info.len[s] = Math.max(info.len[s], 2));
      const firstBid = before.find(b => bidValue(b.call) >= 0);
      const oppOpened = firstBid && !sameSide(firstBid.by, seat) && !info.bid && !partnerBids.length;
      const pNT = partnerBids.length && partnerBids[0].call[1] === 'N';
      info.pts = Math.max(info.pts, oppOpened ? (balSeat ? 11 : 16) : pNT ? (lvl <= 2 ? 8 : 10) : lvl === 1 ? 8 : lvl === 2 ? 11 : 13);
    } else if (a.call === '2D' && partnerBids.length === 1 && partnerBids[0].call === '2C' && !info.bid) {
      info.pts = 0;
    } else {
      const supports = partnerBids.some(b => b.call[1] === st);
      if (supports) { info.len[st] = Math.max(info.len[st], 3); info.pts = Math.max(info.pts, jump ? 11 : 7); }
      else {
        const rebid = mine.slice(0, k).some(b => bidValue(b.call) >= 0 && b.call[1] === st);
        info.len[st] = Math.max(info.len[st], rebid ? 6 : (partnerBids.length ? 4 : 5));
        info.pts = Math.max(info.pts, partnerBids.length ? (lvl >= 2 && !rebid ? 11 : 7) : (info.bid ? info.pts : balSeat ? 7 : 10));
      }
    }
    info.bid = true;
  });
  return info;
}

function cheapest(auction, strain) {
  const lb = lastBid(auction);
  const v = lb ? bidValue(lb.call) : -1;
  for (let lvl = 1; lvl <= 7; lvl++) if (bidValue(lvl + strain) > v) return lvl;
  return 8;
}
function longestSuit(L, exclude = []) {
  let best = null;
  for (const s of ['S', 'H', 'D', 'C']) if (!exclude.includes(s) && (!best || L[s] > L[best])) best = s;
  return best;
}


// ---- Conventions: 1NT/2NT system (Stayman, Jacoby transfers, quantitative 4NT) and Blackwood ----
const ALERTS = {
  stayman: 'Stayman: asks for a 4-card major',
  trH: 'Transfer: 5+ hearts', trS: 'Transfer: 5+ spades',
  noMajor: 'No 4-card major', showH: 'Shows 4 hearts', showS: 'Shows 4 spades, denies 4 hearts',
  complete: 'Completes the transfer', quant: 'Quantitative: invites 6NT',
  rkc: 'Blackwood: asks for aces',
  bw0: 'Blackwood reply: 0 or 4 aces', bw1: 'Blackwood reply: 1 ace', bw2: 'Blackwood reply: 2 aces', bw3: 'Blackwood reply: 3 aces',
};
const say = (call, key) => ({ call, alert: ALERTS[key] });
function ourSeq(auction, seat) {
  // our side's calls in order, plus whether the opponents have stayed silent since our opening
  const first = auction.find(a => bidValue(a.call) >= 0);
  if (!first || !sameSide(first.by, seat)) return null;
  const idx = auction.indexOf(first);
  const after = auction.slice(idx);
  if (after.some(a => !sameSide(a.by, seat) && a.call !== 'P')) return null;
  return { opener: first.by, calls: after.filter(a => sameSide(a.by, seat)) };
}
function ntSystem(hand, seat, auction) {
  const q = ourSeq(auction, seat);
  if (!q) return null;
  const open = q.calls[0];
  if (open.call !== '1N' && open.call !== '2N') return null;
  const one = open.call === '1N';
  const H = hcp(hand), L = suitLengths(hand);
  const isOpener = q.opener === seat;
  const k = q.calls.length; // number of our-side calls so far
  const c = i => q.calls[i] ? q.calls[i].call : null;
  const lvl = one ? 2 : 3;
  const inv = one ? [8, 9] : [4, 4], gf = one ? 10 : 5; // responder ranges vs 1NT/2NT
  if (!isOpener && k === 1) {
    if (L.S >= 5 && L.S >= L.H) return say(lvl + 'H', 'trS');
    if (L.H >= 5) return say(lvl + 'D', 'trH');
    if ((L.H === 4 || L.S === 4) && H >= inv[0]) return say(lvl + 'C', 'stayman');
    if (H < inv[0]) return 'P';
    if (H <= inv[1]) return one ? '2N' : 'P';
    if (H >= (one ? 18 : 13)) return one ? '6N' : '6N';
    if (H >= (one ? 16 : 11)) return say('4N', 'quant');
    return '3N';
  }
  if (isOpener && k === 2) {
    const r = c(1), oH = hcp(hand);
    if (r === lvl + 'D') return (one && L.H >= 4 && oH >= 17) ? say('3H', 'complete') : say(lvl + 'H', 'complete');
    if (r === lvl + 'H') return (one && L.S >= 4 && oH >= 17) ? say('3S', 'complete') : say(lvl + 'S', 'complete');
    if (r === lvl + 'C') return L.H >= 4 ? say(lvl + 'H', 'showH') : L.S >= 4 ? say(lvl + 'S', 'showS') : say(lvl + 'D', 'noMajor');
    if (r === '2N') return oH >= 17 ? '3N' : 'P';
    if (r === '4N') return oH >= (one ? 17 : 21) ? '6N' : 'P';
    if (one && (r === '3H' || r === '3S')) return L[r[1]] >= 3 ? '4' + r[1] : '3N'; // game-forcing: pick the game
    return 'P';
  }
  if (!isOpener && k === 3) {
    const r1 = c(1), o2 = c(2);
    const tr = r1 === lvl + 'D' ? 'H' : r1 === lvl + 'H' ? 'S' : null;
    if (tr) {
      const len = L[tr], sup = +o2[0] === 3 && one; // super-accept
      const x = H + (sup ? 2 : 0);
      if (x < inv[0]) return 'P';
      if (x <= inv[1]) return len >= 6 ? (o2 === '3' + tr ? 'P' : '3' + tr) : (sup ? 'P' : (one ? '2N' : 'P'));
      if (x >= (one ? 16 : 11)) return len >= 6 ? say('4N', 'rkc') : '6N';
      return len >= 6 ? '4' + tr : '3N';
    }
    if (r1 === lvl + 'C') {
      const shown = o2[1];
      if ((shown === 'H' && L.H >= 4) || (shown === 'S' && L.S >= 4)) {
        if (H <= inv[1]) return '3' + shown;
        if (H >= (one ? 16 : 11)) return say('4N', 'rkc');
        return '4' + shown;
      }
      if (H <= inv[1]) return one ? '2N' : 'P';
      return '3N';
    }
    return null;
  }
  if (isOpener && k === 4) {
    const r1 = c(1), r3 = c(3);
    const tr = r1 === lvl + 'D' ? 'H' : r1 === lvl + 'H' ? 'S' : null;
    const oH = hcp(hand);
    if (tr) {
      if (r3 === '2N') return oH >= 17 ? (L[tr] >= 3 ? '4' + tr : '3N') : (L[tr] >= 3 ? '3' + tr : 'P');
      if (r3 === '3N') return L[tr] >= 3 ? '4' + tr : 'P';
      if (r3 === '3' + tr) return oH >= 16 ? '4' + tr : 'P';
    }
    if (r1 === lvl + 'C') {
      if (r3 === '2N') return oH >= 17 ? '3N' : 'P';
      if (r3 && r3[0] === '3' && (r3[1] === 'H' || r3[1] === 'S')) return oH >= 16 ? '4' + r3[1] : 'P';
      if (r3 === '3N' && c(2) === '2H' && L.S >= 4) return '4S'; // responder had spades
    }
    return null;
  }
  return null;
}
function blackwood(hand, seat, auction) {
  const mine = auction.filter(a => sameSide(a.by, seat) && a.call !== 'P');
  const last = mine[mine.length - 1];
  if (!last) return null;
  const aces = hand.filter(x => x[1] === 'A').length;
  // partner asked: answer
  if (last.by === partnerOf(seat) && last.call === '4N' && last.alert === ALERTS.rkc) {
    return [say('5C', 'bw0'), say('5D', 'bw1'), say('5H', 'bw2'), say('5S', 'bw3'), say('5C', 'bw0')][aces];
  }
  // I asked: place the contract
  const prev = mine[mine.length - 2];
  if (last.by === partnerOf(seat) && prev && prev.by === seat && prev.call === '4N' && prev.alert === ALERTS.rkc && /^5[CDHS]$/.test(last.call)) {
    let theirs = { C: 0, D: 1, H: 2, S: 3 }[last.call[1]];
    if (theirs === 0 && aces === 0) theirs = 4;
    const total = aces + theirs;
    // trump suit: longest suit we've both shown, else NT
    const suits = mine.filter(a => /^[1-7][CDHS]$/.test(a.call) && !a.alert).map(a => a.call[1]);
    const L = suitLengths(hand);
    let tr = suits.filter(x => L[x] >= 3).pop() || ['S', 'H'].find(x => L[x] >= 5) || 'N';
    const legal = c => bidValue(c) > bidValue(last.call);
    if (total <= 2) { const so = '5' + tr; return legal(so) ? so : (legal('5N') ? '5N' : 'P'); }
    if (total === 3) return '6' + tr;
    return '6' + tr;
  }
  return null;
}
function asCall(x) { return typeof x === 'string' ? { call: x } : x; }

function botCall(hand, seat, dealer, auction) {
  const legal0 = legalCalls(dealer, auction);
  for (const f of [blackwood, ntSystem]) {
    const r = f(hand, seat, auction);
    if (r) { const rc = asCall(r); if (legal0.includes(rc.call)) return rc; }
  }
  const nat = botCallNatural(hand, seat, dealer, auction);
  if (nat === 'BW') return say('4N', 'rkc');
  return { call: legal0.includes(nat) ? nat : 'P' };
}
function botCallNatural(hand, seat, dealer, auction) {
  const H = hcp(hand), L = suitLengths(hand), bal = isBalanced(L);
  const legal = legalCalls(dealer, auction);
  const ok = c => legal.includes(c) ? c : 'P';
  const p = partnerOf(seat);
  const anyBid = auction.some(a => bidValue(a.call) >= 0);
  const lb = lastBid(auction);
  const myCalls = auction.filter(a => a.by === seat);
  const iBid = myCalls.some(a => a.call !== 'P');
  const pInfo = shown(auction, p);
  const oppBidSuits = auction.filter(a => !sameSide(a.by, seat) && bidValue(a.call) >= 0 && a.call[1] !== 'N').map(a => a.call[1]);

  // --- Opening ---
  if (!anyBid) {
    if (bal && H >= 15 && H <= 17) return '1N';
    if (bal && H >= 20 && H <= 21) return '2N';
    if (H >= 22) return '2C';
    const two = Object.values(L).sort((a, b) => b - a);
    if (H >= 12 || (H >= 10 && H + two[0] + two[1] >= 20)) {
      if (L.S >= 5 && L.S >= L.H) return '1S';
      if (L.H >= 5) return '1H';
      if (L.D > L.C || (L.D === 4 && L.C === 4)) return '1D';
      return '1C';
    }
    for (const s of ['S', 'H', 'D']) if (L[s] === 6 && H >= 5 && H <= 10) return ok('2' + s);
    for (const s of ['S', 'H', 'D', 'C']) if (L[s] >= 7 && H >= 5 && H <= 10) return ok('3' + s);
    return 'P';
  }

  // --- Opponents opened, our side silent: overcall / takeout double / 1NT ---
  if (!iBid && !pInfo.bid && lb && !sameSide(lb.by, seat)) {
    const their = lb.call[1];
    // balancing seat: passing now would end the auction, so compete with lighter values
    const n = auction.length;
    const balancing = n >= 3 && auction[n - 1].call === 'P' && auction[n - 2].call === 'P' && +lb.call[0] <= 2;
    if (balancing && !OFF('balance')) {
      if (H >= 10 && their !== 'N' && L[their] <= 1 && +lb.call[0] <= 2) return ok('X');
      const sb = longestSuit(L, oppBidSuits);
      if (L[sb] >= 5 && H >= 7 && cheapest(auction, sb) === 1) return ok('1' + sb);
      return 'P';
    }
    if (bal && H >= 15 && H <= 18 && cheapest(auction, 'N') === 1) return ok('1N');
    if (H >= 12 && their !== 'N' && L[their] <= 1 && +lb.call[0] <= 2) return ok('X');
    const s = longestSuit(L, oppBidSuits);
    if (L[s] >= 5 && H >= 8 && H <= 17) {
      const lvl = cheapest(auction, s);
      if (lvl === 1 || (lvl === 2 && H >= 11 && L[s] >= 5)) return ok(lvl + s);
    }
    if (L[s] >= 6 && H >= 5 && H <= 10 && cheapest(auction, s) <= 2) return ok(cheapest(auction, s) + s);
    return 'P';
  }

  // --- Partner made a takeout double, we must answer ---
  const pLast = [...auction].reverse().find(a => a.by === p);
  const rhoLast = auction[auction.length - 1];
  if (pLast && pLast.call === 'X' && !iBid && rhoLast && rhoLast.call === 'P') {
    const their = lb.call[1];
    const s = longestSuit(L, oppBidSuits.concat(L.S + L.H >= 4 ? [] : []));
    const major = ['S', 'H'].filter(x => x !== their && L[x] >= 4).sort((a, b) => L[b] - L[a])[0];
    const pick = major || s;
    let lvl = cheapest(auction, pick);
    if (H >= 9 && lvl < 4) lvl++;
    if (H >= 9 && L[their] >= 4 && bal && cheapest(auction, 'N') <= 2) return ok(cheapest(auction, 'N') + 'N');
    return ok(lvl + pick);
  }

  // --- Partner's penalty double of their contract: leave it in ---
  if (!OFF('pendbl') && pLast && pLast.call === 'X' && lb && !sameSide(lb.by, seat) && +lb.call[0] >= 3 && (iBid || pInfo.bid)) {
    const lnp = lastNonPass(auction);
    if (lnp && lnp.by === p && lnp.call === 'X') return 'P';
  }
  // --- Constructive bidding once partner has bid ---
  if (pInfo.bid) {
    // first response to a 1-level suit opening
    const pOpened = auction.find(a => bidValue(a.call) >= 0);
    if (!iBid && pOpened.by === p && lb === pOpened && /^1[CDHS]$/.test(pOpened.call)) {
      const ps = pOpened.call[1], major = ps === 'H' || ps === 'S';
      if (H < 6) return 'P';
      const support = major ? L[ps] >= 3 : L[ps] >= 5;
      if (support && major) {
        if (H <= 9) return ok('2' + ps);
        if (H <= 12) return ok('3' + ps);
        return ok('4' + ps);
      }
      // new suit at the 1 level (4+ cards, majors up the line)
      for (const s of ['H', 'S']) if (s !== ps && L[s] >= 4 && legal.includes('1' + s) && (s === 'H' ? L.H >= L.S : true)) return '1' + s;
      if (L.D >= 4 && ps === 'C' && legal.includes('1D') && H < 11) return '1D';
      if (support) return ok(H <= 9 ? '2' + ps : H <= 12 ? '3' + ps : '3N');
      if (H >= 13 && bal) return ok('3N');
      const s = longestSuit(L, [ps]);
      if (H >= 11 && L[s] >= 4 && legal.includes('2' + s)) return '2' + s;
      if (H >= 11 && bal) return ok('2N');
      return ok('1N');
    }
    if (!iBid && pInfo.pts === 22 && lb && lb.by === p && lb.call === '2C') return ok('2D');

    // general: decide strain and level from combined strength
    const shortPts = Math.min(3, Object.values(L).reduce((t, n) => t + (n === 0 ? 3 : n === 1 ? 2 : n === 2 ? 1 : 0), 0));
    let fitSuit = null, fitLen = 0;
    for (const s of ['S', 'H', 'D', 'C']) {
      const f = L[s] + pInfo.len[s];
      if (pInfo.len[s] >= 3 && f >= 8 && (f > fitLen || (f === fitLen && (s === 'S' || s === 'H')))) { fitSuit = s; fitLen = f; }
    }
    const majorFit = fitSuit === 'S' || fitSuit === 'H';
    const total = H + pInfo.pts + (fitSuit ? shortPts : 0);
    let strain;
    if (majorFit) strain = fitSuit;
    else if (pInfo.nt || bal || !fitSuit) strain = 'N';
    else strain = fitSuit;
    // without a fit and no NT stoppers story, show a long suit of our own
    if (!fitSuit && !pInfo.nt && !bal && L[longestSuit(L)] >= 6) strain = longestSuit(L);
    const targetFor = st => {
      if (st === 'N') return total >= 37 ? 7 : total >= 33 ? 6 : total >= 25 ? 3 : total >= 23 ? 2 : 1;
      if (st === 'S' || st === 'H') return total >= 37 ? 7 : total >= 34 ? 6 : total >= 26 ? 4 : total >= 23 ? 3 : 2;
      return total >= 37 ? 7 : total >= 34 ? 6 : total >= 29 ? 5 : total >= 23 ? 3 : 2;
    };
    let target = targetFor(strain);
    const ours = lb && sameSide(lb.by, seat);
    if (ours && lb.call[1] === strain && +lb.call[0] >= target) return 'P';
    // if partner already sits in a reasonable game, leave it
    if (ours && lb.by === p && +lb.call[0] >= target && total < 33) return 'P';
    if (ours && total < 23 && myCalls.filter(a => a.call !== 'P').length >= 1) {
      // part score: correct to fit if not already there, else pass
      if (fitSuit && lb.call[1] !== fitSuit && lb.call[1] !== 'N' && cheapest(auction, fitSuit) <= 2) return ok(cheapest(auction, fitSuit) + fitSuit);
      return 'P';
    }
    const lvl = cheapest(auction, strain);
    const askedBW = auction.some(a => sameSide(a.by, seat) && a.call === '4N');
    if (target >= 6 && strain !== 'N' && !askedBW && bidValue('4N') > (lb ? bidValue(lb.call) : -1)) return 'BW';
    if (lvl <= target) return ok(target + strain);
    // penalty double: they have competed too high against our values
    if (!OFF('pendbl') && !ours && lb && +lb.call[0] >= 3 && legal.includes('X')) {
      const their = lb.call[1], hon = hand.filter(x => x[0] === their && 'AKQJT'.includes(x[1])).length;
      const ourPts = H + pInfo.pts;
      const trumpsOK = their === 'N' ? H >= 11 : (L[their] >= 4 && hon >= 1) || (L[their] >= 3 && hon >= 2);
      if (ourPts >= 19 && trumpsOK && !(fitSuit && fitLen >= 10)) return 'X';
    }
    // opponents outbid us: compete one level with a 9-card fit
    if (!ours && fitSuit && fitLen >= 9 && cheapest(auction, fitSuit) <= Math.min(target + 1, 4)) return ok(cheapest(auction, fitSuit) + fitSuit);
    return 'P';
  }

  return 'P';
}

module.exports = { botCall, shown };
