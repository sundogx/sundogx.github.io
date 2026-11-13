// GENERATED from bridge.html. Rules engine, robots and table actions shared with the website.
// The server runs these exact functions, so both versions follow the same rules.

let me = { id: '', name: '' };
let lastError = null;
const toast = msg => { lastError = msg; };
const rid = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
export function setMe(m) { me = { id: m.id || '', name: m.name || '' }; lastError = null; }
export function fail(msg) { toast(msg); return false; }
export function takeError() { const e = lastError; lastError = null; return e; }


// ===== Bridge rules engine (pure, no DOM) =====
const SEATS = ['N', 'E', 'S', 'W'];
const SEAT_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
const SUITS = ['S', 'H', 'D', 'C'];           // display order
const STRAINS = ['C', 'D', 'H', 'S', 'N'];    // bidding order
const RANKS = '23456789TJQKA';
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣', N: 'NT' };
const VUL_TABLE = ['None','NS','EW','Both','NS','EW','Both','None','EW','Both','None','NS','Both','None','NS','EW'];

const nextSeat = s => SEATS[(SEATS.indexOf(s) + 1) % 4];
const partnerOf = s => SEATS[(SEATS.indexOf(s) + 2) % 4];
const sideOf = s => (s === 'N' || s === 'S') ? 'NS' : 'EW';
const sameSide = (a, b) => sideOf(a) === sideOf(b);
const suitOf = c => c[0];
const rankOf = c => RANKS.indexOf(c[1]);
const rankLabel = r => (r === 'T' ? '10' : r);

function boardDealer(n) { return SEATS[(n - 1) % 4]; }
function boardVul(n) { return VUL_TABLE[(n - 1) % 16]; }
function isVul(vul, seat) { return vul === 'Both' || vul === sideOf(seat); }

function sortHand(cards) {
  return cards.slice().sort((a, b) => {
    const sa = SUITS.indexOf(suitOf(a)), sb = SUITS.indexOf(suitOf(b));
    return sa !== sb ? sa - sb : rankOf(b) - rankOf(a);
  });
}

function seededRand(str) { // sfc32 with a 128-bit state, seeded from a string (cyrb128 hash)
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ h1 >>> 18, 597399067); h2 = Math.imul(h4 ^ h2 >>> 22, 2869860233);
  h3 = Math.imul(h1 ^ h3 >>> 17, 951274213); h4 = Math.imul(h2 ^ h4 >>> 19, 2716044179);
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
function deal(rand = Math.random) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(s + r);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = {};
  SEATS.forEach((s, i) => { hands[s] = sortHand(deck.slice(i * 13, i * 13 + 13)); });
  return hands;
}

function hcp(cards) {
  const v = { A: 4, K: 3, Q: 2, J: 1 };
  return cards.reduce((t, c) => t + (v[c[1]] || 0), 0);
}
function suitLengths(cards) {
  const L = { S: 0, H: 0, D: 0, C: 0 };
  cards.forEach(c => L[suitOf(c)]++);
  return L;
}

// ---- Auction ----
function bidValue(call) { // '1C' -> 0 ... '7N' -> 34; non-bids -> -1
  if (!/^[1-7][CDHSN]$/.test(call)) return -1;
  return (+call[0] - 1) * 5 + STRAINS.indexOf(call[1]);
}
function lastBid(auction) {
  for (let i = auction.length - 1; i >= 0; i--) if (bidValue(auction[i].call) >= 0) return auction[i];
  return null;
}
function lastNonPass(auction) {
  for (let i = auction.length - 1; i >= 0; i--) if (auction[i].call !== 'P') return auction[i];
  return null;
}
function auctionTurn(dealer, auction) {
  let s = dealer;
  for (let i = 0; i < auction.length; i++) s = nextSeat(s);
  return s;
}
function auctionOver(auction) {
  const n = auction.length;
  if (n < 4) return false;
  const last3Pass = auction.slice(-3).every(a => a.call === 'P');
  if (!last3Pass) return false;
  return n >= 4; // either 4 passes or bid followed by 3 passes
}
function legalCalls(dealer, auction) {
  const seat = auctionTurn(dealer, auction);
  const calls = ['P'];
  const lb = lastBid(auction);
  const start = lb ? bidValue(lb.call) + 1 : 0;
  for (let v = start; v < 35; v++) calls.push(`${Math.floor(v / 5) + 1}${STRAINS[v % 5]}`);
  const lnp = lastNonPass(auction);
  if (lnp && !sameSide(lnp.by, seat)) {
    if (bidValue(lnp.call) >= 0) calls.push('X');
    if (lnp.call === 'X') calls.push('XX');
  }
  return calls;
}
function isLegalCall(dealer, auction, call) {
  return legalCalls(dealer, auction).includes(call);
}
function finalContract(auction) {
  const lb = lastBid(auction);
  if (!lb) return null; // passed out
  const idx = auction.lastIndexOf(lb);
  let doubled = 0;
  for (let i = idx + 1; i < auction.length; i++) {
    if (auction[i].call === 'X') doubled = 1;
    if (auction[i].call === 'XX') doubled = 2;
  }
  const strain = lb.call[1];
  const side = sideOf(lb.by);
  const declarer = auction.find(a => bidValue(a.call) >= 0 && a.call[1] === strain && sideOf(a.by) === side).by;
  return { level: +lb.call[0], strain, doubled, declarer };
}
function contractText(c) {
  if (!c) return 'Passed out';
  return `${c.level}${SYM[c.strain]}${c.doubled === 1 ? 'X' : c.doubled === 2 ? 'XX' : ''} by ${SEAT_NAME[c.declarer]}`;
}
function callText(call) {
  if (call === 'P') return 'Pass';
  if (call === 'X') return 'X';
  if (call === 'XX') return 'XX';
  return call[0] + SYM[call[1]];
}

// ---- Play ----
// play state lives in table.play = { tricks: [{leader, cards:[{seat,card}]}] }
function trickWinner(trick, strain) {
  const led = suitOf(trick.cards[0].card);
  let best = trick.cards[0];
  for (const pc of trick.cards.slice(1)) {
    const s = suitOf(pc.card), bs = suitOf(best.card);
    if (s === bs) { if (rankOf(pc.card) > rankOf(best.card)) best = pc; }
    else if (strain !== 'N' && s === strain) best = pc;
  }
  return best.seat;
}
function playedCards(play) {
  const set = new Set();
  play.tricks.forEach(t => t.cards.forEach(pc => set.add(pc.card)));
  return set;
}
function remainingHand(hands, play, seat) {
  const used = playedCards(play);
  return hands[seat].filter(c => !used.has(c));
}
function currentTrick(play) {
  const t = play.tricks[play.tricks.length - 1];
  return t && t.cards.length < 4 ? t : null;
}
function completedTricks(play) {
  return play.tricks.filter(t => t.cards.length === 4);
}
function playTurn(play, contract) {
  const t = play.tricks[play.tricks.length - 1];
  if (!t) return nextSeat(contract.declarer);
  if (t.cards.length < 4) {
    const lastSeat = t.cards.length ? t.cards[t.cards.length - 1].seat : null;
    return lastSeat ? nextSeat(lastSeat) : t.leader;
  }
  return trickWinner(t, contract.strain);
}
function legalPlays(hands, play, contract, seat) {
  const hand = remainingHand(hands, play, seat);
  const t = currentTrick(play);
  if (!t || t.cards.length === 0) return hand;
  const led = suitOf(t.cards[0].card);
  const follow = hand.filter(c => suitOf(c) === led);
  return follow.length ? follow : hand;
}
function applyPlay(play, contract, seat, card) {
  let t = currentTrick(play);
  if (!t) { t = { leader: seat, cards: [] }; play.tricks.push(t); }
  t.cards.push({ seat, card });
  return t.cards.length === 4 ? trickWinner(t, contract.strain) : null;
}
function tricksWon(play, contract) {
  let decl = 0, def = 0;
  for (const t of completedTricks(play)) {
    if (sameSide(trickWinner(t, contract.strain), contract.declarer)) decl++; else def++;
  }
  return { decl, def };
}

// ---- Scoring (duplicate) ----
// returns score from the declaring side's perspective
function scoreContract(c, tricks, vul) {
  const v = isVul(vul, c.declarer);
  const need = c.level + 6;
  const mult = c.doubled === 2 ? 4 : c.doubled === 1 ? 2 : 1;
  if (tricks >= need) {
    const per = (c.strain === 'C' || c.strain === 'D') ? 20 : 30;
    let trickScore = c.level * per + (c.strain === 'N' ? 10 : 0);
    trickScore *= mult;
    let score = trickScore;
    score += trickScore >= 100 ? (v ? 500 : 300) : 50;
    if (c.level === 6) score += v ? 750 : 500;
    if (c.level === 7) score += v ? 1500 : 1000;
    if (c.doubled === 1) score += 50;
    if (c.doubled === 2) score += 100;
    const over = tricks - need;
    if (c.doubled === 0) score += over * per;
    else score += over * (v ? 200 : 100) * (c.doubled === 2 ? 2 : 1);
    return score;
  }
  const down = need - tricks;
  if (c.doubled === 0) return -down * (v ? 100 : 50);
  let pen = 0;
  for (let i = 1; i <= down; i++) {
    if (v) pen += i === 1 ? 200 : 300;
    else pen += i === 1 ? 100 : i <= 3 ? 200 : 300;
  }
  if (c.doubled === 2) pen *= 2;
  return -pen;
}
function scoreNS(c, tricks, vul) {
  if (!c) return 0;
  const s = scoreContract(c, tricks, vul);
  return sideOf(c.declarer) === 'NS' ? s : -s;
}
function resultText(c, tricks) {
  if (!c) return 'Passed out';
  const d = tricks - (c.level + 6);
  return d === 0 ? '=' : d > 0 ? `+${d}` : `${d}`;
}
// IMP conversion table (for comparing against par/other results later)
const IMP_STEPS = [20,50,90,130,170,220,270,320,370,430,500,600,750,900,1100,1300,1500,1750,2000,2250,2500,3000,3500,4000];
function toImps(diff) {
  const a = Math.abs(diff); let i = 0;
  while (i < IMP_STEPS.length && a >= IMP_STEPS[i]) i++;
  return diff < 0 ? -i : i;
}





// ===== Robots: simple natural bidding (SAYC-flavoured) and heuristic card play =====


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
    if (a.call === 'X') {
      const lb = lastBid(before);
      if (lb && !sameSide(lb.by, seat) && !info.bid) { info.pts = Math.max(info.pts, 12); SUITS.forEach(s => { if (s !== lb.call[1]) info.len[s] = Math.max(info.len[s], 3); }); }
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
      info.pts = Math.max(info.pts, oppOpened ? 16 : pNT ? (lvl <= 2 ? 8 : 10) : lvl === 1 ? 8 : lvl === 2 ? 11 : 13);
    } else if (a.call === '2D' && partnerBids.length === 1 && partnerBids[0].call === '2C' && !info.bid) {
      info.pts = 0;
    } else {
      const supports = partnerBids.some(b => b.call[1] === st);
      if (supports) { info.len[st] = Math.max(info.len[st], 3); info.pts = Math.max(info.pts, jump ? 11 : 7); }
      else {
        const rebid = mine.slice(0, k).some(b => bidValue(b.call) >= 0 && b.call[1] === st);
        info.len[st] = Math.max(info.len[st], rebid ? 6 : (partnerBids.length ? 4 : 5));
        info.pts = Math.max(info.pts, partnerBids.length ? (lvl >= 2 && !rebid ? 11 : 7) : (info.bid ? info.pts : 10));
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
    // opponents outbid us: compete one level with a 9-card fit
    if (!ours && fitSuit && fitLen >= 9 && cheapest(auction, fitSuit) <= Math.min(target + 1, 4)) return ok(cheapest(auction, fitSuit) + fitSuit);
    return 'P';
  }

  return 'P';
}

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


const BOT_DEFAULT_OFF = ['fin', 'hold', 'second']; // measured as neutral or harmful in self-play
const OFF = k => ((typeof globalThis !== 'undefined' && globalThis.BOT_OFF) || BOT_DEFAULT_OFF).includes(k);
// ---- Card play v2: finesses, hold-ups, covering honours, ruffing in the short hand, signals ----
function botPlay(t, seat) {
  const c = t.contract, play = t.play, hands = t.hands;
  const trump = c.strain === 'N' ? null : c.strain;
  const legal = legalPlays(hands, play, c, seat);
  if (legal.length === 1) return legal[0];
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

  // ---------- leading ----------
  if (!trick || trick.cards.length === 0) {
    if (play.tricks.length === 0 && !onDeclSide) return botPlayOld(t, seat); // opening lead heuristics
    if (onDeclSide) {
      const other = pCards;
      const masters = legal.filter(isMaster);
      if (trump) {
        const opp = oppTrumpsLeft();
        const myT = of(my, trump).length, otT = of(other, trump).length;
        // ruff losers in the short trump hand before drawing trumps
        if (!OFF('ruff') && opp && otT > 0 && otT < myT) {
          for (const s of SUITS) if (s !== trump && of(other, s).length === 0 && of(my, s).length && !of(my, s).every(isMaster)) return low(of(my, s));
        }
        if (opp && myT) { const tm = of(legal, trump); const m = tm.filter(isMaster); return m.length ? high(m) : low(tm); }
        if (opp && !myT && otT) {
          // get to the other hand to draw trumps: lead a suit where partner has a master
          for (const s of SUITS) if (of(my, s).length && of(other, s).some(isMaster)) return low(of(my, s));
        }
      }
      // NT / trumps drawn: cash established winners in a suit where we keep the lead or unblock the short hand
      if (!OFF('unblock')) for (const s of SUITS) {
        const mine = of(my, s), oth = of(other, s);
        if (!mine.length) continue;
        const mm = mine.filter(isMaster);
        if (mm.length && (mine.length <= oth.length ? true : mm.length === mine.length || !oth.some(isMaster))) {
          // play from the short hand first (unblock)
          if (mine.length <= oth.length || !oth.length) return high(mm);
        }
      }
      // finesse: lead low toward a tenace in the other hand (e.g. AQ, KJ)
      if (!OFF('fin')) for (const s of SUITS) {
        const mine = of(my, s), oth = of(other, s).sort((a, b) => rankOf(b) - rankOf(a));
        if (!mine.length || oth.length < 2) continue;
        const top = oth[0];
        if (isMaster(top)) {
          const gap = unseenAbove(oth[1]);
          if (gap.length === 1 && rankOf(oth[1]) >= 8) return low(mine); // missing exactly one card between: finesse
        }
      }
      if (masters.length) return high(masters);
      // establish our longest combined suit
      const best = SUITS.filter(s => of(my, s).length && s !== trump).sort((a, b) => (of(my, b).length + of(other, b).length) - (of(my, a).length + of(other, a).length))[0];
      if (best) { const m = of(my, best); const seq = m.sort((a, b) => rankOf(b) - rankOf(a)); return seq.length >= 2 && rankOf(seq[0]) - rankOf(seq[1]) === 1 && rankOf(seq[0]) >= 9 ? seq[0] : low(m); }
      return low(legal);
    }
    // defender leading later in the hand
    const firstLead = play.tricks[0].cards[0];
    const dummyLeft = nextSeat(seat) === dummy; // dummy plays right after me
    const cand = SUITS.filter(s => of(legal, s).length);
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
      return sc;
    };
    cand.sort((a, b) => scoreSuit(b) - scoreSuit(a));
    const s = cand[0], m = of(legal, s);
    const mm = m.filter(isMaster);
    if (mm.length) return high(mm);
    const sorted = m.slice().sort((a, b) => rankOf(b) - rankOf(a));
    if (sorted.length >= 2 && rankOf(sorted[0]) - rankOf(sorted[1]) === 1 && rankOf(sorted[0]) >= 9) return sorted[0]; // top of sequence
    return sorted.length === 2 ? sorted[0] : low(m);
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
      if (onDeclSide) return low(follow);
      const likes = of(my, led).some(x => rankOf(x) >= 10) && trick.cards[0].seat === partner;
      if (likes) { const spots = follow.filter(x => rankOf(x) < 9); if (spots.length) return high(spots); }
      return low(follow);
    };
    if (partnerWinning && safe()) return signal();
    if (!winners.length) return signal();
    if (pos === 3) return low(winners);
    if (pos === 1) {
      // second hand low, but cover an honour with an honour
      const ledCard = trick.cards[0].card;
      if (rankOf(ledCard) >= 9 && !onDeclSide) {
        const cover = winners.filter(x => rankOf(x) >= 9);
        const nextIsDummy = nextSeat(seat) === dummy && dummyUp;
        const dummyHasSeq = nextIsDummy && of(dummyCards, led).some(x => rankOf(x) === rankOf(ledCard) - 1);
        if (cover.length && !dummyHasSeq) return low(cover);
      }
      // hold-up as declarer in NT: duck the first round with a single stopper
      if (onDeclSide && !trump) {
        const ourS = [...of(my, led), ...of(pCards, led)];
        const stops = ourS.filter(isMaster).length;
        const roundsPlayed = play.tricks.filter(tr => tr.cards.length === 4 && suitOf(tr.cards[0].card) === led).length;
        if (!OFF('hold') && stops === 1 && roundsPlayed < 1 && ourS.length <= 4 && sameSide(trick.cards[0].seat, decl) === false) return low(follow);
      }
      const m = winners.filter(isMaster);
      if (!OFF('second') && onDeclSide && m.length) return low(m);
      return low(follow);
    }
    // third hand
    if (onDeclSide) {
      // finesse: partner (our hand) led low; if 4th hand is unknown, play the cheapest card that beats the current winner
      const leaderOurs = sameSide(trick.cards[0].seat, decl);
      if (!trump && !leaderOurs) {
        // hold-up in NT with a single stopper on the first round
        const ourS = [...of(my, led), ...of(pCards, led)];
        const stops = ourS.filter(isMaster).length;
        const roundsPlayed = play.tricks.filter(tr => tr.cards.length === 4 && suitOf(tr.cards[0].card) === led).length;
        if (!OFF('hold') && stops === 1 && roundsPlayed < 1 && ourS.length <= 4) return low(follow);
      }
      return low(winners);
    }
    // defender third hand: high, but cheapest of equals
    const top = high(winners);
    const seq = follow.filter(x => rankOf(x) <= rankOf(top) && rankOf(x) >= rankOf(winCard) && unseenAbove(x).filter(u => rankOf(u) < rankOf(top)).length === 0 && beats(x));
    return seq.length ? low(seq) : top;
  }
  // void in the led suit
  if (trump && of(legal, trump).length && !(partnerWinning && safe())) {
    const ruffs = of(legal, trump).filter(beats);
    if (ruffs.length) return low(ruffs);
  }
  // discard: as defender, signal with a high spot in a suit we like, else throw from the weakest suit
  const cands = SUITS.filter(s => s !== trump && of(legal, s).length);
  const pool = cands.length ? cands : SUITS.filter(s => of(legal, s).length);
  if (!onDeclSide) {
    const liked = pool.find(s => of(my, s).some(x => rankOf(x) >= 11) && signals[s] === undefined);
    if (liked && of(legal, liked).length >= 3) { const spots = of(legal, liked).filter(x => rankOf(x) < 9); if (spots.length) return high(spots); }
  }
  pool.sort((a, b) => (hcp(of(my, a)) - hcp(of(my, b))) || (of(my, b).length - of(my, a).length));
  return low(of(legal, pool[0]));
}

// Robot response to a claim: accept when the claim is no more than the sure winners
function sureTricks(t, claimer) {
  const c = t.contract, play = t.play, hands = t.hands;
  const a = remainingHand(hands, play, claimer), b = remainingHand(hands, play, partnerOf(claimer));
  const opp = [...remainingHand(hands, play, nextSeat(claimer)), ...remainingHand(hands, play, partnerOf(nextSeat(claimer)))];
  const trump = c.strain === 'N' ? null : c.strain;
  const oppTrumps = trump ? opp.filter(x => suitOf(x) === trump).length : 0;
  let n = 0;
  for (const s of SUITS) {
    const ours = [...a, ...b].filter(x => suitOf(x) === s).sort((x, y) => rankOf(y) - rankOf(x));
    const theirs = opp.filter(x => suitOf(x) === s);
    const topOpp = theirs.length ? Math.max(...theirs.map(rankOf)) : -1;
    const tops = ours.filter(x => rankOf(x) > topOpp).length;
    const maxLen = Math.max(a.filter(x => suitOf(x) === s).length, b.filter(x => suitOf(x) === s).length);
    if (oppTrumps && s !== trump) n += Math.min(tops, Math.min(maxLen, theirs.length ? 99 : maxLen));
    else n += theirs.length === 0 ? maxLen : Math.min(tops === ours.length ? maxLen : tops, maxLen);
  }
  return Math.min(n, a.length);
}

function simulateBoard(hands, dealer, vul) {
  const auction = [];
  while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = botCall(hands[s], s, dealer, auction); auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s }); }
  const contract = finalContract(auction);
  if (!contract) return { auction, contract: null, declTricks: null, scoreNS: 0, tricks: [] };
  const t = { hands, auction, contract, play: { tricks: [] } };
  for (let i = 0; i < 52; i++) { const s = playTurn(t.play, contract); applyPlay(t.play, contract, s, botPlay(t, s)); }
  const d = tricksWon(t.play, contract).decl;
  return { auction, contract, declTricks: d, scoreNS: scoreNS(contract, d, vul), tricks: t.play.tricks };
}



// ---------- table model helpers ----------
function newTable({ name, priv, local }) {
  const code = rid(5);
  return {
    id: code, name: name || 'Table ' + code, private: !!priv, local: !!local,
    createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now(), version: 0,
    seats: { N: null, E: null, S: null, W: null },
    board: 0, dealer: 'N', vul: 'None', hands: null, auction: [], contract: null,
    play: { tricks: [] }, phase: 'waiting', claim: null, history: [], chat: [],
    host: me.id, locked: false, allowUndo: true, kibSee: true,
    boardLimit: 0, lastActAt: Date.now(), boardStart: null, seed: null, match: null,
  };
}
function mySeat(t = T) { return SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === me.id) || null; }
function dummySeat(t) { return t.contract ? partnerOf(t.contract.declarer) : null; }
function turnSeat(t) {
  if (t.phase === 'auction') return auctionTurn(t.dealer, t.auction);
  if (t.phase === 'play') return playTurn(t.play, t.contract);
  return null;
}
function controllerOf(t, seat) {
  if (t.phase === 'play' && seat === dummySeat(t)) return t.contract.declarer;
  return seat;
}
function occupant(t, seat) { return t.seats[seat]; }
function seatLabel(t, seat) {
  const o = occupant(t, seat);
  if (!o) return 'Empty seat';
  return o.kind === 'robot' ? 'Robot' : o.name || 'Player';
}
function sysMsg(t, text) { t.chat.push({ sys: true, text, ts: Date.now() }); if (t.chat.length > 120) t.chat.splice(0, t.chat.length - 120); }
function allSeated(t) { return SEATS.every(s => t.seats[s]); }
function isHost(t = T) { return !t.local && t.host === me.id; }
function fixHost(t) {
  const humans = SEATS.map(s => t.seats[s]).filter(o => o && o.kind === 'human');
  if (!humans.some(o => o.id === t.host) && humans.length) { t.host = humans[0].id; sysMsg(t, `${humans[0].name} is now the host`); }
}

function startBoard(t) {
  t.board += 1;
  t.dealer = boardDealer(t.board);
  t.vul = boardVul(t.board);
  t.hands = t.seed ? deal(seededRand(t.seed + ':' + t.board)) : deal();
  t.auction = []; t.contract = null; t.play = { tricks: [] }; t.claim = null;
  t.boardStart = Date.now(); t.lastActAt = Date.now();
  t.phase = 'auction';
}
function finishBoard(t, declTricks) {
  const c = t.contract;
  const sc = c ? scoreNS(c, declTricks, t.vul) : 0;
  const rec = { board: t.board, dealer: t.dealer, vul: t.vul, hands: t.hands, auction: t.auction, contract: c, tricks: t.play.tricks, declTricks: c ? declTricks : null, scoreNS: sc };
  if (t.local) { try { const o = simulateBoard(t.hands, t.dealer, t.vul); rec.other = { auction: o.auction, contract: o.contract, declTricks: o.declTricks, scoreNS: o.scoreNS }; } catch (e) { console.error(e); } }
  t.history.push(rec);
  t.phase = 'done'; t.claim = null;
  sysMsg(t, `Board ${t.board}: ${c ? contractText(c) + ' ' + resultText(c, declTricks) : 'passed out'}, N-S ${sc >= 0 ? '+' : ''}${sc}`);
}

// ---------- actions (each validated against the freshest state) ----------
const A = {
  sit(t, seat) {
    const o = t.seats[seat];
    if (o && o.kind === 'human') return false;
    if (t.locked && t.host !== me.id) { toast('The host has locked the seats'); return false; }
    const cur = mySeat(t);
    if (cur) t.seats[cur] = null;
    t.seats[seat] = { kind: 'human', id: me.id, name: me.name || 'Player' };
    sysMsg(t, `${me.name || 'A player'} sat ${SEAT_NAME[seat]}`);
    if (allSeated(t) && t.board === 0) startBoard(t);
  },
  robot(t, seat) {
    if (t.seats[seat]) return false;
    t.seats[seat] = { kind: 'robot' };
    if (allSeated(t) && t.board === 0) startBoard(t);
  },
  standUp(t) {
    const s = mySeat(t); if (!s) return false;
    t.seats[s] = null; sysMsg(t, `${me.name || 'A player'} left ${SEAT_NAME[s]}`);
    fixHost(t);
  },
  kick(t, seat) {
    if (t.host !== me.id || !t.seats[seat]) return false;
    const o = t.seats[seat];
    t.seats[seat] = null;
    sysMsg(t, `The host removed ${o.kind === 'robot' ? 'the robot' : o.name} from ${SEAT_NAME[seat]}`);
  },
  settings(t, patch) {
    if (t.host !== me.id) return false;
    Object.assign(t, patch);
    const on = v => v ? 'on' : 'off';
    if ('locked' in patch) sysMsg(t, `Seats ${patch.locked ? 'locked' : 'unlocked'} by the host`);
    if ('allowUndo' in patch) sysMsg(t, `Undo turned ${on(patch.allowUndo)}`);
    if ('boardLimit' in patch) sysMsg(t, patch.boardLimit ? `Time limit set to ${patch.boardLimit} minutes per board` : 'Time limit removed');
    if ('kibSee' in patch) sysMsg(t, `Spectators ${patch.kibSee ? 'can' : 'can no longer'} see all hands`);
  },
  redeal(t) {
    if (t.host !== me.id || t.phase !== 'auction') return false;
    t.board -= 1; startBoard(t); sysMsg(t, `The host redealt board ${t.board}`);
  },
  call(t, seat, call, alert) {
    if (t.phase !== 'auction' || auctionTurn(t.dealer, t.auction) !== seat) return false;
    if (!isLegalCall(t.dealer, t.auction, call)) return false;
    t.auction.push(alert ? { call, by: seat, alert } : { call, by: seat });
    t.lastActAt = Date.now();
    if (auctionOver(t.auction)) {
      t.contract = finalContract(t.auction);
      if (!t.contract) finishBoard(t, 0); else t.phase = 'play';
    }
  },
  card(t, seat, card) {
    if (t.phase !== 'play' || t.claim || playTurn(t.play, t.contract) !== seat) return false;
    if (!legalPlays(t.hands, t.play, t.contract, seat).includes(card)) return false;
    applyPlay(t.play, t.contract, seat, card);
    t.lastActAt = Date.now();
    if (completedTricks(t.play).length === 13) finishBoard(t, tricksWon(t.play, t.contract).decl);
  },
  claim(t, seat, n) {
    if (t.phase !== 'play' || t.claim || seat === dummySeat(t)) return false;
    const left = 13 - completedTricks(t.play).length;
    if (n < 0 || n > left) return false;
    const opp = sameSide(seat, t.contract.declarer)
      ? [nextSeat(t.contract.declarer), partnerOf(nextSeat(t.contract.declarer))]
      : [t.contract.declarer];
    t.claim = { by: seat, tricks: n, need: opp, acc: {} };
    sysMsg(t, `${SEAT_NAME[seat]} claims ${n} of the remaining ${left} tricks`);
    resolveRobotClaim(t);
  },
  respond(t, seat, accept) {
    if (!t.claim || !t.claim.need.includes(seat)) return false;
    if (!accept) { sysMsg(t, `${SEAT_NAME[seat]} rejected the claim. Play continues.`); t.claim = null; return; }
    t.claim.acc[seat] = true; checkClaim(t);
  },
  cancelClaim(t, seat) { if (!t.claim || t.claim.by !== seat) return false; t.claim = null; sysMsg(t, `${SEAT_NAME[seat]} withdrew the claim`); },
  chat(t, text) {
    const s = mySeat(t);
    t.chat.push({ from: me.id, name: me.name || 'Player', seat: s, text, ts: Date.now() });
    if (t.chat.length > 120) t.chat.splice(0, t.chat.length - 120);
  },
  next(t) { if (t.phase !== 'done') return false; startBoard(t); },
  undo(t, seat) { if (!t.local && t.allowUndo === false) return false; return doUndo(t, seat); },
  robotStep(t) {
    const ts = turnSeat(t); if (!ts) return false;
    if (t.claim) return false;
    const ctrl = controllerOf(t, ts);
    const o = occupant(t, ctrl);
    if (!o || o.kind !== 'robot') return false;
    if (t.phase === 'auction') { const r = botCall(t.hands[ts], ts, t.dealer, t.auction); return A.call(t, ts, r.call, r.alert); }
    return A.card(t, ts, botPlay(t, ts));
  },
};
function checkClaim(t) {
  const c = t.claim; if (!c) return;
  if (!c.need.every(s => c.acc[s])) return;
  const done = tricksWon(t.play, t.contract).decl;
  const left = 13 - completedTricks(t.play).length;
  const declExtra = sameSide(c.by, t.contract.declarer) ? c.tricks : left - c.tricks;
  sysMsg(t, 'Claim accepted');
  finishBoard(t, done + declExtra);
}
function resolveRobotClaim(t) {
  const c = t.claim; if (!c) return;
  for (const s of c.need) {
    const ctrl = controllerOf(t, s);
    const o = occupant(t, ctrl);
    if (o && o.kind === 'robot') {
      const left = 13 - completedTricks(t.play).length;
      const ok = c.tricks <= sureTricks(t, c.by) || c.tricks === 0 || (c.tricks < left && c.tricks <= sureTricks(t, c.by) + 0);
      if (!ok) { sysMsg(t, `Robot ${SEAT_NAME[s]} rejected the claim. Play continues.`); t.claim = null; return; }
      c.acc[s] = true;
    }
  }
  checkClaim(t);
}
function doUndo(t, seat) {
  if (!seat || (t.phase !== 'auction' && t.phase !== 'play') || t.claim) return false;
  const isRobotCtrl = s => { const o = occupant(t, controllerOf(t, s)); return o && o.kind === 'robot'; };
  if (t.phase === 'play') {
    const flat = []; t.play.tricks.forEach(tr => tr.cards.forEach(pc => flat.push(pc)));
    if (flat.length) {
      let i = flat.length - 1;
      while (i >= 0 && controllerOf(t, flat[i].seat) !== seat) { if (!isRobotCtrl(flat[i].seat)) return false; i--; }
      if (i >= 0) {
      const keep = flat.slice(0, i);
      const tricks = [];
      keep.forEach(pc => { let tr = tricks[tricks.length - 1]; if (!tr || tr.cards.length === 4) { tr = { leader: pc.seat, cards: [] }; tricks.push(tr); } tr.cards.push(pc); });
      t.play.tricks = tricks;
      sysMsg(t, `${SEAT_NAME[seat]} took back a card`);
      return;
      }
    }
  }
  // auction (or play before the opening lead)
  let i = t.auction.length - 1;
  while (i >= 0 && t.auction[i].by !== seat) { const o = occupant(t, t.auction[i].by); if (!o || o.kind !== 'robot') return false; i--; }
  if (i < 0) return false;
  t.auction = t.auction.slice(0, i);
  t.phase = 'auction'; t.contract = null; t.play = { tricks: [] };
  sysMsg(t, `${SEAT_NAME[seat]} took back a call`);
}



function canSee(t, seat) {
  const mine = mySeat(t);
  if (!mine) return t.kibSee !== false || t.phase === 'done';
  if (seat === mine || t.phase === 'done') return true;
  if (t.phase === 'play') {
    const dummyUp = t.play.tricks.length > 0;
    if (seat === dummySeat(t) && dummyUp) return true;
    if (t.claim && t.claim.by === seat && t.claim.need.includes(mine)) return true;
    if (t.claim && t.claim.by === seat && sameSide(seat, mine)) return true;
  }
  return false;
}


export {
  SEATS, SEAT_NAME, A, newTable, startBoard, sysMsg, mySeat, canSee, turnSeat, controllerOf, occupant,
  dummySeat, remainingHand, completedTricks, rid, legalCalls, legalPlays, botCall, botPlay, sureTricks,
};
