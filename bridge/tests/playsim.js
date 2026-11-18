// Paired comparison of robot card play: double-dummy sampling (js/ddplay.js) against the heuristic robot (botPlay).
// Same deals, same auctions (the robots' own bidding), same contracts; only the card play of one side changes.
// Usage: node tests/playsim.js [boards=200] [K=20] [variants=decl,def,deflead] [workers=cores-2] [seed=playsim]
//   decl     declarer (and dummy) play by sampling, defenders heuristic
//   def      both defenders by sampling, including the opening lead
//   defnl    defenders by sampling, but the opening lead is the heuristic one
//   lead     only the opening lead by sampling, everything else heuristic
//   leadc    only the opening lead, by js/leads.js (leadChoose: solver plus lead prior; leadct is now the same)
//   defc     defenders by sampling, with the js/leads.js opening lead (defct: the same)
// The heuristic base robot leads with botLead (js/leads.js). tests/leadsim.js measures leads alone, more cheaply.
// Against the current sampler instead of the heuristic: all four seats play by sampling with the settings the
// page uses (K layouts, the conventional lead with the 30-point rule), and one side gets new options:
//   ndecl.X  declarer side with the options X, defenders current     ndef.X  defenders (lead included) with X
//   nlead.X  only the opening lead with X                             nplay.X defenders after the lead with X
// where X names an entry of the JSON in the environment variable NEW, e.g.
//   NEW='{"w":{"pool":96},"imp":{"agg":"imp"}}' node tests/playsim.js 300 20 ndecl.w,ndef.w,nlead.imp
// Reports, for the side whose play changed: IMPs per board and tricks per board (mean ± standard error),
// how many boards changed, and the time per sampled decision.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os'), path = require('path'), fs = require('fs');

if (isMainThread) {
  const N = +process.argv[2] || 200, K = +process.argv[3] || 20;
  const variants = (process.argv[4] || 'decl,def,defnl').split(',');
  const W = Math.max(1, +process.argv[5] || Math.max(1, os.cpus().length - 2));
  const seed = process.argv[6] || 'playsim';
  const acc = {}; variants.forEach(v => acc[v] = { n: 0, imp: 0, imp2: 0, tr: 0, tr2: 0, changed: 0, dec: 0, ms: 0 });
  let done = 0, next = 0, live = W;
  const t0 = Date.now();
  const report = () => {
    console.log(`boards ${done} (K=${K}, ${W} workers, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const v of variants) {
      const a = acc[v]; if (!a.n) continue;
      const m = a.imp / a.n, se = Math.sqrt(Math.max(0, a.imp2 / a.n - m * m) / a.n);
      const mt = a.tr / a.n, set = Math.sqrt(Math.max(0, a.tr2 / a.n - mt * mt) / a.n);
      console.log(`  ${v.padEnd(6)} IMPs/board ${m >= 0 ? '+' : ''}${m.toFixed(3)} ± ${se.toFixed(3)}   tricks/board ${mt >= 0 ? '+' : ''}${mt.toFixed(3)} ± ${set.toFixed(3)}   changed ${a.changed}/${a.n}   ${a.dec} sampled decisions, ${(a.ms / Math.max(1, a.dec)).toFixed(0)} ms each`);
    }
  };
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { K, variants, seed } });
    const feed = () => { if (next < N) wk.postMessage(next++); else wk.postMessage(-1); };
    wk.on('message', m => {
      if (m.ready) return feed();
      done++;
      for (const v of variants) {
        const r = m.res[v]; if (!r) continue;
        const a = acc[v]; a.n++; a.imp += r.imp; a.imp2 += r.imp * r.imp; a.tr += r.tr; a.tr2 += r.tr * r.tr; if (r.tr) a.changed++; a.dec += r.dec; a.ms += r.ms;
      }
      if (done % 25 === 0) report();
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
  const { K, variants, seed } = workerData;
  let solve = null;
  const NEW = JSON.parse(process.env.NEW || '{}');
  const CUR = { lead: 'conv', leadTol: 30 }; // what the page uses (js/analysis.js robotDDSolve)
  async function playOut(hands, auction, ct, vul, useDD, rand, extra = {}) { // useDD(seat, cardIndex) -> bool, or the options for that card
    const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
    let dec = 0, ms = 0;
    for (let i = 0; i < 52; i++) {
      const s = playTurn(t.play, ct);
      const prefer = B.botPlay(t, s);
      let card = prefer;
      const u = useDD(s, i);
      if (u) {
        const r = await D.ddChoose(D.ddView(t, s), solve, { k: K, prefer, rand, ...extra, ...(typeof u === 'object' ? u : {}) });
        if (r) { card = r.card; if (!(u === true && extra === CUR)) { dec++; ms += r.ms; } } // n-variants: time only the decisions with the new options
      }
      applyPlay(t.play, ct, s, card);
    }
    return { decl: tricksWon(t.play, ct).decl, dec, ms };
  }
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const rand = seededRand(seed + ':' + g);
    const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = B.botCall(hands[s], s, dealer, auction, vul); auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s }); }
    const ct = finalContract(auction);
    const res = {};
    if (ct) {
      const base = (await playOut(hands, auction, ct, vul, () => false)).decl;
      const baseScore = scoreContract(ct, base, vul);
      const decl = s => sameSide(s, ct.declarer);
      const sel = {
        decl: s => decl(s),
        def: s => !decl(s),
        defnl: (s, i) => !decl(s) && i > 0,
        lead: (s, i) => i === 0,
        leadc: (s, i) => i === 0,
        leadct: (s, i) => i === 0,
        defc: s => !decl(s),
        defct: s => !decl(s),
      };
      const extra = { leadc: { lead: 'conv' }, leadct: { lead: 'conv', leadTol: 30 }, defc: { lead: 'conv' }, defct: { lead: 'conv', leadTol: 30 } };
      let cur = null;
      for (const v of variants) if (/^n/.test(v)) {
        if (!cur) cur = (await playOut(hands, auction, ct, vul, () => true, seededRand(seed + ':cur:' + g), CUR)).decl;
        const [kind, name] = v.split('.'), X = NEW[name] || {};
        const nsel = { ndecl: (s, i) => decl(s) ? X : true, ndef: (s, i) => decl(s) ? true : X, nlead: (s, i) => i === 0 ? X : true, nplay: (s, i) => !decl(s) && i > 0 ? X : true }[kind];
        const r = await playOut(hands, auction, ct, vul, nsel, seededRand(seed + ':cur:' + g), CUR);
        const sign = kind === 'ndecl' ? 1 : -1;
        res[v] = { imp: sign * toImps(scoreContract(ct, r.decl, vul) - scoreContract(ct, cur, vul)), tr: sign * (r.decl - cur), dec: r.dec, ms: r.ms };
      }
      for (const v of variants) if (!/^n/.test(v)) {
        const r = await playOut(hands, auction, ct, vul, sel[v], seededRand(seed + ':dd:' + v + ':' + g), extra[v]);
        const sign = v === 'decl' ? 1 : -1; // results for the side whose play changed
        res[v] = { imp: sign * toImps(scoreContract(ct, r.decl, vul) - baseScore), tr: sign * (r.decl - base), dec: r.dec, ms: r.ms };
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
