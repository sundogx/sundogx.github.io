// Opening leads (js/leads.js): builds a data set of robot auctions with double-dummy results for every lead, then
// compares lead rules on it. Solving is the slow part, so it is done once per board and saved:
//   node tests/leadsim.js gen <file.jsonl> [boards=1000] [seed=leads] [workers=cores-2] [K=32] [Kold=24]
// For each board: the robots' auction and contract, the true double-dummy result of every opening lead, and the
// solver's results on K layouts dealt by the lead sampler (leadLimits) and Kold layouts by the play sampler
// (ddAuctionLimits, what the shipped lead used). Then
//   node tests/leadsim.js score <file.jsonl>...
// scores lead rules by the true double-dummy result of the lead each one picks: IMPs per board against the
// previously shipped rule (heuristic lead, replaced by another suit's conventional card only if the solver
// rates it 30 points better on 24 layouts), and the change in how often the contract is set.
// The heuristic robots' play after each lead (botPlay) is reported too ("played out"). And
//   node tests/leadsim.js fit <file.jsonl>... [lambda=30]
// fits the prior's weights (LEAD_W in js/leads.js): ridge regression of each lead's double-dummy tricks, against the
// average lead from the same hand, on the lead features.
//   node tests/leadsim.js tune <file.jsonl>...
// compares the solver lead's number of layouts, prior weight and metric against the page's (needs files made with K >= 96;
// odd boards are held out). OLDLIM=nobal with gen makes the Kold layouts with the lead sampler minus the balanced-hand limit.
// tests/playsim.js plays the leads out with the robots instead of double-dummy.
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
Object.assign(globalThis, require('../js/engine.js'));
const B = require('../js/bots.js'); globalThis.shown = B.shown;
const D = require('../js/ddplay.js'); Object.assign(globalThis, D);
const L = require('../js/leads.js');

function board(seed, g) {
  const rand = seededRand(seed + ':' + g);
  const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
  while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = B.botCall(hands[s], s, dealer, auction, vul); auction.push({ call: r.call, by: s }); }
  return { hands, auction, vul, ct: finalContract(auction) };
}

if (isMainThread && process.argv[2] === 'gen') {
  const file = process.argv[3], N = +process.argv[4] || 1000, seed = process.argv[5] || 'leads';
  const W = Math.max(1, +process.argv[6] || os.cpus().length - 2), K = +process.argv[7] || 32, Kold = process.argv[8] !== undefined ? +process.argv[8] : 24;
  const out = fs.createWriteStream(file);
  let next = 0, done = 0, live = W; const t0 = Date.now();
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { seed, K, Kold } });
    const feed = () => wk.postMessage(next < N ? next++ : -1);
    wk.on('message', m => {
      if (m.ready) return feed();
      if (m.rec) out.write(JSON.stringify(m.rec) + '\n');
      if (++done % 50 === 0) console.log(`${done}/${N} boards, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      feed();
    });
    wk.on('error', e => { console.error(e); process.exitCode = 1; });
    wk.on('exit', () => { if (--live === 0) out.end(() => console.log('wrote', file)); });
  }
} else if (!isMainThread) {
  const create = require('../js/wasm/compiled.js');
  const { seed, K, Kold } = workerData;
  let solve;
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const { hands, auction, vul, ct } = board(seed, g);
    if (!ct) return parentPort.postMessage({ g });
    const leader = nextSeat(ct.declarer);
    const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
    const view = { ...ddView(t, leader), auction };
    const actual = await solve(ddJob(view, hands));
    const limits = {}; for (const s of SEATS) if (s !== leader) limits[s] = L.leadLimits(auction, s, vul);
    const sNew = [], sOld = [];
    for (const h of ddSample({ ...view, limits }, K, seededRand(seed + ':new:' + g))) sNew.push(await solve(ddJob(view, h)));
    // OLDLIM=nobal: sOld from the lead sampler without the balanced-hand limit (to measure it), else the play sampler's
    const oldView = process.env.OLDLIM === 'nobal' ? { ...view, limits: Object.fromEntries(Object.entries(limits).map(([s, k]) => [s, { ...k, bal: false }])) } : view;
    if (Kold) for (const h of ddSample(oldView, Kold, seededRand(seed + ':old:' + g))) sOld.push(await solve(ddJob(view, h)));
    parentPort.postMessage({ g, rec: { g, leader, hand: hands[leader], hands, auction, ct, vul, actual, sNew, sOld, heur: B.botPlayOld(t, leader) } });
  });
  (async () => {
    const mod = await WebAssembly.compile(fs.readFileSync(path.join(__dirname, '..', 'js', 'wasm', 'compiled.wasm')));
    solve = D.ddSolver(create, mod);
    parentPort.postMessage({ ready: true });
  })();
} else if (process.argv[2] === 'score') {
  const recs = load(process.argv.slice(3));
  const old = recs.every(r => r.sOld.length);
  evaluate(recs, leadRules({ old }), old ? 'shipped' : 'heurOld');
} else if (process.argv[2] === 'tune') {
  // node tests/leadsim.js tune <files...>: layouts (k), prior weight (w) and metric of the solver lead, against the
  // page's setting (k=48, w=2, tricks). Needs files made with K >= 96. Half the boards (odd g) are held out.
  const recs = load(process.argv.slice(3)).filter(r => r.sNew.length >= 96);
  const cands = r => L.leadCards(r.hand, r.ct.strain);
  const rule = (k, w, metric) => r => L.leadPick(recView(r), cands(r), r.sNew.slice(0, k), { w, metric }).card;
  const rules = { base: rule(48, 2, 'tricks'), botLead: r => L.botLead(r.hand, r.auction, r.ct, r.leader) };
  for (const k of [24, 48, 72, 96]) for (const w of [0, 1, 2, 3]) rules[`k${k}w${w}`] = rule(k, w, 'tricks');
  for (const k of [48, 96]) for (const w of [1, 2]) { rules[`k${k}w${w}imp`] = rule(k, w * 4, 'imp'); }
  for (const half of [0, 1]) {
    console.log(half ? 'held out (odd boards):' : 'tuning (even boards):');
    evaluate(recs.filter(r => r.g % 2 === half), rules, 'base', false, false);
  }
} else if (process.argv[2] === 'tunex') {
  // node tests/leadsim.js tunex <files...>: leads against doubled contracts. Every contract is scored doubled (DBL=2:
  // redoubled; the solver's tricks don't depend on it), and the solver lead's metric and prior weight are compared
  // against averaging tricks with weight 2 (k = 48, the page's). Half the boards (odd g) are held out.
  const X = +process.env.DBL || 1;
  const recs = load(process.argv.slice(3)).filter(r => r.sNew.length >= 48).map(r => ({ ...r, ct: { ...r.ct, doubled: r.ct.doubled || X } }));
  const cands = r => L.leadCards(r.hand, r.ct.strain);
  const rule = (w, metric) => r => L.leadPick(recView(r), cands(r), r.sNew.slice(0, 48), { w, metric }).card;
  const rules = { base: rule(2, 'tricks'), botLead: r => L.botLead(r.hand, r.auction, r.ct, r.leader) };
  for (const w of [1, 2, 3, 4, 6]) rules[`score${w}`] = rule(w, 'score');
  for (const w of [4, 8, 12]) rules[`imp${w}`] = rule(w, 'imp');
  for (const half of [0, 1]) {
    console.log(half ? 'held out (odd boards):' : 'tuning (even boards):');
    evaluate(recs.filter(r => r.g % 2 === half), rules, 'base', false, false);
  }
} else if (process.argv[2] === 'fit') {
  const W = fitW(load(process.argv.slice(3).filter(f => !f.startsWith('lambda='))), +(process.argv.find(a => a.startsWith('lambda=')) || 'lambda=30').slice(7));
  for (const k of ['N', 'S']) console.log(k, L.LEAD_FEATURES.map((n, i) => `${n} ${W[k][i].toFixed(2)}`).join(', '));
  console.log(JSON.stringify({ N: W.N.map(v => +v.toFixed(2)), S: W.S.map(v => +v.toFixed(2)) }));
} else {
  console.log('usage: node tests/leadsim.js gen <file> [boards] [seed] [workers] [K] [Kold] | score <files...> | fit <files...> [lambda=30]');
}

function load(files) {
  const recs = [];
  for (const f of files) for (const line of fs.readFileSync(f, "utf8").split("\n")) if (line) { const r = JSON.parse(line); r.uid = f + ":" + r.g; recs.push(r); }
  return recs;
}
// The view a lead rule gets for a record: only the leader's hand, plus leadView's limits and prior.
function recView(r, W) {
  const v = L.leadView({ seat: r.leader, vul: r.vul, contract: r.ct, tricks: [], known: { [r.leader]: r.hand }, limits: {} }, { auction: r.auction, contract: r.ct });
  if (W) v.prior = L.leadPrior(r.hand, r.auction, r.ct, r.leader, W[r.ct.strain === 'N' ? 'N' : 'S']);
  return v;
}
// Lead rules: rec -> card. opts: k (layouts used)
function leadRules(opts = {}) {
  const shipped = r => { // heuristic, replaced only by another suit's conventional card scoring 30+ points better (24 layouts)
    const v = recView(r), cands = ddLeadCards(r.hand, r.ct.strain);
    if (!cands.includes(r.heur)) cands.push(r.heur);
    return ddPick(v, cands, r.sOld, r.heur, { tol: 30 }).card;
  };
  const k = opts.k || 24, cands = r => L.leadCards(r.hand, r.ct.strain);
  const rules = {
    heurOld: r => r.heur, // the previous heuristic lead (botPlayOld)
    botLead: r => L.botLead(r.hand, r.auction, r.ct, r.leader), // the new heuristic lead: best prior
    ddOnly: r => L.leadPick(recView(r), cands(r), r.sNew.slice(0, k), { w: 0 }).card, // solver, no prior
    leadDD: r => L.leadPick(recView(r), cands(r), r.sNew.slice(0, k)).card, // the new solver lead
  };
  if (opts.old !== false) rules.shipped = shipped;
  return rules;
}
// Prior weights: ridge regression per contract kind (N, suits) of tricks against the hand's average lead.
function fitW(recs, lambda = 30) {
  const F = L.LEAD_FEATURES.length, W = {};
  for (const kind of ['N', 'S']) {
    const A = Array.from({ length: F }, () => Array(F + 1).fill(0));
    for (const r of recs) {
      if ((r.ct.strain === 'N') !== (kind === 'N')) continue;
      const cands = L.leadCards(r.hand, r.ct.strain), ctx = L.leadContext(r.hand, r.auction, r.ct, r.leader);
      const xs = cands.map(c => L.leadFeatures(r.hand, c[0], r.auction, r.ct, r.leader, ctx));
      const my = cands.reduce((a, c) => a + r.actual[c], 0) / cands.length;
      const mx = Array(F).fill(0); xs.forEach(x => x.forEach((v, i) => mx[i] += v / xs.length));
      cands.forEach((c, j) => {
        const x = xs[j].map((v, i) => v - mx[i]), y = r.actual[c] - my;
        for (let i = 0; i < F; i++) { A[i][F] += x[i] * y; for (let m = 0; m < F; m++) A[i][m] += x[i] * x[m]; }
      });
    }
    for (let i = 0; i < F; i++) A[i][i] += lambda;
    for (let i = 0; i < F; i++) { // Gauss-Jordan
      let p = i; for (let q = i + 1; q < F; q++) if (Math.abs(A[q][i]) > Math.abs(A[p][i])) p = q;
      [A[i], A[p]] = [A[p], A[i]];
      for (let q = 0; q < F; q++) if (q !== i) { const f = A[q][i] / A[i][i]; for (let m = i; m <= F; m++) A[q][m] -= f * A[i][m]; }
    }
    W[kind] = A.map((row, i) => row[F] / row[i]);
  }
  return W;
}
// The board played out by the heuristic robots (botPlay) after this opening lead: declarer's tricks.
var playCache; // (var: the commands above run before this line)
function playOut(r, card) {
  if (!playCache) playCache = new Map();
  const key = r.uid + ':' + card;
  if (playCache.has(key)) return playCache.get(key);
  const t = { hands: r.hands, auction: r.auction, contract: r.ct, vul: r.vul, play: { tricks: [] } };
  applyPlay(t.play, r.ct, r.leader, card);
  for (let i = 1; i < 52; i++) { const s = playTurn(t.play, r.ct); applyPlay(t.play, r.ct, s, B.botPlay(t, s)); }
  const d = tricksWon(t.play, r.ct).decl;
  playCache.set(key, d);
  return d;
}
function defScore(r, card) { return -scoreContract(r.ct, 13 - r.actual[card], r.vul); }
function evaluate(recs, rules, base, quiet, play = true) {
  const res = {};
  for (const name in rules) {
    let n = 0, s = 0, s2 = 0, sets = 0, setsB = 0, tr = 0, same = 0, p = 0, p2 = 0;
    for (const r of recs) {
      const a = rules[name](r), b = rules[base](r);
      const d = toImps(defScore(r, a) - defScore(r, b));
      n++; s += d; s2 += d * d; tr += r.actual[a] - r.actual[b]; if (a === b) same++;
      const need = 7 - r.ct.level; // defenders' tricks to set
      if (r.actual[a] >= need) sets++; if (r.actual[b] >= need) setsB++;
      if (play && a !== b) { const q = toImps(scoreContract(r.ct, playOut(r, b), r.vul) - scoreContract(r.ct, playOut(r, a), r.vul)); p += q; p2 += q * q; }
    }
    const m = s / n, se = Math.sqrt(Math.max(0, s2 / n - m * m) / n);
    const pm = p / n, pse = Math.sqrt(Math.max(0, p2 / n - pm * pm) / n);
    res[name] = { m, se, pm, pse };
    if (!quiet) console.log(`${name.padEnd(10)} DD IMPs/board ${m >= 0 ? '+' : ''}${m.toFixed(3)} ± ${se.toFixed(3)}  tricks ${(tr / n >= 0 ? '+' : '') + (tr / n).toFixed(3)}  set ${(100 * sets / n).toFixed(1)}% (vs ${(100 * setsB / n).toFixed(1)}%)  same lead ${(100 * same / n).toFixed(0)}%` + (play ? `  played out ${pm >= 0 ? '+' : ''}${pm.toFixed(3)} ± ${pse.toFixed(3)}` : '') + `  n=${n}`);
  }
  return res;
}
if (typeof module !== 'undefined') module.exports = { load, leadRules, evaluate, recView, defScore, fitW };
