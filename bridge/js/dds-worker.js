// Web Worker: double-dummy solving for the page (js/analysis.js). Messages:
//  { k, h, st }               the hand record: one strain of one deal, each declarer's result as it is found
//  { k, play: view, opts, table? }  a robot's card by double-dummy sampling (js/ddplay.js ddChoose); with table, the
//                             worker works out opts.prefer (botPlay), says how long that took ({ k, preMs }) and
//                             sends it back with the card ({ k, card, prefer }); also the robot's claim at the start of
//                             a trick ({ claim: { key, n } } on both messages, robotClaimPre), for js/table.js robotClaim
//  { k, leadSamples: view, opts }  an opening lead: solver results on sampled layouts (js/leads.js leadSample),
//                             streamed one by one ({ k, result }) and then all together ({ k, results })
//  { k, playSamples: view, opts }  a share of the layouts of a card decision (js/ddplay.js ddDeals, ddSolveDeals),
//                             streamed one by one ({ k, result, weight }), then { k, done }
//  { wasm: WebAssembly.Module }    the solver compiled by the page, so each worker needn't compile it
//  { warm: true }             warm up (make the solver instance, run the sampler and a small solve) before the first real job
// The solver is DDS (Bo Haglund and Soren Hein, Apache-2.0) compiled to WebAssembly; see wasm/NOTICE.txt and wasm/build.sh.
// The worker keeps one solver instance for all its solves (ddplay.js ddSolver; tests/ddtest.js checks reuse).
importScripts('wasm/compiled.js', 'engine.js', 'bidding.js', 'leads.js', 'bots.js', 'ddplay.js'); // create_dds_module; rules helpers; bidding (what calls show); opening leads; the heuristic robot (the sampler's play model); the sampler

// The claim a robot about to lead to a new trick would make (js/table.js robotClaim; the page skips its own search
// when this answer is there), worked out here so the page's main thread doesn't block on it. seat: the robot's seat
// (dummy's play is declarer's claim).
function robotClaimPre(t, seat) {
  try {
    const tr = t.phase === 'play' && t.play.tricks[t.play.tricks.length - 1];
    if (!tr || tr.cards.length < 4 || 13 - t.play.tricks.length < 2) return undefined;
    const by = seat === partnerOf(t.contract.declarer) ? t.contract.declarer : seat;
    const nodes = t.local ? ROBOT_CLAIM_NODES_PAGE : ROBOT_CLAIM_NODES, n = robotClaimCount(t, by, nodes);
    return { key: robotClaimKey(t, by, nodes), n };
  } catch (err) { return undefined; }
}
let modP = null, solver = null;
const compiled = () => modP || (modP = fetch('wasm/compiled.wasm').then(r => { if (!r.ok) throw new Error('solver not found'); return r.arrayBuffer(); }).then(b => WebAssembly.compile(b)).catch(err => { modP = null; throw err; }));
async function getSolver() {
  if (!solver) { const mod = await compiled(); solver = solver || ddSolver(create_dds_module, mod); }
  return solver;
}
// One strain, all four declarers: declarer's tricks per seat, from DDS's table routine (ddplay.js ddTableRaw, about
// twice as fast as solving each declarer's opening lead); with an older compiled.wasm that lacks it, one solve
// per declarer (13 minus what the defender on lead can take), as before.
async function strain(hands, st, report) {
  const solve = await getSolver(), pbn = ddPBN(hands);
  let table = null;
  try { if (solve.table) table = await solve.table(pbn, st); } catch (err) { table = null; }
  if (table) { for (const decl of SEATS) report(decl, st, table[decl][st]); return; }
  const trump = { S: 0, H: 1, D: 2, C: 3, N: 4 }[st];
  for (const [ix, decl] of SEATS.entries()) {
    const leader = SEATS[(ix + 1) & 3]; // the defender on lead
    const r = await solve({ trump, first: (ix + 1) & 3, trick: [], pbn, hands, mover: leader });
    const best = Math.max(-1, ...Object.values(r));
    if (best < 0 || best > 13) throw new Error('DDS returned no result');
    report(decl, st, 13 - best);
  }
}
// A quick run through everything a robot decision uses, so the first real one isn't slowed by start-up.
async function warm() {
  const solve = await getSolver();
  const hands = deal(), t = { hands, auction: [{ call: '1N', by: 'S' }, { call: 'P', by: 'W' }, { call: '3N', by: 'N' }, { call: 'P', by: 'E' }, { call: 'P', by: 'S' }, { call: 'P', by: 'W' }],
    contract: { level: 3, strain: 'N', doubled: 0, declarer: 'S' }, vul: 'None', play: { tricks: [] } };
  const view = ddView(t, 'W');
  const small = {}; SEATS.forEach(s => { small[s] = hands[s].slice(0, 4); });
  await solve({ trump: 4, first: 3, trick: [], pbn: ddPBN(small), hands: small, mover: 'W' });
  ddSample(view, 4);
}
self.onmessage = async e => {
  const m = e.data;
  if (m.wasm) { if (!modP) modP = Promise.resolve(m.wasm); return; }
  if (m.warm) { try { await warm(); } catch (err) { } return; }
  if (m.leadSamples) { // opening lead: results stream back one by one, so the page keeps them if time runs out
    const { k, leadSamples, opts } = m;
    try {
      const solve = await getSolver();
      const results = await leadSample(leadSamples, solve, { ...(opts || {}), onResult: r => self.postMessage({ k, result: r }) });
      self.postMessage({ k, results });
    } catch (err) { self.postMessage({ k, results: null, error: String(err && err.message || err) }); }
    return;
  }
  if (m.playSamples) { // a share of the layouts of a slow card decision: results stream back with their weights
    const { k, playSamples: view, opts } = m;
    try {
      const solve = await getSolver();
      const o = ddOpts(view, opts || {}), t0 = ddNow();
      const { deals, weights } = ddDeals(view, o, t0);
      await ddSolveDeals(view, deals, solve, o, t0, (r, i) => self.postMessage({ k, result: r, weight: weights ? weights[i] : 1 }));
      self.postMessage({ k, done: true });
    } catch (err) { self.postMessage({ k, error: String(err && err.message || err) }); }
    return;
  }
  if (m.play) { // robot card: { k, play: view (only what the robot may see), opts }
    const { k, play, table } = m;
    let opts = m.opts || {}, prefer = null, claim;
    try {
      // table: the page sent what botPlay needs instead of its card (js/analysis.js robotDDSolve): work it out here
      // (and the robot's claim, if it is about to lead to a new trick: robotClaimPre; its time counts as prefer's)
      if (table) { const t0 = ddNow(); claim = robotClaimPre(table, play.seat); prefer = botPlay(table, play.seat); opts = { ...opts, prefer }; self.postMessage({ k, preMs: ddNow() - t0, claim }); }
      const r = await ddChoose(play, await getSolver(), opts);
      self.postMessage({ k, card: r ? r.card : null, prefer, claim, samples: r ? r.samples : 0, ms: r ? Math.round(r.ms) : 0 });
    } catch (err) { self.postMessage({ k, card: null, prefer, claim, error: String(err && err.message || err) }); }
    return;
  }
  const { k, h, st } = m;
  try { await strain(h, st, (decl, s2, v) => self.postMessage({ k, decl, st: s2, v })); }
  catch (err) { setTimeout(() => { throw err; }); return; } // reaches the page's worker.onerror
  self.postMessage({ k, st, done: true });
};
