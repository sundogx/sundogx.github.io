// Robots partnering a human. One seat is a "human": it bids like the robots except that, once per board, it makes a
// natural but off-system call of one kind (a four-card major opening, a 1NT opening with a singleton, an underbid,
// an overcall on a four-card suit, a takeout double with a long suit, or a call the system does not use: a jump
// shift, a help-suit game try, 1NT-3M...). Its partner is a robot: the baseline (tests/fixtures/basebid5.js) or the
// one under test (js/bidding.js); the opponents bid the baseline. Every final contract is scored double-dummy.
// For each kind of deviation it reports how many IMPs the human's side loses against the same deal bid with the
// same partner and no deviation, for each partner, and the difference between the partners on the deviated deals
// (what the new robot's handling of the human's call gains). It also counts forcing calls (by the new robots'
// reading) that the robot partner passed, and robot calls that throw or are illegal.
// Needs the double-dummy cache from tests/bidddsim.js for the same seed (run that first).
// Usage: node tests/bidhuman.js [boards=1000] [seed=1] [--base=basebid5] [--types=a,b] [--show=type:k] [--seats=NESW]
//   --show=type:k prints the k boards of that kind where the robot under test did worst against the baseline partner
//   (type 'all' for any kind; --best for the boards it gained most on; --cost: sorted by the cost of the deviation instead)
//   --explain prints, for each kind, how the robots explain the human's off-system call (describeCall) in a few auctions
//   --human=base: the human bids like the baseline robots when not deviating (default: like the robots under test)
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const flag = (k, d) => { const f = flags.find(x => x.startsWith('--' + k + '=')); return f ? f.slice(k.length + 3) : d; };
globalThis.BID_OFF = (flag('off', '') || '').split(',').filter(Boolean);
globalThis.BID_K = Object.fromEntries((flag('k', '') || '').split(',').filter(Boolean).map(x => [x.split(':')[0], +x.split(':')[1]]));
const BASE = require('./fixtures/guard.js')('./' + flag('base', 'basebid5') + '.js'); // knobs: the version under test only
const SYS = require(flag('sys', '../js/bidding.js'));
const HUM = flag('human', 'sys') === 'base' ? BASE : SYS; // how the human bids when not deviating (and reads its own calls)
const cache = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `bridge-dd-${SEED}.json`), 'utf8'));
const rand = seededRand('bidddsim-' + SEED);
const key = h => SEATS.map(s => h[s].join('')).join('|');
const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');

// ---- hand facts ----
function ev(hand) {
  const L = suitLengths(hand), H = hcp(hand), has = {};
  for (const s of SUITS) has[s] = hand.filter(c => c[0] === s).map(c => c[1]).join('');
  const sh = SUITS.map(s => L[s]).sort((a, b) => b - a);
  return { L, H, has, sh, bal: sh[3] >= 2 && sh[2] >= 3 };
}
const otherM = s => s === 'S' ? 'H' : 'S';
const hon = (h, s, set = 'AKQ') => [...set].filter(r => h.has[s].includes(r)).length;
const longestOf = (h, ex = []) => ['S', 'H', 'D', 'C'].filter(s => !ex.includes(s)).sort((a, b) => h.L[b] - h.L[a])[0];
const supPts = (h, t) => h.H + SUITS.filter(s => s !== t).reduce((x, s) => x + (h.L[s] === 0 ? 3 : h.L[s] === 1 ? 2 : h.L[s] === 2 ? 1 : 0), 0);

// ---- what the human sees: the auction so far ----
function info(auction, seat, dealer, vul) {
  const p = partnerOf(seat), mine = auction.filter(a => a.by === seat), pards = auction.filter(a => a.by === p);
  const theirs = auction.filter(a => !sameSide(a.by, seat) && a.call !== 'P');
  const bids = auction.filter(a => bidValue(a.call) >= 0), first = bids[0] || null;
  const metas = BASE._metas(auction, vul);
  const legal = legalCalls(dealer, auction);
  const lb = bids[bids.length - 1] || null;
  const cheap = st => { const v = lb ? bidValue(lb.call) : -1; for (let l = 1; l <= 7; l++) if (bidValue(l + st) > v) return l; return 8; };
  const rho = auction.length ? auction[auction.length - 1] : null;
  return { p, mine, pards, theirs, first, metas, legal, lb, cheap, rho, pos: auction.length + 1, vul, weVul: isVul(vul, seat),
    meta: a => metas[auction.indexOf(a)] || {} };
}
const unbidBy = (I, st) => !I.theirs.some(a => bidValue(a.call) >= 0 && a.call[1] === st);

// ---- the deviations: given the hand, the auction and the call the system makes, a natural human alternative or null ----
const DEV = {
  // opener: one of a four-card major (with two top honours) instead of one of a minor
  open4M: (h, I, bc) => {
    if (I.first || !/^1[CD]$/.test(bc)) return null;
    const ms = ['S', 'H'].filter(M => h.L[M] === 4 && hon(h, M, 'AKQJ') >= 2);
    return ms.length === 1 && h.L[otherM(ms[0])] <= 3 ? '1' + ms[0] : null;
  },
  // opener: 1NT with 15-17 and a singleton honour, or 5-4-2-2 with a five-card minor
  nt1odd: (h, I, bc) => {
    if (I.first || !/^1[CDHS]$/.test(bc) || h.H < 15 || h.H > 17 || h.L.H >= 5 || h.L.S >= 5) return null;
    const single = SUITS.find(s => h.L[s] === 1);
    if (h.sh[3] === 1 && single && /[AKQ]/.test(h.has[single]) && h.sh[0] <= 5) return '1N';
    if (h.sh.join('') === '5422' && (h.L.C === 5 || h.L.D === 5)) return '1N';
    return null;
  },
  // opener: 1NT on a good 14 (two aces or a five-card suit)
  nt14: (h, I, bc) => (!I.first && /^1[CDHS]$/.test(bc) && h.bal && h.H === 14 && (h.sh[0] === 5 || [...'SHDC'].filter(s => h.has[s].includes('A')).length >= 2) && h.L.H < 5 && h.L.S < 5) ? '1N' : null,
  // opener: a light opening (9-10 points and a five-card suit) where the system passes
  lightOpen: (h, I, bc) => {
    if (I.first || bc !== 'P' || I.pos > 3 || h.H < 9 || h.H > 10) return null;
    const s = longestOf(h);
    return h.L[s] >= 5 && hon(h, s) >= 1 ? '1' + s : null;
  },
  // weak two with five cards (not vulnerable) or with seven, or a weak two in a major beside four of the other
  weak2odd: (h, I, bc) => {
    if (I.first || I.pos > 3) return null;
    if (bc === 'P' && !I.weVul) for (const s of ['S', 'H', 'D']) if (h.L[s] === 5 && hon(h, s) >= 2 && h.H >= 6 && h.H <= 10 && h.sh[0] === 5) return '2' + s;
    if (/^3[DHS]$/.test(bc) && h.L[bc[1]] === 7) return '2' + bc[1];
    if (bc === 'P') for (const s of ['S', 'H']) if (h.L[s] === 6 && h.L[otherM(s)] === 4 && h.H >= 5 && h.H <= 10 && hon(h, s) >= 1) return '2' + s;
    if (bc === 'P' && h.L.C === 6 && h.H >= 5 && h.H <= 9 && hon(h, 'C') >= 2) return '3C';
    return null;
  },
  // responder: passes partner's one-level suit opening with 6-7 points
  underPass: (h, I, bc) => (I.first && I.first.by === I.p && /^1[CDHS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.pards.filter(a => a.call !== 'P').length === 1 && I.theirs.length === 0 && bc !== 'P' && h.H >= 6 && h.H <= 7 && h.sh[0] <= 5) ? 'P' : null,
  // responder: a single raise with a limit raise
  underRaise: (h, I, bc) => (I.first && I.first.by === I.p && /^1[HS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.theirs.length === 0 && bc === '3' + I.first.call[1]) ? '2' + I.first.call[1] : null,
  // responder: a limit raise with three trumps or a maximum single raise
  overRaise: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[HS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.theirs.length === 0)) return null;
    const t = I.first.call[1];
    return bc === '2' + t && supPts(h, t) >= 9 && h.H >= 8 ? '3' + t : null;
  },
  // responder: 3NT over 1M with 13-15 balanced and a doubleton (natural, instead of a two-over-one)
  jump3N: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[HS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.theirs.length === 0 && I.pards.length === 1)) return null;
    return h.bal && h.H >= 13 && h.H <= 15 && h.L[I.first.call[1]] <= 2 && bc !== '3N' ? '3N' : null;
  },
  // responder: a two-over-one on 10-12 (Standard American, not game forcing) instead of a forcing 1NT
  light21: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[HS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.theirs.length === 0 && I.pards.length === 1 && bc === '1N')) return null;
    if (h.H < 10 || h.H > 12) return null;
    const t = I.first.call[1];
    for (const s of ['C', 'D', 'H']) if (bidValue('2' + s) < bidValue('2' + t) && h.L[s] >= 5) return '2' + s;
    return null;
  },
  // responder over a minor: 1NT with a four-card major (balanced, 6-10)
  skipMajor: (h, I, bc) => (I.first && I.first.by === I.p && /^1[CD]$/.test(I.first.call) && I.theirs.length === 0 && I.mine.every(a => a.call === 'P') && /^1[HS]$/.test(bc) && h.L[bc[1]] === 4 && h.bal && h.H <= 10) ? '1N' : null,
  // over their one-level opening: an overcall on a good four-card suit
  ovc4: (h, I, bc) => {
    if (!I.first || sameSide(I.first.by, I.p) || I.mine.some(a => a.call !== 'P') || I.pards.some(a => a.call !== 'P') || !/^1[CDHS]$/.test(I.first.call) || I.theirs.length !== 1) return null;
    if (bc !== 'P' && bc !== 'X') return null;
    if (h.H < 11 || h.H > 16) return null;
    for (const s of ['S', 'H', 'D', 'C']) if (s !== I.first.call[1] && h.L[s] === 4 && hon(h, s) >= 2 && I.cheap(s) === 1 && I.legal.includes('1' + s)) return '1' + s;
    return null;
  },
  // over their opening: a takeout double with a six-card suit; the long suit comes next
  xLong: (h, I, bc) => {
    if (!I.first || sameSide(I.first.by, I.p) || I.mine.some(a => a.call !== 'P') || I.pards.some(a => a.call !== 'P') || !I.legal.includes('X') || !I.rho || I.rho.call === 'P') return null;
    const s = longestOf(h); if (h.L[s] < 6 || h.H < 12 || h.H > 16 || !unbidBy(I, s) || bc === 'X') return null;
    return bidValue(bc) >= 0 && bc[1] === s ? 'X' : null;
  },
  // over their opening: a takeout double off shape (11-14, a doubleton or three cards in their suit, no five-card suit)
  xThin: (h, I, bc) => {
    if (!I.first || sameSide(I.first.by, I.p) || I.mine.some(a => a.call !== 'P') || I.pards.some(a => a.call !== 'P') || !I.legal.includes('X') || !I.rho || bidValue(I.rho.call) < 0 || I.theirs.length !== 1) return null;
    const st = I.rho.call[1]; if (st === 'N' || +I.rho.call[0] > 1) return null;
    return bc === 'P' && h.H >= 11 && h.H <= 14 && h.L[st] <= 3 && h.sh[0] <= 4 ? 'X' : null;
  },
  // partner opened, RHO overcalled: a free bid in a four-card major instead of a negative double
  free4: (h, I, bc) => {
    if (bc !== 'X' || !I.first || I.first.by !== I.p || !/^1[CDHS]$/.test(I.first.call) || I.mine.length || I.theirs.length !== 1 || !I.rho || I.rho.call === 'P') return null;
    for (const M of ['S', 'H']) if (M !== I.first.call[1] && unbidBy(I, M) && h.L[M] === 4 && I.cheap(M) <= 2 && h.H >= (I.cheap(M) === 2 ? 10 : 6)) return I.cheap(M) + M;
    return null;
  },
  // responder: a strong jump shift (17+ and a five-card suit) instead of the system's call
  jumpShift: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[CDHS]$/.test(I.first.call) && I.mine.every(a => a.call === 'P') && I.mine.length === 0 && I.theirs.length === 0 && I.pards.length === 1)) return null;
    const t = I.first.call[1]; if (h.H < 17) return null;
    for (const s of ['S', 'H', 'D', 'C']) if (s !== t && h.L[s] >= 5 && h.L[s] === Math.max(...SUITS.filter(x => x !== t).map(x => h.L[x])) && I.cheap(s) + 1 <= 3) return (I.cheap(s) + 1) + s;
    return null;
  },
  // responder in competition: a weak jump shift with a six-card suit
  weakJump: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[CDHS]$/.test(I.first.call) && I.mine.length === 0 && I.theirs.length === 1 && I.rho && I.rho.call !== 'P')) return null;
    if (h.H < 3 || h.H > 8) return null;
    const t = I.first.call[1];
    for (const s of ['S', 'H', 'D', 'C']) if (s !== t && unbidBy(I, s) && h.L[s] >= 6 && I.cheap(s) + 1 <= 3 && h.L[t] <= 2) return (I.cheap(s) + 1) + s;
    return null;
  },
  // responder in competition: a jump raise of partner's minor with five trumps and a weak hand
  jumpRaiseM: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && /^1[CD]$/.test(I.first.call) && I.mine.length === 0 && I.theirs.length === 1 && I.rho && bidValue(I.rho.call) >= 0)) return null;
    const t = I.first.call[1];
    return h.L[t] >= 5 && h.H >= 4 && h.H <= 8 && I.cheap(t) + 1 <= 3 ? (I.cheap(t) + 1) + t : null;
  },
  // opener after 1M-2M: a help-suit game try instead of three of the major
  gameTry: (h, I, bc) => {
    if (!(I.first && I.first.by !== I.p && /^1[HS]$/.test(I.first.call) && I.mine.length === 1 && I.theirs.length === 0 && I.pards.length === 1 && I.pards[0].call === '2' + I.first.call[1])) return null;
    const t = I.first.call[1]; if (bc !== '3' + t) return null;
    const losers = s => Math.min(3, h.L[s]) - ['A', 'K', 'Q'].slice(0, Math.min(3, h.L[s])).filter(r => h.has[s].includes(r)).length;
    for (const s of ['C', 'D', 'H', 'S']) if (s !== t && h.L[s] >= 3 && losers(s) >= 2 && bidValue(I.cheap(s) + s) < bidValue('3' + t)) return I.cheap(s) + s;
    return null;
  },
  // opener after 1S-1NT: a jump shift into hearts with 17+
  jsOpener: (h, I, bc) => (I.first && I.first.by !== I.p && I.first.call === '1S' && I.mine.length === 1 && I.theirs.length === 0 && I.pards.length === 1 && I.pards[0].call === '1N' && bc === '2H' && h.H >= 17) ? '3H' : null,
  // responder over our 1NT: three of a five-card major with game values (instead of a transfer)
  nt3M: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && I.first.call === '1N' && I.mine.length === 0 && I.theirs.length === 0 && I.pards.length === 1)) return null;
    for (const M of ['S', 'H']) if (h.L[M] >= 5 && h.L[otherM(M)] < 4 && h.H >= 10 && h.H <= 14 && /^2[DH]$/.test(bc)) return '3' + M;
    return null;
  },
  // responder over our 1NT: three of a six-card minor, invitational
  nt3m: (h, I, bc) => {
    if (!(I.first && I.first.by === I.p && I.first.call === '1N' && I.mine.length === 0 && I.theirs.length === 0 && I.pards.length === 1)) return null;
    for (const m of ['D', 'C']) if (h.L[m] >= 6 && hon(h, m) >= 2 && h.H >= 7 && h.H <= 9 && h.L.H < 4 && h.L.S < 4) return '3' + m;
    return null;
  },
};
const FOLLOW = {
  gameTry: (h, I, bc) => {
    const t = I.first.call[1], pl = I.pards[I.pards.length - 1];
    if (!pl) return null;
    if (pl.call === '3' + t || bidValue(pl.call) >= bidValue('4' + t)) return 'P';
    return I.legal.includes('4' + t) ? '4' + t : null;
  }, // what the human does on the next turn after some deviations (null: bid the system)
  xLong: (h, I, bc) => {
    const s = longestOf(h); if (!I.pards.some(a => a.call !== 'P') && I.rho && I.rho.call === 'P' && I.lb && !sameSide(I.lb.by, I.p)) return null;
    if (bc !== 'P' && bidValue(bc) >= 0 && bc[1] === s) return null;
    if (I.pards.some(a => bidValue(a.call) >= 0 && a.call[1] === s)) return null;
    return I.cheap(s) <= 3 && I.legal.includes(I.cheap(s) + s) ? I.cheap(s) + s : null;
  },
};
const TYPES = (flag('types', '') || Object.keys(DEV).join(',')).split(',').filter(t => DEV[t]);

// One auction. hum: the human's seat, type: the deviation it makes (or null), partnerSys: the robot partnering it.
function bidOne(b, hum, type, partnerSys, log) {
  const auction = []; let fired = -1, follow = false, bad = 0, fpass = 0;
  while (!auctionOver(auction)) {
    const s = auctionTurn(b.dealer, auction);
    let call, alert;
    if (s === hum) {
      call = HUM.botCall(b.hands[s], s, b.dealer, auction, b.vul).call;
      if (type && (fired < 0 || follow)) {
        const I = info(auction, s, b.dealer, b.vul), h = ev(b.hands[s]);
        const alt = fired < 0 ? DEV[type](h, I, call) : FOLLOW[type](h, I, call);
        if (fired >= 0) follow = false;
        if (alt && alt !== call && I.legal.includes(alt)) { call = alt; if (fired < 0) { fired = auction.length; follow = !!FOLLOW[type]; } }
      }
    } else {
      const sys = s === partnerOf(hum) ? partnerSys : BASE;
      let r;
      try { r = sys.botCall(b.hands[s], s, b.dealer, auction, b.vul); } catch (e) { bad++; r = { call: 'P' }; }
      if (!isLegalCall(b.dealer, auction, r.call)) { bad++; r = { call: 'P' }; }
      call = r.call; alert = r.alert;
      if (s === partnerOf(hum) && call === 'P' && fired >= 0) { // a forcing call by the human passed by the robot
        const m = SYS._metas(auction, b.vul), pi = auction.map(a => a.by).lastIndexOf(hum);
        const lnp = lastNonPass(auction);
        if (pi >= 0 && pi >= fired && m[pi] && m[pi].f >= 1 && auction[auction.length - 1].call === 'P' && lnp && lnp.by === hum && auction[pi].call !== 'P') fpass++;
      }
    }
    auction.push(alert ? { call, by: s, alert } : { call, by: s });
    if (auction.length > 60) { bad++; break; }
  }
  const ct = finalContract(auction);
  const score = ct ? scoreNS(ct, b.dd[ct.declarer][ct.strain], b.vul) : 0;
  return { auction, ct, score, fired, bad, fpass };
}

const boards = [];
for (let g = 0; g < N; g++) { const bn = g + 1, hands = deal(rand), dd = cache[key(hands)]; if (dd) boards.push({ bn, dealer: boardDealer(bn), vul: boardVul(bn), hands, dd }); }
const seatsUsed = (flag('seats', 'NESW')).split('');
const stats = () => ({ n: 0, s: 0, q: 0, add(x) { this.n++; this.s += x; this.q += x * x; }, get mean() { return this.n ? this.s / this.n : 0; },
  get se() { const m = this.mean; return this.n ? Math.sqrt(Math.max(0, this.q / this.n - m * m) / this.n) : 0; }, text(d = 2) { return `${this.mean >= 0 ? '+' : ''}${this.mean.toFixed(d)} ± ${this.se.toFixed(d)}`; } });
const res = {}, shownL = [];
let totBad = 0, totFP = 0, totFPb = 0;
const [showType, showK] = (flag('show', '') || ':0').split(':');
for (const b of boards) {
  const plain = bidOne(b, 'N', null, BASE); // no deviation, the human's side bidding like the baseline robots
  const fires = new Set(); // which deviations the human would make, at its turns in the plain auction (identical up to there)
  for (let i = 0; i < plain.auction.length; i++) {
    const s = plain.auction[i].by; if (!seatsUsed.includes(s)) continue;
    const pre = plain.auction.slice(0, i), I = info(pre, s, b.dealer, b.vul), h = ev(b.hands[s]);
    for (const type of TYPES) { if (fires.has(s + type)) continue; const alt = DEV[type](h, I, plain.auction[i].call); if (alt && alt !== plain.auction[i].call && I.legal.includes(alt)) fires.add(s + type); }
  }
  for (const hum of seatsUsed) for (const type of TYPES) {
    if (!fires.has(hum + type)) continue;
    const tb = bidOne(b, hum, type, BASE);
    if (tb.fired < 0) continue;
    const ts = SYS === BASE ? tb : bidOne(b, hum, type, SYS);
    const pb = HUM === BASE ? plain : bidOne(b, hum, null, BASE), ps = SYS === BASE ? pb : bidOne(b, hum, null, SYS); // no deviation, same partners
    const sg = sideOf(hum) === 'NS' ? 1 : -1;
    const r = res[type] || (res[type] = { costB: stats(), costS: stats(), gain: stats(), diff: 0 });
    r.costB.add(toImps(sg * (tb.score - pb.score))); r.costS.add(toImps(sg * (ts.score - ps.score)));
    const g = toImps(sg * (ts.score - tb.score)); r.gain.add(g);
    if (ts.auction.map(a => a.call).join() !== tb.auction.map(a => a.call).join()) r.diff++;
    totBad += ts.bad; totFP += ts.fpass; totFPb += tb.fpass;
    if (flags.includes('--explain') && SYS._describe) { // what the robots say the human's deviating call means
      const ex = r.ex || (r.ex = new Map()), a = ts.auction, i = ts.fired;
      if (i >= 0) { const k = a.slice(0, i + 1).filter(x => x.call !== 'P' || a.indexOf(x) === i).map(x => (sameSide(x.by, hum) ? '' : '(') + x.call + (sameSide(x.by, hum) ? '' : ')')).join(' '); if (!ex.has(k)) ex.set(k, SYS._describe(a, i, b.vul)); }
    }
    if (showK > 0 && (showType === 'all' || showType === type) && (g !== 0 || flags.includes('--cost')))
      shownL.push({ g: flags.includes('--cost') ? toImps(sg * (ts.score - ps.score)) : g, text: `Board ${b.bn} dealer ${b.dealer} vul ${b.vul}, human ${hum} (${type}): ${g} IMPs\n` + SEATS.map(s => `   ${s} ${show(b.hands[s]).padEnd(22)} ${hcp(b.hands[s])}${s === hum ? ' human' : ''}`).join('\n') +
        `\n   dd ${SEATS.map(s => s + ':' + STRAINS.map(x => b.dd[s][x]).join('/')).join(' ')} (${STRAINS.join('')})` +
        `\n   plain: ${pb.auction.map(a => a.by + ':' + a.call).join(' ')} => ${contractText(pb.ct)} ${pb.score}` +
        `\n   base : ${tb.auction.map((a, i) => a.by + ':' + a.call + (i === tb.fired ? '!' : '')).join(' ')} => ${contractText(tb.ct)} ${tb.score}` +
        `\n   new  : ${ts.auction.map((a, i) => a.by + ':' + a.call + (i === ts.fired ? '!' : '')).join(' ')} => ${contractText(ts.ct)} ${ts.score}` });
  }
}
console.log(`${boards.length} boards (seed ${SEED}), human at ${seatsUsed.join('')}; IMPs for the human's side per deviation (vs four robots, no deviation)`);
console.log('type          n    cost (base partner)   cost (new partner)   new - base          differ');
let all = stats(), allN = 0;
for (const t of TYPES) { const r = res[t]; if (!r) continue; allN += r.gain.n; all.s += r.gain.s; all.q += r.gain.q; all.n += r.gain.n;
  console.log(`${t.padEnd(12)} ${String(r.gain.n).padStart(5)}  ${r.costB.text().padStart(16)}   ${r.costS.text().padStart(16)}   ${r.gain.text(3).padStart(16)}   ${r.diff}`); }
console.log(`all          ${String(allN).padStart(5)}  new - base ${all.text(3)} IMPs a deviation (sum ${all.s})`);
console.log(`robot partner: ${totBad} illegal calls or errors; forcing calls by the human passed: ${totFP} (baseline partner ${totFPb})`);
if (flags.includes('--explain')) for (const t of TYPES) if (res[t] && res[t].ex) { console.log(`\n${t}:`); [...res[t].ex].slice(0, 8).forEach(([k, d]) => console.log(`  ${k.padEnd(28)} ${d}`)); }
shownL.sort((a, b) => flags.includes('--best') ? b.g - a.g : a.g - b.g).slice(0, +showK).forEach(x => console.log('\n' + x.text));
