// Checks the WebAssembly double-dummy solver (js/wasm) against a brute-force search on small endings.
// Usage: node tests/ddtest.js [games]   (default 200)
Object.assign(globalThis, require('../js/engine.js'));
const fs = require('fs'), path = require('path');
const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
const create = require(path.join(wasmDir, 'compiled.js'));
const RANKS = '23456789TJQKA';

function brute(hands, strain, leader) { // best tricks for N-S by exhaustive minimax
  function rec(h, leader, trick) {
    if (trick.length === 4) {
      const w = trickWinner({ cards: trick }, strain), r = sideOf(w) === 'NS' ? 1 : 0;
      return h[w].length === 0 ? r : r + rec(h, w, []);
    }
    const p = trick.length ? nextSeat(trick[trick.length - 1].seat) : leader;
    let cards = h[p];
    if (trick.length) { const led = trick[0].card[0], f = cards.filter(c => c[0] === led); if (f.length) cards = f; }
    let best = sideOf(p) === 'NS' ? -1 : 99;
    for (const c of cards) {
      const v = rec({ ...h, [p]: h[p].filter(x => x !== c) }, leader, [...trick, { seat: p, card: c }]);
      best = sideOf(p) === 'NS' ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  }
  return rec(hands, leader, []);
}

(async () => {
  const D = require('../js/ddplay.js');
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
  // One instance for every solve, as in the page (js/dds-worker.js): DDS keeps its transposition table between
  // solves of the same or a similar deal, so reuse is what needs checking. FRESH=1 gives every solve a new instance.
  const fresh = () => D.ddInstance(create, mod), FRESH = !!process.env.FRESH;
  const shared = await fresh();
  async function dds(hands, strain, leader) { // N-S tricks
    const inst = FRESH ? await fresh() : shared;
    const r = D.ddSolveRaw(inst, { S: 0, H: 1, D: 2, C: 3, N: 4 }[strain], SEATS.indexOf(leader), [], D.ddPBN(hands));
    const best = Math.max(-1, ...r.map(x => x.tricks));
    return sideOf(leader) === 'NS' ? best : hands.N.length - best;
  }
  let bad = 0; const games = +process.argv[2] || 200;
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3), full = deal(), all = SEATS.flatMap(s => full[s]).sort(() => Math.random() - .5), hands = {};
    SEATS.forEach((s, i) => hands[s] = all.slice(i * n, i * n + n));
    const strain = ['N', 'S', 'H', 'D', 'C'][g % 5], leader = SEATS[g % 4];
    const b = brute(hands, strain, leader), d = await dds(hands, strain, leader);
    if (b !== d) { bad++; if (bad < 4) console.log('mismatch', JSON.stringify(hands), strain, leader, 'brute', b, 'dds', d); }
  }
  console.log('endings', games, 'mismatches', bad);

  // The robot's solver call (js/ddplay.js ddRun): mid-trick positions, a result for every legal card
  // (DDS lists one card of each run of equals; ddRun fills in the rest). Checked card by card against brute force.
  const solve = D.ddSolver(create, mod, { fresh: FRESH });
  function bruteCard(h, trick, strain, mover) { // tricks for mover's side from here, trick = cards so far incl. mover's
    function rec(h, trick, turn) {
      if (trick.length === 4) { const w = trickWinner({ cards: trick }, strain), r = sameSide(w, mover) ? 1 : 0; return h[w].length === 0 ? r : r + rec(h, [], w); }
      let cards = h[turn]; if (trick.length) { const f = cards.filter(c => c[0] === trick[0].card[0]); if (f.length) cards = f; }
      let best = sameSide(turn, mover) ? -1 : 99;
      for (const c of cards) { const v = rec({ ...h, [turn]: h[turn].filter(x => x !== c) }, [...trick, { seat: turn, card: c }], nextSeat(turn)); best = sameSide(turn, mover) ? Math.max(best, v) : Math.min(best, v); }
      return best;
    }
    return rec(h, trick, trick.length === 4 ? null : nextSeat(trick[trick.length - 1].seat));
  }
  let cards = 0, bad2 = 0;
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3), full = deal(), all = SEATS.flatMap(s => full[s]).sort(() => Math.random() - .5), h = {};
    SEATS.forEach((s, i) => h[s] = all.slice(i * n, i * n + n));
    const strain = ['N', 'S', 'H', 'D', 'C'][g % 5], leader = SEATS[g % 4], trick = [];
    let turn = leader;
    for (let i = 0; i < g % 4; i++) { // play 0-3 random cards to the trick
      let cs = h[turn]; if (trick.length) { const f = cs.filter(c => c[0] === trick[0].card[0]); if (f.length) cs = f; }
      const c = cs[Math.floor(Math.random() * cs.length)]; trick.push({ seat: turn, card: c }); h[turn] = h[turn].filter(x => x !== c); turn = nextSeat(turn);
    }
    const r = await solve({ trump: { S: 0, H: 1, D: 2, C: 3, N: 4 }[strain], first: SEATS.indexOf(leader), trick: trick.map(p => p.card), pbn: D.ddPBN(h), hands: h, mover: turn });
    let legal = h[turn]; if (trick.length) { const f = legal.filter(c => c[0] === trick[0].card[0]); if (f.length) legal = f; }
    for (const c of legal) {
      cards++;
      const b = bruteCard({ ...h, [turn]: h[turn].filter(x => x !== c) }, [...trick, { seat: turn, card: c }], strain, turn);
      if (r[c] !== b) { bad2++; if (bad2 < 4) console.log('card mismatch', JSON.stringify(h), strain, JSON.stringify(trick), c, 'brute', b, 'ddRun', r[c]); }
    }
  }
  console.log('mid-trick cards', cards, 'mismatches', bad2);

  // Full deals and sampled layouts of one view (similar deals, where DDS keeps its table), several leaders and
  // strains in a row: the reused instance against a fresh instance for every solve.
  let deals = 0, bad4 = 0;
  const nFull = Math.max(4, Math.round(games / 50));
  for (let g = 0; g < nFull; g++) {
    const base = deal(seededRand('full' + g + Math.random()));
    const known = g % 2 ? ['N', 'S'] : ['W'], pool = SEATS.filter(s => !known.includes(s)).flatMap(s => base[s]);
    for (let j = 0; j < 4; j++) {
      const h = { ...base }, cs = pool.slice().sort(() => Math.random() - .5);
      SEATS.filter(s => !known.includes(s)).forEach((s, i) => h[s] = cs.slice(i * 13, i * 13 + 13));
      const strain = ['N', 'S', 'H', 'D', 'C'][(g + j) % 5], leader = SEATS[(g + j) % 4];
      const job = { trump: { S: 0, H: 1, D: 2, C: 3, N: 4 }[strain], first: SEATS.indexOf(leader), trick: [], pbn: D.ddPBN(h), hands: h, mover: leader };
      const a = D.ddRun(shared, job), b = D.ddRun(await fresh(), job);
      deals++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad4++; if (bad4 < 4) console.log('full deal mismatch', job.pbn, strain, leader, JSON.stringify(a), JSON.stringify(b)); }
    }
  }
  console.log('full deals, reused vs fresh instance', deals, 'mismatches', bad4);

  // The robot's view holds only cards it may see, and sampled layouts agree with everything it knows.
  const Bots = require('../js/bots.js'); globalThis.shown = Bots.shown;
  let bad3 = 0;
  const check = (ok, msg) => { if (!ok) { bad3++; if (bad3 < 4) console.log('sampler:', msg); } };
  for (let g = 0; g < 40; g++) {
    const hands = deal(seededRand('ddview' + g)), dealer = boardDealer(g + 1), auction = [];
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = Bots.botCall(hands[s], s, dealer, auction, boardVul(g + 1)); auction.push({ call: r.call, by: s }); }
    const ct = finalContract(auction); if (!ct) continue;
    const t = { hands, auction, contract: ct, vul: boardVul(g + 1), play: { tricks: [] } };
    for (let i = 0; i < 52; i++) {
      const s = playTurn(t.play, ct);
      if (i % 7 === 0) {
        const v = D.ddView(t, s), dummy = partnerOf(ct.declarer);
        const may = sameSide(s, ct.declarer) ? [ct.declarer, dummy] : i ? [s, dummy] : [s];
        check(Object.keys(v.known).sort().join() === may.sort().join(), 'view shows ' + Object.keys(v.known));
        check(!JSON.stringify(v).includes('"hands"'), 'view carries the hands');
        // everyone here plays botPlay, the play model of ddConsistency, so the real layout fits the play perfectly
        const real = {}; for (const x of SEATS) real[x] = remainingHand(hands, t.play, x);
        check(D.ddConsistency(v, real) === 1, 'real layout does not fit the play');
        for (const h of D.ddSample(v, 5, seededRand('s' + g + i))) {
          const all = SEATS.flatMap(x => h[x]), played = [...playedCards(t.play)];
          check(new Set(all.concat(played)).size === 52 && all.length + played.length === 52, 'not a deck');
          for (const x of SEATS) check(h[x].length === remainingHand(hands, t.play, x).length, 'hand size');
          for (const x of may) check(h[x].join() === remainingHand(hands, t.play, x).join(), 'known hand changed');
          for (const tr of t.play.tricks) for (const pc of tr.cards) if (suitOf(pc.card) !== suitOf(tr.cards[0].card)) check(!h[pc.seat].some(c => suitOf(c) === suitOf(tr.cards[0].card)), 'void ignored');
        }
      }
      applyPlay(t.play, ct, s, Bots.botPlay(t, s));
    }
  }
  console.log('robot view and sampler checks', bad3 ? 'FAILED ' + bad3 : 'ok');
  process.exit(bad || bad2 || bad3 || bad4 ? 1 : 0);
})();
