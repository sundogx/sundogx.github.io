// Robots against a reckless human. One seat is a "human" who overbids the way people do: a jump to game in a
// six-card major or to five of a minor on a weak hand, a three-level overcall on junk, 3NT with no stopper in their
// suit, a psyche, a raise straight to game on a weak hand, bidding on over the opponents' game, and so on. The
// human bids like the baseline robots (tests/fixtures/basebid6.js) otherwise, and its partner is a baseline robot
// too. The human's opponents are the robots: the baseline, or the bidding under test (js/bidding.js). Some of the
// overbids are right (the triggers do not look at the other hands), so a robot that doubles everything loses.
// Every final contract is scored double-dummy. For each kind of overbid it reports what the overbid costs the human
// against four baseline robots (how reckless it was), and what the robots under test gain over the baseline robots
// on the same deals with the same overbid (IMPs for the robots' side).
// Needs the double-dummy cache from tests/bidddsim.js for the same seed (run that first).
// Usage: node tests/bidoverbid.js [boards=1000] [seed=1] [--base=basebid6] [--types=a,b] [--show=type:k] [--best]
//   [--seats=NESW] [--off=..] [--k=..] (BID_OFF / BID_K of js/bidding.js, as in bidddsim) [--threads=n]
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
Object.assign(globalThis, require('../js/engine.js'));
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const flag = (k, d) => { const f = flags.find(x => x.startsWith('--' + k + '=')); return f ? f.slice(k.length + 3) : d; };
globalThis.BID_OFF = (flag('off', '') || '').split(',').filter(Boolean);
globalThis.BID_K = Object.fromEntries((flag('k', '') || '').split(',').filter(Boolean).map(x => [x.split(':')[0], +x.split(':')[1]]));
const BASE = require('./fixtures/' + flag('base', 'basebid6') + '.js');
const SYS = require(flag('sys', '../js/bidding.js'));
const cache = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `bridge-dd-${SEED}.json`), 'utf8'));
const rand = seededRand('bidddsim-' + SEED);
const key = h => SEATS.map(s => h[s].join('')).join('|');
const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');

function ev(hand) {
  const L = suitLengths(hand), H = hcp(hand), has = {};
  for (const s of SUITS) has[s] = hand.filter(c => c[0] === s).map(c => c[1]).join('');
  const sh = SUITS.map(s => L[s]).sort((a, b) => b - a);
  return { L, H, has, sh, bal: sh[3] >= 2 && sh[2] >= 3 };
}
const hon = (h, s, set = 'AKQ') => [...set].filter(r => h.has[s].includes(r)).length;
const longestOf = (h, ex = []) => ['S', 'H', 'D', 'C'].filter(s => !ex.includes(s)).sort((a, b) => h.L[b] - h.L[a])[0];
const stop = (h, s) => h.has[s].includes('A') || (h.has[s].includes('K') && h.L[s] >= 2) || (h.has[s].includes('Q') && h.L[s] >= 3);

function info(auction, seat, dealer, vul) {
  const p = partnerOf(seat), mine = auction.filter(a => a.by === seat), pards = auction.filter(a => a.by === p);
  const theirs = auction.filter(a => !sameSide(a.by, seat) && a.call !== 'P');
  const bids = auction.filter(a => bidValue(a.call) >= 0), first = bids[0] || null;
  const legal = legalCalls(dealer, auction);
  const lb = bids[bids.length - 1] || null;
  const cheap = st => { const v = lb ? bidValue(lb.call) : -1; for (let l = 1; l <= 7; l++) if (bidValue(l + st) > v) return l; return 8; };
  const rho = auction.length ? auction[auction.length - 1] : null;
  const theirSuits = [...new Set(theirs.filter(a => bidValue(a.call) >= 0 && a.call[1] !== 'N').map(a => a.call[1]))];
  const ourSuits = [...new Set(auction.filter(a => sameSide(a.by, seat) && bidValue(a.call) >= 0 && a.call[1] !== 'N').map(a => a.call[1]))];
  return { p, mine, pards, theirs, first, legal, lb, cheap, rho, pos: auction.length + 1, weVul: isVul(vul, seat), theyVul: isVul(vul, nextSeat(seat)),
    lv: lb ? +lb.call[0] : 0, theirSuits, ourSuits, weBid: auction.some(a => sameSide(a.by, seat) && a.call !== 'P'),
    pBid: pards.some(a => a.call !== 'P'), theyHold: !!lb && !sameSide(lb.by, seat) };
}
const fresh = I => !I.mine.some(a => a.call !== 'P');
const ok = (I, c) => I.legal.includes(c) ? c : null;

// ---- the overbids: given the hand, the auction and the call the baseline makes, the human's call or null ----
const DEV = {
  // a jump to four of a six-card major on 5-10 points, below the three level (opening, overcall or response)
  jump4M: (h, I) => {
    if (!fresh(I) || I.lv >= 3 || h.H < 5 || h.H > 10) return null;
    for (const M of ['S', 'H']) if (h.L[M] >= 6 && !I.theirSuits.includes(M) && !(I.pBid && I.ourSuits.length)) return ok(I, '4' + M);
    return null;
  },
  // five of a six-card minor on 4-10 points, below the four level
  jump5m: (h, I) => {
    if (!fresh(I) || I.lv >= 4 || h.H < 4 || h.H > 10 || I.pos > 6) return null;
    for (const m of ['D', 'C']) if (h.L[m] >= 6 && !I.theirSuits.includes(m) && h.L.S < 4 && h.L.H < 4) return ok(I, '5' + m);
    return null;
  },
  // over their opening: a three-level overcall in a five-card suit with 4-9 points
  ovc3: (h, I) => {
    if (!fresh(I) || I.pBid || !I.theyHold || !I.first || sameSide(I.first.by, I.p) || I.lv > 2 || h.H < 4 || h.H > 9) return null;
    for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 5 && !I.theirSuits.includes(s) && I.cheap(s) <= 3) return ok(I, '3' + s);
    return null;
  },
  // over their opening: a two-level overcall in a five-card suit with 5-8 points
  ovc2: (h, I) => {
    if (!fresh(I) || I.pBid || !I.theyHold || !I.first || sameSide(I.first.by, I.p) || I.lv > 1 || h.H < 5 || h.H > 8) return null;
    for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 5 && !I.theirSuits.includes(s) && I.cheap(s) === 2) return ok(I, '2' + s);
    return null;
  },
  // 3NT with 11-16 points and no stopper in their suit (an overcall or a response in competition)
  nt3: (h, I) => {
    if (!fresh(I) || !I.theirSuits.length || I.lv >= 3 || h.H < 11 || h.H > 16) return null;
    if (I.theirSuits.some(s => stop(h, s)) || (!I.pBid && h.H < 13)) return null;
    return ok(I, '3N');
  },
  // a psyche: a one-level suit opening or overcall with 0-5 points (third seat, or over their opening)
  psych: (h, I) => {
    if (!fresh(I) || I.pBid || h.H > 5 || I.lv > 1) return null;
    if (!I.first && I.pos !== 3) return null;
    for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 4 && !I.theirSuits.includes(s) && I.cheap(s) === 1) return ok(I, '1' + s);
    return null;
  },
  // partner opened or overcalled one of a major: straight to four with three or more trumps and 4-9 points
  raise4: (h, I) => {
    if (!fresh(I) || I.pards.filter(a => a.call !== 'P').length !== 1 || I.lv >= 4 || h.H < 4 || h.H > 9) return null;
    const pc = I.pards.find(a => a.call !== 'P').call;
    if (!/^1[HS]$/.test(pc) || h.L[pc[1]] < 3) return null;
    return ok(I, '4' + pc[1]);
  },
  // they bid game (or more) over our partscore: bid on in our suit at the next level, whatever the vulnerability
  bidOn: (h, I) => {
    if (!I.theyHold || !I.weBid || I.lv < 4) return null;
    for (const s of I.ourSuits) {
      const pHas = I.pards.some(a => bidValue(a.call) >= 0 && a.call[1] === s), mHas = I.mine.some(a => bidValue(a.call) >= 0 && a.call[1] === s);
      if (((pHas && h.L[s] >= 3) || (mHas && h.L[s] >= 6)) && I.cheap(s) <= 5) return ok(I, I.cheap(s) + s);
    }
    return null;
  },
  // compete one level higher in a partscore battle: they outbid our suit at the two or three level, we go on
  compete: (h, I) => {
    if (!I.theyHold || !I.weBid || I.lv < 2 || I.lv > 3 || h.H > 12) return null;
    for (const s of I.ourSuits) {
      const pHas = I.pards.some(a => bidValue(a.call) >= 0 && a.call[1] === s), mHas = I.mine.some(a => bidValue(a.call) >= 0 && a.call[1] === s);
      if ((pHas && h.L[s] >= 3) || (mHas && h.L[s] >= 6)) { if (I.cheap(s) <= 4 && I.cheap(s) >= 3) return ok(I, I.cheap(s) + s); }
    }
    return null;
  },
};
// what the human does on its next turn after some overbids (null: bid like the baseline)
const FOLLOW = {
  compete: (h, I, bc) => DEV.bidOn(h, I) || DEV.compete(h, I),
  bidOn: (h, I, bc) => null,
  ovc3: (h, I, bc) => DEV.bidOn(h, I) || DEV.compete(h, I),
  psych: (h, I, bc) => I.pBid && bc !== 'P' ? 'P' : null, // a psycher does not bid again unless partner did and pulls out
  jump4M: (h, I, bc) => bc === 'X' || bc === 'XX' ? 'P' : null,
};
const TYPES = (flag('types', '') || Object.keys(DEV).join(',')).split(',').filter(t => DEV[t]);

function bidOne(b, hum, type, oppSys, humSys = BASE) { // humSys: the human's side when it is not a human (plain robots)
  const auction = []; let fired = -1, follows = 0;
  while (!auctionOver(auction)) {
    const s = auctionTurn(b.dealer, auction);
    let call, alert;
    if (s === hum) {
      call = humSys.botCall(b.hands[s], s, b.dealer, auction, b.vul).call;
      if (type) {
        const I = info(auction, s, b.dealer, b.vul), h = ev(b.hands[s]);
        let alt = null;
        if (fired < 0) alt = DEV[type](h, I, call);
        else if (FOLLOW[type] && follows < 2) { alt = FOLLOW[type](h, I, call); if (alt) follows++; }
        if (alt && alt !== call && I.legal.includes(alt)) { call = alt; if (fired < 0) fired = auction.length; }
      }
    } else {
      const sys = sameSide(s, hum) ? humSys : oppSys;
      let r;
      try { r = sys.botCall(b.hands[s], s, b.dealer, auction, b.vul); } catch (e) { r = { call: 'P' }; }
      if (!isLegalCall(b.dealer, auction, r.call)) r = { call: 'P' };
      call = r.call; alert = r.alert;
    }
    auction.push(alert ? { call, by: s, alert } : { call, by: s });
    if (auction.length > 60) break;
  }
  const ct = finalContract(auction);
  const score = ct ? scoreNS(ct, b.dd[ct.declarer][ct.strain], b.vul) : 0;
  return { auction, ct, score, fired };
}

const boards = [];
for (let g = 0; g < N; g++) { const bn = g + 1, hands = deal(rand), dd = cache[key(hands)]; if (dd) boards.push({ bn, dealer: boardDealer(bn), vul: boardVul(bn), hands, dd }); }
const seatsUsed = flag('seats', 'NESW').split('');
const [showType, showK] = (flag('show', '') || ':0').split(':');
const PENLOG = flag('penlog', ''), penRows = [];
function logged(b, f, src) { // with --penlog: the robots' penalty-double judgements (judgeX) and the real double-dummy defence
  if (!PENLOG) return f();
  globalThis.BID_PENLOG = [];
  const r = f();
  for (const e of globalThis.BID_PENLOG) penRows.push(Object.assign(e, { def: 13 - b.dd[e.decl][e.st], vul: b.vul, src }));
  globalThis.BID_PENLOG = null;
  return r;
}
function runBoards(list) { // one record per (board, human seat, overbid) that fired
  const out = [];
  for (const b of list) {
    const plain = bidOne(b, 'N', null, BASE);
    if (PENLOG) logged(b, () => bidOne(b, 'N', null, SYS, SYS), 'rob');
    for (const hum of seatsUsed) for (const type of TYPES) {
      const tb = bidOne(b, hum, type, BASE);
      if (tb.fired < 0) continue;
      const ts = SYS === BASE ? tb : logged(b, () => bidOne(b, hum, type, SYS), type);
      const sg = sideOf(hum) === 'NS' ? 1 : -1; // the human's side
      const r = { type, cost: toImps(sg * (tb.score - plain.score)), g: toImps(-sg * (ts.score - tb.score)), diff: ts.auction.map(a => a.call).join() !== tb.auction.map(a => a.call).join() };
      for (const [t, k] of [[tb, 'B'], [ts, 'S']]) if (t.ct && sameSide(t.ct.declarer, hum)) {
        if (t.ct.doubled === 1) r['x' + k] = 1;
        if (b.dd[t.ct.declarer][t.ct.strain] < t.ct.level + 6) r['set' + k] = 1;
      }
      if (showK > 0 && (showType === 'all' || showType === type) && r.g !== 0)
        r.text = `Board ${b.bn} dealer ${b.dealer} vul ${b.vul}, human ${hum} (${type}): ${r.g} IMPs for the robots\n` + SEATS.map(s => `   ${s} ${show(b.hands[s]).padEnd(22)} ${hcp(b.hands[s])}${s === hum ? ' human' : ''}`).join('\n') +
          `\n   dd ${SEATS.map(s => s + ':' + STRAINS.map(x => b.dd[s][x]).join('/')).join(' ')} (${STRAINS.join('')})` +
          `\n   plain: ${plain.auction.map(a => a.by + ':' + a.call).join(' ')} => ${contractText(plain.ct)} ${plain.score}` +
          `\n   base : ${tb.auction.map((a, i) => a.by + ':' + a.call + (i === tb.fired ? '!' : '')).join(' ')} => ${contractText(tb.ct)} ${tb.score}` +
          `\n   new  : ${ts.auction.map((a, i) => a.by + ':' + a.call + (i === ts.fired ? '!' : '')).join(' ')} => ${contractText(ts.ct)} ${ts.score}`;
      out.push(r);
    }
  }
  return out;
}
if (!isMainThread) { const recs = runBoards(boards.filter((b, i) => i % workerData.n === workerData.k)); parentPort.postMessage({ recs, penRows }); return; }
const stats = () => ({ n: 0, s: 0, q: 0, add(x) { this.n++; this.s += x; this.q += x * x; }, get mean() { return this.n ? this.s / this.n : 0; },
  get se() { const m = this.mean; return this.n ? Math.sqrt(Math.max(0, this.q / this.n - m * m) / this.n) : 0; }, text(d = 2) { return `${this.mean >= 0 ? '+' : ''}${this.mean.toFixed(d)} ± ${this.se.toFixed(d)}`; } });
(async () => {
  const nw = Math.max(1, Math.min(+flag('threads', os.cpus().length - 1), boards.length));
  const parts = await Promise.all([...Array(nw).keys()].map(k => new Promise((res, rej) => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: { k, n: nw } });
    w.on('message', res); w.on('error', rej);
  })));
  const recs = parts.flatMap(p => p.recs), res = {}, all = stats();
  if (PENLOG) fs.writeFileSync(PENLOG, JSON.stringify(parts.flatMap(p => p.penRows)));
  for (const r of recs) {
    const t = res[r.type] || (res[r.type] = { cost: stats(), gain: stats(), diff: 0, xB: 0, xS: 0, setB: 0, setS: 0 });
    t.cost.add(r.cost); t.gain.add(r.g); all.add(r.g); if (r.diff) t.diff++;
    for (const k of ['xB', 'xS', 'setB', 'setS']) t[k] += r[k] || 0;
  }
  console.log(`${boards.length} boards (seed ${SEED}), human at ${seatsUsed.join('')}; IMPs for the robots' side per overbid`);
  console.log('type        n    human cost (base robots)   new - base         differ   human contract doubled base/new, went down base/new');
  for (const t of TYPES) { const r = res[t]; if (!r) continue;
    console.log(`${t.padEnd(8)} ${String(r.gain.n).padStart(5)}  ${r.cost.text().padStart(18)}        ${r.gain.text(3).padStart(16)}   ${String(r.diff).padStart(5)}    ${r.xB}/${r.xS}  ${r.setB}/${r.setS}`); }
  console.log(`all      ${String(all.n).padStart(5)}  new - base ${all.text(3)} IMPs per overbid (sum ${all.s})`);
  recs.filter(r => r.text).sort((a, b) => flags.includes('--best') ? b.g - a.g : a.g - b.g).slice(0, +showK).forEach(x => console.log('\n' + x.text));
})().catch(e => { console.error(e); process.exit(1); });
