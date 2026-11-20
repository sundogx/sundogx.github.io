// Property tests of the rules code (js/engine.js, js/par.js) against reference implementations written
// independently from the Laws of Duplicate Bridge:
//  1. scoring: every contract, doubling, vulnerability and number of tricks vs a table-driven scorer (Law 77);
//  2. boards 1-64: dealer and vulnerability (Law 2 rotation);
//  3. IMPs: every difference 0..5000 vs the WBF scale;
//  4. auctions: random call sequences vs a reference state machine (Laws 18-22: sufficiency, X/XX, end, declarer);
//  5. tricks: trick winner and legal plays vs plain reference rules on random deals;
//  6. par: parScore vs a minimax over the auction (each side may bid on or let the contract stand, doubled if it fails).
// Usage: node tests/rulesfuzz.js [n]   (default 3000 random cases per random check)
Object.assign(globalThis, require('../js/engine.js'));
const E = require('../js/engine.js');
const { parScore } = require('../js/par.js');
const N = +process.argv[2] || 3000;
const rand = seededRand('rulesfuzz');
const ri = n => Math.floor(rand() * n);
let fails = 0;
const bad = (...m) => { fails++; if (fails < 15) console.log('FAIL', ...m); };

// ---- 1. scoring (Law 77), written as tables ----
function refScore(level, strain, dbl, vul, tricks) {
  const need = level + 6, mult = [1, 2, 4][dbl];
  if (tricks < need) {
    const down = need - tricks;
    if (!dbl) return -down * (vul ? 100 : 50);
    const steps = vul ? [200, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300] : [100, 200, 200, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300];
    let p = 0; for (let i = 0; i < down; i++) p += steps[i];
    return -p * (dbl === 2 ? 2 : 1);
  }
  const perTrick = { C: 20, D: 20, H: 30, S: 30, N: 30 }[strain];
  const contractPts = (level * perTrick + (strain === 'N' ? 10 : 0)) * mult;
  let s = contractPts;
  s += contractPts >= 100 ? (vul ? 500 : 300) : 50;
  if (level === 6) s += vul ? 750 : 500;
  if (level === 7) s += vul ? 1500 : 1000;
  s += [0, 50, 100][dbl];
  const over = tricks - need;
  s += over * (dbl === 0 ? perTrick : dbl === 1 ? (vul ? 200 : 100) : (vul ? 400 : 200));
  return s;
}
let nScore = 0;
for (let level = 1; level <= 7; level++) for (const strain of STRAINS) for (let dbl = 0; dbl < 3; dbl++)
  for (const vul of ['None', 'NS', 'EW', 'Both']) for (const decl of SEATS) for (let tr = 0; tr <= 13; tr++) {
    const c = { level, strain, doubled: dbl, declarer: decl }, v = vul === 'Both' || vul === sideOf(decl);
    const want = refScore(level, strain, dbl, v, tr), got = scoreContract(c, tr, vul);
    if (got !== want) bad('score', JSON.stringify(c), vul, tr, got, want);
    const ns = scoreNS(c, tr, vul); if (ns !== (sideOf(decl) === 'NS' ? want : -want)) bad('scoreNS', JSON.stringify(c), vul, tr, ns);
    nScore++;
  }
if (scoreContract({ level: 4, strain: 'S', declarer: 'N' }, 10, 'None') !== 420) bad('score without doubled field');
if (scoreNS(null, 0, 'Both') !== 0) bad('passed out scores 0');
console.log(`scoring: ${nScore} cases`);

// ---- 2. board rotation ----
{
  const vulOf = n => { // Law 2: the 16-board cycle (None, NS, EW, Both rotated by one each group of four)
    const i = (n - 1) % 16, grp = Math.floor(i / 4), pos = i % 4;
    return ['None', 'NS', 'EW', 'Both'][(pos + grp) % 4];
  };
  for (let n = 1; n <= 64; n++) {
    if (boardDealer(n) !== 'NESW'[(n - 1) % 4]) bad('dealer', n, boardDealer(n));
    if (boardVul(n) !== vulOf(n)) bad('vul', n, boardVul(n), vulOf(n));
  }
  for (let n = -40; n <= 0; n++) if (boardDealer(n) !== boardDealer(n + 48) || boardVul(n) !== boardVul(n + 48)) bad('board below 1', n, boardDealer(n), boardVul(n));
  // spot checks from a printed board schedule
  for (const [n, v] of [[1, 'None'], [2, 'NS'], [3, 'EW'], [4, 'Both'], [5, 'NS'], [8, 'None'], [9, 'EW'], [11, 'None'], [13, 'Both'], [16, 'EW'], [17, 'None'], [32, 'EW']])
    if (boardVul(n) !== v) bad('vul board', n, boardVul(n), v);
  for (const [vul, seat, want] of [['None', 'N', false], ['NS', 'S', true], ['NS', 'E', false], ['EW', 'W', true], ['Both', 'E', true]])
    if (isVul(vul, seat) !== want) bad('isVul', vul, seat);
  console.log('boards: 64 checked');
}

// ---- 3. IMPs (WBF scale) ----
{
  const scale = [[0, 10], [20, 40], [50, 80], [90, 120], [130, 160], [170, 210], [220, 260], [270, 310], [320, 360], [370, 420], [430, 490], [500, 590],
    [600, 740], [750, 890], [900, 1090], [1100, 1290], [1300, 1490], [1500, 1740], [1750, 1990], [2000, 2240], [2250, 2490], [2500, 2990], [3000, 3490], [3500, 3990], [4000, Infinity]];
  for (let d = 0; d <= 5000; d += 10) {
    const want = scale.findIndex(([lo, hi]) => d >= lo && d <= hi);
    if (toImps(d) !== want) bad('imps', d, toImps(d), want);
    if (toImps(-d) !== -want) bad('imps', -d, toImps(-d), -want);
  }
  console.log('imps: 0..5000 checked');
}

// ---- 4. auctions (Laws 18-22) ----
// Reference: track the last bid, who made it, and its doubling state directly.
function refAuction(dealer, calls) {
  let seat = dealer, last = null, lastBy = null, dbl = 0, passes = 0, n = 0, over = false;
  const first = {}; // first seat of each side to name each strain
  const legal = () => {
    const out = ['P'];
    for (let v = last === null ? 0 : last + 1; v < 35; v++) out.push((Math.floor(v / 5) + 1) + 'CDHSN'[v % 5]);
    if (last !== null && sideOf(lastBy) !== sideOf(seat) && dbl === 0) out.push('X');
    if (last !== null && sideOf(lastBy) === sideOf(seat) && dbl === 1) out.push('XX');
    return out;
  };
  const steps = [];
  for (const c of calls) {
    steps.push({ seat, legal: legal(), over });
    if (c === 'P') passes++;
    else {
      passes = 0;
      if (c === 'X') dbl = 1; else if (c === 'XX') dbl = 2;
      else {
        last = (+c[0] - 1) * 5 + 'CDHSN'.indexOf(c[1]); lastBy = seat; dbl = 0;
        const k = sideOf(seat) + c[1]; if (!(k in first)) first[k] = seat;
      }
    }
    n++;
    over = last === null ? passes === 4 : passes === 3;
    seat = nextSeat(seat);
  }
  steps.push({ seat, legal: legal(), over });
  const contract = last === null ? null : { level: Math.floor(last / 5) + 1, strain: 'CDHSN'[last % 5], doubled: dbl, declarer: first[sideOf(lastBy) + 'CDHSN'[last % 5]] };
  return { steps, contract };
}
let nAuc = 0;
for (let i = 0; i < N; i++) {
  const dealer = SEATS[ri(4)], auction = [];
  // random legal auction, biased to passes and doubles so that X/XX and the end come up often
  while (!auctionOver(auction) && auction.length < 60) {
    const seat = auctionTurn(dealer, auction), lc = legalCalls(dealer, auction);
    const x = rand();
    let call = x < 0.45 ? 'P' : x < 0.6 && lc.includes('X') ? 'X' : x < 0.7 && lc.includes('XX') ? 'XX' : lc[1 + ri(Math.min(6, lc.length - 1))] || 'P';
    if (!lc.includes(call)) call = 'P';
    auction.push({ call, by: seat });
  }
  const R = refAuction(dealer, auction.map(a => a.call));
  for (let k = 0; k <= auction.length; k++) {
    const pre = auction.slice(0, k), st = R.steps[k];
    if (auctionTurn(dealer, pre) !== st.seat) bad('turn', dealer, pre.map(a => a.call).join(' '));
    if (auctionOver(pre) !== st.over) bad('over', dealer, pre.map(a => a.call).join(' '), auctionOver(pre), st.over);
    const lc = legalCalls(dealer, pre);
    if (lc.slice().sort().join() !== st.legal.slice().sort().join()) bad('legal', dealer, pre.map(a => a.call).join(' '), lc.join(','), '/', st.legal.join(','));
    // every call that is not in the list is refused
    for (const c of ['P', 'X', 'XX', '1C', '3N', '7N', '4S']) if (isLegalCall(dealer, pre, c) !== st.legal.includes(c)) bad('isLegal', c, pre.map(a => a.call).join(' '));
  }
  const fc = finalContract(auction);
  if (JSON.stringify(fc) !== JSON.stringify(R.contract)) bad('contract', dealer, auction.map(a => a.call).join(' '), JSON.stringify(fc), JSON.stringify(R.contract));
  nAuc++;
}
console.log(`auctions: ${nAuc} random auctions`);

// ---- 5. tricks ----
let nTr = 0;
for (let i = 0; i < Math.ceil(N / 10); i++) {
  const hands = deal(rand), contract = { level: 1, strain: STRAINS[ri(5)], doubled: 0, declarer: SEATS[ri(4)] };
  const play = { tricks: [] };
  let leader = nextSeat(contract.declarer), declT = 0;
  for (let k = 0; k < 13; k++) {
    const cards = [];
    for (let j = 0; j < 4; j++) {
      const s = SEATS[(SEATS.indexOf(leader) + j) % 4];
      if (playTurn(play, contract) !== s) bad('playTurn', k, j);
      const rem = hands[s].filter(c => !cards.includes(c) && !play.tricks.some(t => t.cards.some(pc => pc.card === c)));
      const led = cards.length ? cards[0].card[0] : null;
      const want = led && rem.some(c => c[0] === led) ? rem.filter(c => c[0] === led) : rem;
      const got = legalPlays(hands, play, contract, s);
      if (got.slice().sort().join() !== want.slice().sort().join()) bad('legalPlays', k, j);
      const card = want[ri(want.length)];
      cards.push({ seat: s, card });
      applyPlay(play, contract, s, card);
    }
    // reference winner: highest trump if any trump was played, else highest of the suit led
    const tr = contract.strain === 'N' ? null : contract.strain;
    const pool = tr && cards.some(pc => pc.card[0] === tr) ? cards.filter(pc => pc.card[0] === tr) : cards.filter(pc => pc.card[0] === cards[0].card[0]);
    const w = pool.reduce((a, b) => RANKS.indexOf(b.card[1]) > RANKS.indexOf(a.card[1]) ? b : a).seat;
    if (trickWinner(play.tricks[k], contract.strain) !== w) bad('trickWinner', JSON.stringify(cards), contract.strain);
    if (sameSide(w, contract.declarer)) declT++;
    leader = w; nTr++;
  }
  const tw = tricksWon(play, contract);
  if (tw.decl !== declT || tw.def !== 13 - declT) bad('tricksWon');
}
console.log(`tricks: ${nTr} tricks`);

// ---- 6. par ----
// Reference: the auction as a game. The side to move either lets the current contract stand (doubled if it
// fails; undoubled if it makes) or bids any higher contract (its better declarer). Both orders of who may bid
// first are tried: the par score is the value of the game, and where the two orders differ (a "hot spot", seen on
// random tables only, never on 8000 real ones) parScore must give one of them.
function stand(dd, vul, side, v) { // [score for side, declarer] of contract v played by side's better declarer
  const level = Math.floor(v / 5) + 1, st = STRAINS[v % 5];
  let best = null;
  for (const d of side === 'NS' ? ['N', 'S'] : ['E', 'W']) {
    const t = dd[d][st], s = refScore(level, st, t >= level + 6 ? 0 : 1, isVul(vul, d), t);
    if (!best || s > best[0]) best = [s, d];
  }
  return best;
}
function refPar(dd, vul, firstSide) {
  const S = {}; for (const side of ['NS', 'EW']) { S[side] = []; for (let v = 0; v < 35; v++) S[side][v] = stand(dd, vul, side, v)[0]; }
  const memo = new Map();
  // best result for `mover` (in mover's own points)
  function best(v, mover, passedOnce) {
    const key = v + ',' + mover + passedOnce;
    if (memo.has(key)) return memo.get(key);
    const other = mover === 'NS' ? 'EW' : 'NS';
    let b = v >= 0 ? -S[other][v] : passedOnce ? 0 : -best(-1, other, true);
    for (let w = v + 1; w < 35; w++) b = Math.max(b, -best(w, other, false));
    memo.set(key, b);
    return b;
  }
  // (a bid w by mover: the other side then moves over w, and its pass is -S[mover][w] in its points)
  const r = best(-1, firstSide, false);
  return firstSide === 'NS' ? r : -r;
}
function randTable(kind) {
  const dd = { N: {}, E: {}, S: {}, W: {} };
  for (const st of STRAINS) {
    if (kind === 0) { for (const s of SEATS) dd[s][st] = ri(14); continue; }
    // a realistic table: one side's tricks around t, the other's around 13 - t
    const t = Math.max(0, Math.min(13, Math.round(6.5 + (rand() - 0.5) * (kind === 2 ? 14 : 8))));
    const j = () => (rand() < 0.2 ? ri(3) - 1 : 0);
    const c = x => Math.max(0, Math.min(13, x));
    dd.N[st] = c(t + j()); dd.S[st] = c(t + j()); dd.E[st] = c(13 - t + j()); dd.W[st] = c(13 - t + j());
  }
  return dd;
}
let nPar = 0, orderDep = 0;
for (let i = 0; i < N; i++) {
  const dd = randTable(i % 3), vul = ['None', 'NS', 'EW', 'Both'][ri(4)];
  const a = refPar(dd, vul, 'NS'), b = refPar(dd, vul, 'EW');
  const p = parScore(dd, vul);
  if (a !== b) { orderDep++; if (p.scoreNS !== a && p.scoreNS !== b) bad('par (order-dependent)', JSON.stringify(dd), vul, p.scoreNS, a, b); }
  else if (p.scoreNS !== a) bad('par', JSON.stringify(dd), vul, p.text, p.scoreNS, 'want', a);
  // the contract shown scores what it says
  if (p.contract) {
    const c = p.contract, t = dd[c.declarer][c.strain], s = scoreNS(c, t, vul);
    if (s !== p.scoreNS) bad('par contract score', p.text, s, p.scoreNS);
    if (c.doubled !== (t < c.level + 6 ? 1 : 0)) bad('par doubled iff down', p.text);
  } else if (p.scoreNS !== 0) bad('par passed out with a score');
  nPar++;
}
console.log(`par: ${nPar} tables (${orderDep} where it depends on who bids first)`);

// ---- 7. PBN export (js/analysis.js pbnBoard) read back by the PBN import (js/share.js parsePBN) ----
{
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = vm.createContext({ ...globalThis, window: { addEventListener() { } }, parScore, console });
  Object.assign(ctx, E);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/analysis.js'), 'utf8'), ctx);
  const SH = require('../js/share.js');
  let nPbn = 0;
  for (let i = 0; i < Math.ceil(N / 10); i++) {
    const board = 1 + ri(32), dealer = boardDealer(board), vul = boardVul(board), hands = deal(rand), auction = [];
    while (!auctionOver(auction)) {
      const lc = legalCalls(dealer, auction), x = rand();
      const call = x < 0.55 ? 'P' : x < 0.65 && lc.includes('X') ? 'X' : x < 0.7 && lc.includes('XX') ? 'XX' : lc[1 + ri(Math.min(5, lc.length - 1))] || 'P';
      auction.push({ call, by: auctionTurn(dealer, auction) });
    }
    const contract = finalContract(auction), play = { tricks: [] };
    const nCards = contract ? (i % 3 === 0 ? 4 * ri(13) : 52) : 0;
    for (let k = 0; k < nCards; k++) { const s = playTurn(play, contract), lp = legalPlays(hands, play, contract, s); applyPlay(play, contract, s, lp[ri(lp.length)]); }
    const declTricks = contract && nCards === 52 ? tricksWon(play, contract).decl : contract ? ri(14) : null;
    const h = { board, dealer, vul, hands, auction, contract, tricks: play.tricks, declTricks, scoreNS: contract ? scoreNS(contract, declTricks, vul) : 0 };
    const text = ctx.pbnBoard(h, { name: 'T "q"', seats: { N: { kind: 'robot' }, S: { name: 'Ann' } } });
    const r = SH.parsePBN(text);
    const same = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad('pbn ' + m, JSON.stringify(a), JSON.stringify(b), '\n' + text); };
    same(r.board, board, 'board'); same(r.dealer, dealer, 'dealer'); same(r.vul, vul, 'vul');
    for (const s of SEATS) same(sortHand(r.hands[s]), sortHand(hands[s]), 'hand ' + s);
    same(r.auction.map(a => a.call + a.by), auction.map(a => a.call + a.by), 'auction');
    same(r.contract, contract, 'contract');
    same(r.tricks.map(t => t.leader + t.cards.map(pc => pc.seat + pc.card).join('')), play.tricks.map(t => t.leader + t.cards.map(pc => pc.seat + pc.card).join('')), 'play');
    if (contract) { same(r.declTricks, declTricks, 'result'); same(r.scoreNS, h.scoreNS, 'score'); }
    nPbn++;
  }
  console.log(`pbn: ${nPbn} boards exported and read back`);
}

// ---- 8. claims (js/bots.js): exactTricks and sureTricks vs a reference minimax; the conservative count never too high ----
{
  const B = require('../js/bots.js');
  // reference: tricks for claimer's side from here, every legal card tried, memoised on the exact position
  function ref(t, claimer) {
    const st = t.contract.strain, memo = new Map(), h = {};
    for (const s of SEATS) h[s] = remainingHand(t.hands, t.play, s);
    const tr = t.play.tricks[t.play.tricks.length - 1], open = tr && tr.cards.length < 4;
    const win = cards => { // highest trump, else highest card of the suit led
      const pool = st !== 'N' && cards.some(pc => pc.card[0] === st) ? cards.filter(pc => pc.card[0] === st) : cards.filter(pc => pc.card[0] === cards[0].card[0]);
      return pool.reduce((a, b) => RANKS.indexOf(b.card[1]) > RANKS.indexOf(a.card[1]) ? b : a).seat;
    };
    function go(cards, seat) {
      if (cards.length === 4) { const w = win(cards); return (sameSide(w, claimer) ? 1 : 0) + (h[w].length ? go([], w) : 0); }
      // memoised at the start of each trick only (cheaper keys; the value is the same)
      const key = cards.length ? null : SEATS.map(x => h[x].join('')).join('|') + seat;
      if (key !== null && memo.has(key)) return memo.get(key);
      const led = cards.length && cards[0].card[0], follow = led && h[seat].some(c => c[0] === led);
      let best = null;
      for (const c of h[seat]) {
        if (follow && c[0] !== led) continue;
        const keep = h[seat]; h[seat] = keep.filter(x => x !== c);
        const v = go(cards.concat([{ seat, card: c }]), nextSeat(seat));
        h[seat] = keep;
        if (best === null || (sameSide(seat, claimer) ? v > best : v < best)) best = v;
      }
      if (key !== null) memo.set(key, best);
      return best;
    }
    return go(open ? tr.cards.slice() : [], playTurn(t.play, t.contract));
  }
  let nCl = 0, nTop = 0;
  for (let i = 0; i < Math.ceil(N / 6); i++) {
    const left = 1 + (i % 7), extra = i % 3 === 0 ? ri(4) : 0;
    const hands = deal(rand), contract = { level: 1, strain: STRAINS[ri(5)], doubled: 0, declarer: SEATS[ri(4)] };
    const t = { hands, contract, auction: [], play: { tricks: [] } };
    for (let k = 0; k < (13 - left) * 4 + extra; k++) { const s = playTurn(t.play, contract), lp = legalPlays(hands, t.play, contract, s); applyPlay(t.play, contract, s, lp[ri(lp.length)]); }
    const claimer = SEATS[ri(4)];
    const want = left <= 5 ? ref(t, claimer) : B.claimSolver(B.claimPos(t), SEATS.indexOf(claimer) & 1, Infinity).value();
    if (left <= 3) { const x = B.exactTricks(t, claimer); if (x !== want) bad('exactTricks', left, extra, x, want); }
    const st = B.sureTricks(t, claimer);
    if (st > want) bad('sureTricks too high', left, extra, st, want);
    if (left <= 5 && st !== want) bad('sureTricks', left, extra, st, want);
    const top = B.claimTopTricks(t, claimer);
    if (top > want) bad('claimTopTricks too high', left, extra, top, want, JSON.stringify(SEATS.map(s => remainingHand(hands, t.play, s))), contract.strain, claimer);
    for (const n of [0, want, want + 1]) if (n <= left && B.claimAccept(t, claimer, n) !== (n <= want)) bad('claimAccept', n, want);
    nCl++; if (top) nTop++;
  }
  console.log(`claims: ${nCl} endings of 1-7 tricks (${nTop} with a nonzero conservative count)`);
}

console.log(fails ? `${fails} failures` : 'all ok');
if (fails) process.exitCode = 1;
module.exports = { refScore, refPar, refAuction, randTable };
