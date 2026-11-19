// Decision accuracy of the solver play: cheaper and steadier than playing whole boards out (tests/playsim.js).
// Deals boards with robot auctions, plays them out with the heuristic robot, and at robot decisions (every card where
// the solver is worth asking) lets the page's sampler choose a card with the current options and with new ones. Each
// choice is scored on the real deal, double dummy: what it costs against the best card there, in tricks and in IMPs
// (from the score of the contract). Paired per decision, so the difference has a small error.
// Usage: NEW='{"relax":0.05}' node tests/ddacc.js [boards=200] [workers=cores-2] [seed=ddacc] [every=3]
//   ODD=1 / DBL=1 as in tests/playsim.js (a player bids as if holding another hand; every contract doubled).
//   SIDE=decl|def: only the declaring side's or the defenders' decisions (default both, reported apart).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os'), path = require('path'), fs = require('fs');

if (isMainThread) {
  const N = +process.argv[2] || 200, W = Math.max(1, +process.argv[3] || Math.max(1, os.cpus().length - 2));
  const seed = process.argv[4] || 'ddacc', every = +process.argv[5] || 3;
  const acc = {}; let done = 0, next = 0, live = W; const t0 = Date.now();
  const add = (k, d) => { const a = acc[k] || (acc[k] = { n: 0, tr: 0, tr2: 0, imp: 0, imp2: 0, ch: 0, ms0: 0, ms1: 0, base: 0 }); a.n++; a.tr += d.tr; a.tr2 += d.tr * d.tr; a.imp += d.imp; a.imp2 += d.imp * d.imp; if (d.ch) a.ch++; a.ms0 += d.ms0; a.ms1 += d.ms1; a.base += d.base; };
  const report = () => {
    console.log(`boards ${done} (${W} workers, ${((Date.now() - t0) / 1000).toFixed(0)} s); gain of the new options per decision (positive = better)`);
    for (const k of Object.keys(acc).sort()) {
      const a = acc[k], f = (s, s2) => { const m = s / a.n, se = Math.sqrt(Math.max(0, s2 / a.n - m * m) / a.n); return `${m >= 0 ? '+' : ''}${m.toFixed(4)} ± ${se.toFixed(4)}`; };
      console.log(`  ${k.padEnd(5)} ${a.n} decisions, ${a.ch} changed   IMPs ${f(a.imp, a.imp2)}   tricks ${f(a.tr, a.tr2)}   current card's loss ${(a.base / a.n).toFixed(3)} IMPs   ms ${(a.ms0 / a.n).toFixed(0)} -> ${(a.ms1 / a.n).toFixed(0)}`);
    }
  };
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { seed, every } });
    const feed = () => wk.postMessage(next < N ? next++ : -1);
    wk.on('message', m => {
      if (m.ready) return feed();
      done++; for (const d of m.res) add(d.side, d);
      if (done % 50 === 0) report();
      feed();
    });
    wk.on('error', e => { console.error(e); process.exitCode = 1; });
    wk.on('exit', () => { if (--live === 0) report(); });
  }
} else {
  Object.assign(globalThis, require('../js/engine.js'));
  const B = require('../js/bots.js'); globalThis.shown = B.shown;
  const D = require('../js/ddplay.js');
  const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
  const create = require(path.join(wasmDir, 'compiled.js'));
  const { seed, every } = workerData;
  const NEW = JSON.parse(process.env.NEW || '{}');
  const CUR = JSON.parse(process.env.CUR_JSON || 'null') || { k: 20, lead: 'conv', leadTol: 30, minK: 8,
    declarer: { pool: 96, weigh: 1, wOpp: 0.8, relax: 0.05, stop: 1 }, defender: { pool: 96, weigh: 1, wOpp: 0.8, wPart: 0.8, relax: 0.05, stop: 1 } };
  const merge = (base, X) => ({ ...base, ...X, declarer: { ...base.declarer, ...X, ...X.declarer }, defender: { ...base.defender, ...X, ...X.defender } });
  let solve = null;
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const rand = seededRand(seed + ':' + g);
    const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
    const liar = process.env.ODD ? SEATS[g % 4] : null, fake = liar ? deal(seededRand(seed + ':fake:' + g))[SEATS[(g + 1) % 4]] : null;
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = B.botCall(s === liar ? fake : hands[s], s, dealer, auction, vul); auction.push({ call: r.call, by: s }); }
    const ct = finalContract(auction), res = [];
    if (ct) {
      if (process.env.DBL && !ct.doubled) ct.doubled = +process.env.DBL;
      const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
      for (let i = 0; i < 52; i++) {
        const s = playTurn(t.play, ct), prefer = B.botPlay(t, s);
        const side = sameSide(s, ct.declarer) ? 'decl' : 'def';
        if (i % every === 0 && (!process.env.SIDE || process.env.SIDE === side)) {
          const v0 = D.ddView(t, s, CUR);
          if (D.ddWorthIt(v0)) {
            const o0 = { ...CUR, prefer, rand: seededRand(seed + ':c:' + g + ':' + i) }, o1 = { ...merge(CUR, NEW), prefer, rand: seededRand(seed + ':c:' + g + ':' + i) };
            const a = await D.ddChoose(v0, solve, o0), b = await D.ddChoose(D.ddView(t, s, o1), solve, o1);
            if (a && b) {
              // the real deal, solved for the player to move: tricks for its side from here with each card
              const real = {}; for (const x of SEATS) real[x] = remainingHand(hands, t.play, x);
              const r = await solve(D.ddJob(v0, real));
              let won = 0; for (const tr of t.play.tricks) if (tr.cards.length === 4 && sameSide(trickWinner(tr, ct.strain), s)) won++;
              const onDecl = sameSide(s, ct.declarer);
              const pts = c => { const mine = won + r[c], sc = scoreContract(ct, onDecl ? mine : 13 - mine, vul); return onDecl ? sc : -sc; };
              const best = Math.max(...Object.keys(r).map(pts)), bestTr = Math.max(...Object.values(r));
              const lossI = c => toImps(best - pts(c)), lossT = c => bestTr - r[c];
              res.push({ side: ct.doubled ? side + 'X' : side, tr: lossT(a.card) - lossT(b.card), imp: lossI(a.card) - lossI(b.card), ch: a.card !== b.card, ms0: a.ms, ms1: b.ms, base: lossI(a.card) });
              if (i === 0) res.push({ side: 'lead', tr: lossT(a.card) - lossT(b.card), imp: lossI(a.card) - lossI(b.card), ch: a.card !== b.card, ms0: a.ms, ms1: b.ms, base: lossI(a.card) });
            }
          }
        }
        applyPlay(t.play, ct, s, prefer);
      }
    }
    parentPort.postMessage({ g, res });
  });
  (async () => {
    const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
    solve = D.ddSolver(create, mod);
    parentPort.postMessage({ ready: true });
  })();
}
