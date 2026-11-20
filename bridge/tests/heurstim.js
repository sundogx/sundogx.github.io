// Heuristic card play (js/bots.js botPlay) against the previous heuristic (tests/fixtures/basebots5.js), paired:
// the same deals, the same robot auctions and contracts; only one side's card play changes.
// Usage: node tests/heurstim.js [boards=2000] [mode=cmp] [seed=heurstim] [workers=cores-2]
//   cmp   decl: declarer and dummy play the new heuristic, defenders the old one
//         def:  the defenders play the new heuristic (opening lead included), declarer the old one
//         Reports IMPs and tricks per board for the side that changed (mean ± standard error), and for the old
//         and new heuristic (all four seats) the declarer's tricks against the double-dummy result of the deal.
//   leak  plays every board with one heuristic in all four seats (LEAK=new or old, default new) and solves the
//         real position double-dummy at every decision with more than one distinct card: the tricks the chosen card
//         costs against the best card, totalled by category (side, strain, position in the trick, and the
//         rule in botPlay that chose the card, from botWhyLast() in js/bots.js).
// OLDEXP=a,b: experiments on for the old heuristic (BASE=js/bots.js NEWEXP=a,b OLDEXP=a measures b on top of a).
// NEWOFF=a,b sets globalThis.BOT_OFF (the features switched off) for the new heuristic only, e.g. NEWOFF=fin,hold.
// OVER=k: every contract is doubled and its level set so declarer needs k tricks more than double dummy (an overbid
// doubled; the auction stays the robots' own).
// BASE=path compares against another copy of bots.js instead of the frozen fixture; NEW=path replaces js/bots.js.
// Double-dummy solves of real positions are cached on disk (tests/simcache.js cachedSolve, keyed by the position; valid
// while only the robots' code changes), so a rerun on the same seed mostly skips the solver. NOCACHE=1 switches it off.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os'), path = require('path'), fs = require('fs');

if (isMainThread) {
  const N = +process.argv[2] || 2000, mode = process.argv[3] || 'cmp', seed = process.argv[4] || 'heurstim';
  const W = Math.max(1, +process.argv[5] || Math.max(1, os.cpus().length - 2));
  const t0 = Date.now();
  const acc = {}; const add = (k, x) => { const a = acc[k] || (acc[k] = { n: 0, s: 0, s2: 0, nz: 0 }); a.n++; a.s += x; a.s2 += x * x; if (x) a.nz++; };
  const leak = {}; const addLeak = (k, loss) => { const a = leak[k] || (leak[k] = { n: 0, loss: 0, bad: 0 }); a.n++; a.loss += loss; if (loss) a.bad++; };
  let done = 0, next = 0, live = W, boards = 0;
  const fmt = (k, d = 3) => { const a = acc[k]; if (!a) return '-'; const m = a.s / a.n, se = Math.sqrt(Math.max(0, a.s2 / a.n - m * m) / a.n); return `${m >= 0 ? '+' : ''}${m.toFixed(d)} ± ${se.toFixed(d)}`; };
  const report = () => {
    console.log(`boards ${done} (${boards} played, mode ${mode}, seed ${seed}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (mode === 'cmp') {
      for (const v of ['decl', 'def', 'both']) if (acc[v + 'Imp']) console.log(`  ${v.padEnd(5)} IMPs/board ${fmt(v + 'Imp')}   tricks/board ${fmt(v + 'Tr')}   changed ${acc[v + 'Tr'].nz}/${acc[v + 'Tr'].n}`);
      console.log(`  declarer tricks vs double dummy: old ${fmt('oldDD')}, new ${fmt('newDD')}  (suit: old ${fmt('oldDDs')}, new ${fmt('newDDs')}; NT: old ${fmt('oldDDn')}, new ${fmt('newDDn')})`);
    } else {
      const rows = Object.entries(leak).sort((a, b) => b[1].loss - a[1].loss);
      const tot = { decl: 0, def: 0 }; for (const [k, a] of rows) if (/^side /.test(k)) tot[k.slice(5)] = a.loss;
      console.log(`  tricks lost per board: declarer side ${(tot.decl / boards).toFixed(3)}, defenders ${(tot.def / boards).toFixed(3)}`);
      for (const [k, a] of rows) if (!/^side /.test(k) && a.loss / boards >= 0.004) console.log(`  ${k.padEnd(40)} lost/board ${(a.loss / boards).toFixed(3)}   decisions ${a.n}  wrong ${a.bad} (${(100 * a.bad / a.n).toFixed(1)}%)`);
    }
  };
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { mode, seed } });
    const feed = () => wk.postMessage(next < N ? next++ : -1);
    wk.on('message', m => {
      if (m.ready) return feed();
      done++;
      if (m.played) boards++;
      for (const [k, x] of m.vals || []) add(k, x);
      for (const [k, x] of m.leaks || []) addLeak(k, x);
      if (done % 500 === 0) report();
      feed();
    });
    wk.on('error', e => { console.error(e); process.exitCode = 1; });
    wk.on('exit', () => { if (--live === 0) report(); });
  }
} else {
  Object.assign(globalThis, require('../js/engine.js'));
  const NEWB = require(process.env.NEW ? path.resolve(process.env.NEW) : '../js/bots.js');
  const OLDB = require(process.env.BASE ? path.resolve(process.env.BASE) : './fixtures/basebots5.js');
  const D = require('../js/ddplay.js');
  const NEWOFF = process.env.NEWOFF != null ? process.env.NEWOFF.split(',').filter(Boolean) : undefined;
  const NEWEXP = (process.env.NEWEXP || '').split(',').filter(Boolean); // experiment switches (globalThis.BOT_EXP)
  const newPlay = (t, s) => { globalThis.BOT_OFF = NEWOFF; globalThis.BOT_EXP = NEWEXP; const c = NEWB.botPlay(t, s); globalThis.BOT_OFF = undefined; globalThis.BOT_EXP = undefined; return c; };
  const OLDEXP = (process.env.OLDEXP || '').split(',').filter(Boolean); // experiments for the old heuristic (with BASE=js/bots.js)
  const oldPlay = (t, s) => { globalThis.BOT_OFF = undefined; globalThis.BOT_EXP = OLDEXP; const c = OLDB.botPlay(t, s); globalThis.BOT_EXP = undefined; return c; };
  const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
  const create = require(path.join(wasmDir, 'compiled.js'));
  const { mode, seed } = workerData;
  let solve = null;
  const playOut = (hands, auction, ct, vul, pick) => {
    const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
    for (let i = 0; i < 52; i++) {
      const s = playTurn(t.play, ct);
      const card = pick(s)(t, s);
      if (!legalPlays(hands, t.play, ct, s).includes(card)) throw new Error('illegal play ' + card);
      applyPlay(t.play, ct, s, card);
    }
    return tricksWon(t.play, ct).decl;
  };
  const ddDecl = async (hands, ct) => { // declarer's double-dummy tricks
    const leader = nextSeat(ct.declarer);
    const view = { seat: leader, contract: ct, tricks: [] };
    const r = await solve(D.ddJob(view, hands));
    return 13 - Math.max(...Object.values(r));
  };
  parentPort.on('message', async g => {
    if (g < 0) return process.exit(0);
    const rand = seededRand(seed + ':' + g);
    const hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1), auction = [];
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = NEWB.botCall(hands[s], s, dealer, auction, vul); auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s }); }
    let ct = finalContract(auction);
    if (!ct) return parentPort.postMessage({ g, played: false });
    if (process.env.OVER) { // an overbid, doubled: the level is set OVER tricks above the double-dummy result
      const dd0 = await ddDecl(hands, ct), lv = Math.min(7, Math.max(1, dd0 - 6 + +process.env.OVER));
      ct = { ...ct, level: lv, doubled: 1 };
    }
    const isDecl = s => sameSide(s, ct.declarer);
    const vals = [], leaks = [];
    if (mode === 'cmp') {
      const base = playOut(hands, auction, ct, vul, () => oldPlay);
      const sc = d => scoreContract(ct, d, vul);
      const dv = playOut(hands, auction, ct, vul, s => isDecl(s) ? newPlay : oldPlay);
      const fv = playOut(hands, auction, ct, vul, s => isDecl(s) ? oldPlay : newPlay);
      const nv = playOut(hands, auction, ct, vul, () => newPlay);
      vals.push(['declImp', toImps(sc(dv) - sc(base))], ['declTr', dv - base]);
      vals.push(['defImp', -toImps(sc(fv) - sc(base))], ['defTr', base - fv]);
      const dd = await ddDecl(hands, ct);
      const k = ct.strain === 'N' ? 'n' : 's';
      vals.push(['oldDD', base - dd], ['newDD', nv - dd], ['oldDD' + k, base - dd], ['newDD' + k, nv - dd]);
    } else {
      const play = (process.env.LEAK || 'new') === 'old' ? oldPlay : newPlay;
      const t = { hands, auction, contract: ct, vul, play: { tricks: [] } };
      for (let i = 0; i < 52; i++) {
        const s = playTurn(t.play, ct);
        const card = play(t, s), why = play === newPlay && NEWB.botWhyLast ? NEWB.botWhyLast() : '?';
        const chooser = s === partnerOf(ct.declarer) ? ct.declarer : s;
        const view = D.ddView(t, s);
        const legal = D.ddLegal(view);
        if (legal.length > 1 && D.ddClasses(view, legal).length > 1) {
          const rem = {}; for (const x of SEATS) rem[x] = remainingHand(hands, t.play, x);
          const r = await solve(D.ddJob(view, rem));
          const loss = Math.max(...Object.values(r)) - r[card];
          const tr = currentTrick(t.play), pos = tr ? tr.cards.length : 0;
          const side = isDecl(chooser) ? 'decl' : 'def', st = ct.strain === 'N' ? 'NT' : 'suit';
          const posName = i === 0 ? 'opening lead' : ['lead', '2nd', '3rd', '4th'][pos];
          const kind = pos === 0 ? '' : suitOf(card) === suitOf(tr.cards[0].card) ? ' follow' : ct.strain !== 'N' && suitOf(card) === ct.strain ? ' ruff' : ' discard';
          leaks.push(['side ' + side, loss], [`${side} ${st} ${posName}${kind}`, loss], [`${side} ${st} why=${why}`, loss]);
          if (process.env.DUMP && loss >= 1 && new RegExp(process.env.DUMP).test(`${side} ${st} why=${why} | ${side} ${st} ${posName}${kind}`)) { // print the position
            const sh = h => SUITS.map(su => su + (h.filter(x => suitOf(x) === su).map(x => x[1]).join('') || '-')).join(' ');
            const tw = tricksWon(t.play, ct);
            console.log(`\n#${g} ${contractText(ct)} trick ${t.play.tricks.length + (pos ? 0 : 1)} (decl ${tw.decl}, def ${tw.def}) ${s} to play, why=${why}; auction ${auction.map(a => a.call).join(' ')}`);
            console.log('  played: ' + t.play.tricks.map(x => x.leader + ':' + x.cards.map(pc => pc.card).join(' ')).join(' | '));
            for (const x of SEATS) console.log(`  ${x}${x === ct.declarer ? '*' : x === partnerOf(ct.declarer) ? 'd' : ' '} ${sh(rem[x])}`);
            console.log(`  played ${card} (${r[card]}), best ${Object.entries(r).filter(([, v]) => v === Math.max(...Object.values(r))).map(([k]) => k).join(',')} (${Math.max(...Object.values(r))})`);
          }
        }
        applyPlay(t.play, ct, s, card);
      }
    }
    parentPort.postMessage({ g, played: true, vals, leaks });
  });
  (async () => {
    const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
    solve = require('./simcache.js').cachedSolve(D.ddSolver(create, mod)); // exact positions, cached on disk (NOCACHE=1: off)
    parentPort.postMessage({ ready: true });
  })();
}
