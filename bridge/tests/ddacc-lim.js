// Decision accuracy of the solver play: cheaper and steadier than playing whole boards out (tests/playsim.js).
// Deals boards with robot auctions, plays them out with the heuristic robot, and at robot decisions (every card where
// the solver is worth asking) lets the page's sampler choose a card with the current options and with new ones. Each
// choice is scored on the real deal, double dummy: what it costs against the best card there, in tricks and in IMPs
// (from the score of the contract). Paired per decision, so the difference has a small error.
// Usage: NEW='{"relax":0.05}' node tests/ddacc.js [boards=200] [workers=cores-2] [seed=ddacc] [every=3]
//   ODD=1 / DBL=1 as in tests/playsim.js (a player bids as if holding another hand; every contract doubled).
//   XONLY=1: only boards whose auction ended doubled (with ODD=1, the robots' penalty doubles of odd bids).
//   FROM=n: skip the first n cards (FROM=1 leaves the opening lead out, for options that can't change it).
//   SIDE=decl|def: only the declaring side's or the defenders' decisions (default both, reported apart).
//   TO=n: stop after card n. LEADDD=1: the opening lead played is the solver's (the page robot's), not botLead.
//   AOFF=a,b: BID_OFF keys (js/bidding.js) for the current options' choices only, e.g. AOFF=xpsh compares shown() with and
//   without that feature (the new options' choices use js/bidding.js as it is).
//   LVF=1: only boards where the board's vulnerability changes js/leads.js leadContext for the opening leader (round 14).
//   BY=trick: also report by stage (trick 1, 2-3, 4-6, 7-9, 10-13) and whether the player leads (L) or follows (F).
// The sampler's choices are cached on disk (tests/simcache.js; NOCACHE=1 to switch off): a later run with the same code
// reuses them (the current options' choices when only NEW changes, all of them for boards already done); their ms is
// the time measured when they were first made. DUMP runs don't use the cache.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os'), path = require('path'), fs = require('fs');

if (isMainThread) {
  const N = +process.argv[2] || 200, W = Math.max(1, +process.argv[3] || Math.max(1, os.cpus().length - 2));
  const seed = process.argv[4] || 'ddacc', every = +process.argv[5] || 3;
  const acc = {}; let done = 0, next = 0, live = W, hits = 0; const t0 = Date.now();
  const add = (k, d) => { const a = acc[k] || (acc[k] = { n: 0, tr: 0, tr2: 0, imp: 0, imp2: 0, ch: 0, ms0: 0, ms1: 0, base: 0, baseT: 0 }); a.n++; a.baseT += d.baseT || 0; a.tr += d.tr; a.tr2 += d.tr * d.tr; a.imp += d.imp; a.imp2 += d.imp * d.imp; if (d.ch) a.ch++; a.ms0 += d.ms0; a.ms1 += d.ms1; a.base += d.base; };
  const report = () => {
    console.log(`boards ${done} (${W} workers, ${((Date.now() - t0) / 1000).toFixed(0)} s); gain of the new options per decision (positive = better)`);
    for (const k of Object.keys(acc).sort()) {
      const a = acc[k], f = (s, s2) => { const m = s / a.n, se = Math.sqrt(Math.max(0, s2 / a.n - m * m) / a.n); return `${m >= 0 ? '+' : ''}${m.toFixed(4)} ± ${se.toFixed(4)}`; };
      console.log(`  ${k.padEnd(5)} ${a.n} decisions, ${a.ch} changed   IMPs ${f(a.imp, a.imp2)}   tricks ${f(a.tr, a.tr2)}   current card's loss ${(a.base / a.n).toFixed(3)} IMPs ${(a.baseT / a.n).toFixed(3)} tr   ms ${(a.ms0 / a.n).toFixed(0)} -> ${(a.ms1 / a.n).toFixed(0)}`);
    }
  };
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { seed, every } });
    const feed = () => wk.postMessage(next < N ? next++ : -1);
    wk.on('message', m => {
      if (m.ready) return feed();
      done++; hits += m.hits || 0; for (const d of m.res) add(d.side, d);
      if (done % 50 === 0) report();
      feed();
    });
    wk.on('error', e => { console.error(e); process.exitCode = 1; });
    wk.on('exit', () => { if (--live === 0) { report(); if (hits) console.log(`  (${hits} sampler choices reused from the cache, tests/simcache.js)`); } });
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
  let solve = null, realSolve = null;
  const cache = require('./simcache.js').openCache('ddacclim', [__filename]);
  const env = JSON.stringify([process.env.ODD || '', process.env.DBL || '', process.env.LEADDD || ''].concat(process.env.AOFF ? [process.env.AOFF] : []));
  const AOFF = (process.env.AOFF || '').split(',').filter(Boolean), withOff = async (off, f) => { const o = globalThis.BID_OFF; globalThis.BID_OFF = off; try { return await f(); } finally { globalThis.BID_OFF = o; } };
  const choose = async (key, view, o) => { // ddChoose, through the cache: { card, ms } (or the full result with DUMP)
    if (process.env.DUMP) return D.ddChoose(view, solve, o);
    const k = JSON.stringify([seed, env, ...key]); let r = cache.get(k);
    if (r === undefined) { const x = await D.ddChoose(view, solve, o); r = x ? { card: x.card, ms: x.ms } : null; cache.set(k, r); }
    return r;
  };
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const rand = seededRand(seed + ':' + g);
    const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
    const liar = process.env.ODD ? SEATS[g % 4] : null, fake = liar ? deal(seededRand(seed + ':fake:' + g))[SEATS[(g + 1) % 4]] : null;
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = B.botCall(s === liar ? fake : hands[s], s, dealer, auction, vul); auction.push({ call: r.call, by: s }); }
    const ct = finalContract(auction), res = [];
    // LVF=1: only boards where the vulnerability changes the lead's reading of the auction (js/leads.js leadContext)
    if (process.env.LVF && ct) { const s0 = nextSeat(ct.declarer); if (JSON.stringify([...Object.entries(leadContext(hands[s0], auction, ct, s0, vul))]) === JSON.stringify([...Object.entries(leadContext(hands[s0], auction, ct, s0))])) { parentPort.postMessage({ g, res: [] }); return; } }
    if (process.env.LIMF && ct) { const lx = NEW.limx || D.DD_LIMX; const same = SEATS.every(x => JSON.stringify(D.ddAuctionLimits(auction, x, vul, true, false, process.env.LIMF === '2' ? D.DD_LIMX : {})) === JSON.stringify(D.ddAuctionLimits(auction, x, vul, true, false, lx))); if (same) { parentPort.postMessage({ g, res: [] }); return; } }
    if (ct && !(process.env.XONLY && !ct.doubled)) {
      if (process.env.DBL && !ct.doubled) ct.doubled = +process.env.DBL;
      const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
      for (let i = 0; i < 52; i++) {
        const s = playTurn(t.play, ct), prefer = B.botPlay(t, s);
        const side = sameSide(s, ct.declarer) ? 'decl' : 'def';
        if (process.env.TO && i >= +process.env.TO) break;
        if (i === 0 && process.env.LEADDD) {
          const lv = D.ddView(t, s, CUR), lr = await choose(['lead', g, CUR], lv, { ...CUR, prefer, rand: seededRand(seed + ':lead:' + g) });
          if (lr) { applyPlay(t.play, ct, s, lr.card); continue; }
        }
        if (i % every === 0 && i >= (+process.env.FROM || 0) && (!process.env.SIDE || process.env.SIDE === side)) {
          const v0 = D.ddView(t, s, CUR);
          if (D.ddWorthIt(v0)) {
            const o0 = { ...CUR, prefer, rand: seededRand(seed + ':c:' + g + ':' + i) }, o1 = { ...merge(CUR, NEW), prefer, rand: seededRand(seed + ':c:' + g + ':' + i) };
            const a = AOFF.length ? await withOff(AOFF, () => choose(['a', g, i, CUR], D.ddView(t, s, CUR), o0)) : await choose(['a', g, i, CUR], v0, o0), b = process.env.NEW ? (NEW.heur ? { card: prefer, ms: 0 } : await choose(['b', g, i, CUR, NEW], D.ddView(t, s, o1), o1)) : a; // NEW='{"heur":1}': the heuristic card (Beginner, js/learn.js)
            if (a && b) {
              // the real deal, solved for the player to move: tricks for its side from here with each card
              const real = {}; for (const x of SEATS) real[x] = remainingHand(hands, t.play, x);
              const r = await realSolve(D.ddJob(v0, real));
              let won = 0; for (const tr of t.play.tricks) if (tr.cards.length === 4 && sameSide(trickWinner(tr, ct.strain), s)) won++;
              const onDecl = sameSide(s, ct.declarer);
              const pts = c => { const mine = won + r[c], sc = scoreContract(ct, onDecl ? mine : 13 - mine, vul); return onDecl ? sc : -sc; };
              const best = Math.max(...Object.keys(r).map(pts)), bestTr = Math.max(...Object.values(r));
              const lossI = c => toImps(best - pts(c)), lossT = c => bestTr - r[c];
              res.push({ side: ct.doubled ? side + 'X' : side, tr: lossT(a.card) - lossT(b.card), imp: lossI(a.card) - lossI(b.card), ch: a.card !== b.card, ms0: a.ms, ms1: b.ms, base: lossI(a.card), baseT: lossT(a.card) });
              if (process.env.DUMP && lossI(a.card) >= +process.env.DUMP && (!process.env.SIDE || process.env.SIDE === side)) {
                const pb = x => SUITS.map(su => x.filter(c => c[0] === su).sort((p, q) => rankOf(q) - rankOf(p)).map(c => c[1]).join('') || '-').join('.');
                console.log(`# board ${g} ${ct.level}${ct.strain}${ct.doubled ? 'X' : ''} by ${ct.declarer} vul ${vul}, ${s} to play card ${i}, auction ${auction.map(q => q.call).join(' ')}`);
                for (const x of SEATS) console.log(`  ${x} ${pb(real[x])}`);
                console.log('  play ' + t.play.tricks.map(tr => tr.leader + ':' + tr.cards.map(pc => pc.card).join(' ')).join(' | '));
                console.log(`  chose ${a.card} (loss ${lossI(a.card)} IMPs), real dd: ${Object.keys(r).map(c => c + '=' + (won + r[c])).join(' ')}`);
                console.log('  sampled: ' + a.stats.map(q => q.card + ' ' + q.score.toFixed(0) + '/' + q.tricks.toFixed(2)).join(', '));
              }
              if (process.env.BY) { const tk = t.play.tricks.length, cur = t.play.tricks[tk - 1], lead = !cur || cur.cards.length === 4;
                const st = i < 4 ? 't1' : i < 12 ? 't2-3' : i < 24 ? 't4-6' : i < 36 ? 't7-9' : 't10+';
                res.push({ side: side + '.' + st + (lead ? 'L' : 'F'), tr: lossT(a.card) - lossT(b.card), imp: lossI(a.card) - lossI(b.card), ch: a.card !== b.card, ms0: a.ms, ms1: b.ms, base: lossI(a.card), baseT: lossT(a.card) }); }
              if (i === 0) res.push({ side: 'lead', tr: lossT(a.card) - lossT(b.card), imp: lossI(a.card) - lossI(b.card), ch: a.card !== b.card, ms0: a.ms, ms1: b.ms, base: lossI(a.card) });
            }
          }
        }
        applyPlay(t.play, ct, s, prefer);
      }
    }
    parentPort.postMessage({ g, res, hits: cache.hits }); cache.hits = 0;
  });
  (async () => {
    const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
    solve = D.ddSolver(create, mod); realSolve = require('./simcache.js').cachedSolve(solve); // the real deal's positions, cached on disk
    parentPort.postMessage({ ready: true });
  })();
}
