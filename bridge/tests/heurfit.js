// Fits the weights of the heuristic robot's suit choices (js/bots.js) to double-dummy results, the way
// tests/leadsim.js fits the opening-lead prior: the robots play the boards (heuristic, all four seats), and at
// every decision of the chosen kind the real position is solved double-dummy. Each candidate suit's features
// (botFeatures in js/bots.js) and the tricks its card takes are recorded; a ridge regression on the
// differences between the suits of the same decision gives the weights.
// Usage: node tests/heurfit.js [boards=1500] [kind=switch] [seed=heurfit] [workers=cores-2]
//   kind switch: a defender on lead after the opening lead; discard: a discard (either side).
// Prints the weights for notrump and for suit contracts, ready to paste into js/bots.js, and how often the
// fitted choice and the current choice pick a best suit on the fitting boards.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os'), path = require('path'), fs = require('fs');

if (isMainThread) {
  const N = +process.argv[2] || 1500, kind = process.argv[3] || 'switch', seed = process.argv[4] || 'heurfit';
  const W = Math.max(1, +process.argv[5] || Math.max(1, os.cpus().length - 2));
  const recs = []; let done = 0, next = 0, live = W;
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { kind, seed } });
    const feed = () => wk.postMessage(next < N ? next++ : -1);
    wk.on('message', m => { if (m.ready) return feed(); done++; recs.push(...m.recs); feed(); });
    wk.on('error', e => { console.error(e); process.exitCode = 1; });
    wk.on('exit', () => { if (--live === 0) fit(); });
  }
  function fit() {
    const NEWB = require('../js/bots.js');
    const names = NEWB.botFeatureNames(kind);
    for (const st of [...new Set(recs.map(r => r.st))].sort()) {
      const rs = recs.filter(r => r.st === st);
      const d = names.length, XtX = Array.from({ length: d }, () => new Array(d).fill(0)), Xty = new Array(d).fill(0);
      for (const r of rs) {
        const k = r.opts.length, mf = new Array(d).fill(0); let my = 0;
        for (const o of r.opts) { o.f.forEach((v, i) => mf[i] += v / k); my += o.y / k; }
        for (const o of r.opts) {
          const x = o.f.map((v, i) => v - mf[i]), y = o.y - my;
          for (let i = 0; i < d; i++) { Xty[i] += x[i] * y; for (let j = 0; j < d; j++) XtX[i][j] += x[i] * x[j]; }
        }
      }
      const lam = 5; for (let i = 0; i < d; i++) XtX[i][i] += lam;
      const w = solve(XtX, Xty);
      const pickRate = wt => { let best = 0, loss = 0; for (const r of rs) { const sc = r.opts.map(o => o.f.reduce((a, v, i) => a + v * wt[i], 0)); const i = sc.indexOf(Math.max(...sc)); const top = Math.max(...r.opts.map(o => o.y)); if (r.opts[i].y === top) best++; loss += top - r.opts[i].y; } return `best ${(100 * best / rs.length).toFixed(1)}%, loss ${(loss / rs.length).toFixed(3)}`; };
      const cur = rs.length ? (() => { let best = 0, loss = 0; for (const r of rs) { const top = Math.max(...r.opts.map(o => o.y)); const o = r.opts.find(o => o.cur) || r.opts[0]; if (o.y === top) best++; loss += top - o.y; } return `best ${(100 * best / rs.length).toFixed(1)}%, loss ${(loss / rs.length).toFixed(3)}`; })() : '';
      console.log(`${st}: ${rs.length} decisions on ${done} boards; fitted ${pickRate(w)}; current ${cur}`);
      console.log('  ' + JSON.stringify(Object.fromEntries(names.map((n, i) => [n, +(w[i] * 10).toFixed(1)]))));
    }
  }
  function solve(A, b) { // Gaussian elimination
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < n; i++) {
      let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
      [M[i], M[p]] = [M[p], M[i]];
      for (let j = i + 1; j < n; j++) { const f = M[j][i] / M[i][i]; for (let k = i; k <= n; k++) M[j][k] -= f * M[i][k]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
} else {
  Object.assign(globalThis, require('../js/engine.js'));
  const NEWB = require('../js/bots.js');
  const D = require('../js/ddplay.js');
  const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
  const create = require(path.join(wasmDir, 'compiled.js'));
  const { kind, seed } = workerData;
  let solve = null;
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const rand = seededRand(seed + ':' + g);
    const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = NEWB.botCall(hands[s], s, dealer, auction, vul); auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s }); }
    const ct = finalContract(auction), recs = [];
    if (ct) {
      const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
      for (let i = 0; i < 52; i++) {
        const s = playTurn(t.play, ct);
        const card = NEWB.botPlay(t, s);
        const F = NEWB.botFeatures(t, s, kind);
        if (F) {
          const view = D.ddView(t, s);
          const rem = {}; for (const x of SEATS) rem[x] = remainingHand(hands, t.play, x);
          const r = await solve(D.ddJob(view, rem));
          recs.push({ st: F.group, opts: F.opts.map(o => ({ f: o.f, y: r[o.card], cur: suitOf(o.card) === suitOf(card) })) });
        }
        applyPlay(t.play, ct, s, card);
      }
    }
    parentPort.postMessage({ g, recs });
  });
  (async () => {
    const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
    solve = D.ddSolver(create, mod);
    parentPort.postMessage({ ready: true });
  })();
}
