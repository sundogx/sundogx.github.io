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

if (typeof module !== 'undefined') module.exports = {
  SEATS, SUITS, STRAINS, RANKS, SYM, SEAT_NAME, nextSeat, partnerOf, sideOf, sameSide, suitOf, rankOf,
  boardDealer, boardVul, isVul, sortHand, deal, seededRand, hcp, suitLengths, bidValue, lastBid, lastNonPass,
  auctionTurn, auctionOver, legalCalls, isLegalCall, finalContract, contractText, callText,
  trickWinner, playedCards, remainingHand, currentTrick, completedTricks, playTurn, legalPlays,
  applyPlay, tricksWon, scoreContract, scoreNS, resultText, toImps
};
