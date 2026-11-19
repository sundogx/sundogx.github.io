// BEN's bidding, opening lead and card play, ported to JavaScript from BEN (github.com/lorserker/ben, by Lorand Dali
// and Thorvald Aagaard, GPL-3.0, see LICENSE), commit 5098782, config BEN-21GF. The algorithm is described in
// PORTING.md; deviations from BEN are marked "JS:". Runs in the BEN worker and in Node (ben/tools), with:
//   nn.run(model, { input: { data: Float32Array, dims } }) -> Promise<{ output: Float32Array }>   (onnxruntime)
//   dd(trump, first, trickCards, pbn) -> [{ suit, rank, tricks }]   (js/ddplay.js ddSolveRaw on a DDS instance)
// and the app's js/engine.js (seededRand, scoreContract, toImps, legalPlays, trickWinner, SEATS).
const BenCore = (() => {
  const RK = 'AKQJT98765432', ST = 'SHDC', SEATS4 = 'NESW';
  const BSTR = 'CDHSN', NSHDC = 'NSHDC';
  const CFG = {
    thr: [0.10, 0.07, 0.06, 0.05, 0.04, 0.03, 0.03],
    need: 50, maxBoards: 20000, step: 2000, accept: 0.70, minSamples: 15, exclude: 0.01,
    leadSamples: 100, leadBoards: 10000, leadThr: 0.20,
    ms: Infinity,                       // JS: a time budget for sampling (the browser can't take BEN's 20000 boards)
  };
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

  // ---- calls ----
  const callId = c => c === 'PAD_START' ? 0 : c === 'PAD_END' ? 1 : c === 'P' ? 2 : c === 'X' ? 3 : c === 'XX' ? 4
    : 5 + (+c[0] - 1) * 5 + BSTR.indexOf(c[1]);
  const idCall = i => i === 2 ? 'P' : i === 3 ? 'X' : i === 4 ? 'XX' : i >= 5 ? ((i - 5) / 5 | 0) + 1 + BSTR[(i - 5) % 5] : null;
  const isBid = c => /^[1-7]/.test(c);
  function canBid(c, auc) {
    if (c === 'P') return true;
    const n = auc.length, last = auc[n - 1], l3 = auc.slice(-3);
    if (c === 'X') return isBid(last) || (n >= 3 && isBid(l3[0]) && l3[1] === 'P' && l3[2] === 'P');
    if (c === 'XX') return last === 'X' || (n >= 3 && l3[0] === 'X' && l3[1] === 'P' && l3[2] === 'P');
    const lb = [...auc].reverse().find(isBid);
    return !lb || callId(c) > callId(lb);
  }
  function auctionOver(auc) {
    const r = auc.filter(c => c !== 'PAD_START' && c !== 'PAD_END');
    return r.length >= 4 && r.slice(-3).every(c => c === 'P');
  }
  const nBids = auc => auc.filter(c => c !== 'PAD_START' && c !== 'PAD_END').length;
  // contract of a padded auction: { level, strain, doubled, declarer (0..3) } or null (passed out)
  function contractOf(auc) {
    let li = -1;
    for (let i = auc.length - 1; i >= 0; i--) if (isBid(auc[i])) { li = i; break; }
    if (li < 0) return null;
    const lb = auc[li], side = li % 2;
    let dbl = 0;
    for (let i = li + 1; i < auc.length; i++) { if (auc[i] === 'X') dbl = 1; if (auc[i] === 'XX') dbl = 2; }
    let decl = li % 4;
    for (let i = side; i < auc.length; i += 2) if (isBid(auc[i]) && auc[i][1] === lb[1]) { decl = i % 4; break; }
    return { level: +lb[0], strain: lb[1], doubled: dbl, declarer: decl };
  }
  const padded = (auction, dealer) => [...Array(SEATS4.indexOf(dealer)).fill('PAD_START'), ...auction];

  // ---- hands ----
  // 24-card encoding (A K Q J T x per suit, S H D C) and 32-card (A K Q J T 9 8 x) from app cards ('SA', 'H7')
  function h24(cards) { const a = new Float32Array(24); for (const c of cards) a[ST.indexOf(c[0]) * 6 + Math.min(5, RK.indexOf(c[1]))]++; return a; }
  function h32(cards) { const a = new Float32Array(32); for (const c of cards) a[ST.indexOf(c[0]) * 8 + Math.min(7, RK.indexOf(c[1]))]++; return a; }
  const c32 = c => ST.indexOf(c[0]) * 8 + Math.min(7, RK.indexOf(c[1]));
  const hcp24 = h => { let s = 0; for (let i = 0; i < 4; i++) s += 4 * h[i * 6] + 3 * h[i * 6 + 1] + 2 * h[i * 6 + 2] + h[i * 6 + 3]; return s; };
  const shp24 = h => [0, 1, 2, 3].map(s => h[s * 6] + h[s * 6 + 1] + h[s * 6 + 2] + h[s * 6 + 3] + h[s * 6 + 4] + h[s * 6 + 5]);

  // ---- bidding input (binary.get_auction_binary_sampling) ----
  const F = 193;
  function encodeHand(X, off, h) {
    const shp = shp24(h);
    X[off + 4] = (hcp24(h) - 10) / 4;
    for (let s = 0; s < 4; s++) X[off + 5 + s] = (shp[s] - 3.25) / 1.75;
    for (let i = 0; i < 24; i++) X[off + 9 + i] = h[i];
  }
  // the sequence of seat hix's turns in auc (seat hix's own hand h, vul [NS, EW] booleans): nSteps x 193
  function aucBinary(X, base, nSteps, auc, hix, h, vul) {
    const A = [...auc, ...Array(4 * nSteps + 4).fill('PAD_END')].map(callId);
    let bi = hix;
    while (A[bi] === 0) bi += 4;
    for (let t = 0; t < nSteps; t++, bi += 4) {
      const o = base + t * F;
      X[o] = 1; X[o + 1] = 1; X[o + 2] = vul[hix % 2] ? 1 : 0; X[o + 3] = vul[(hix + 1) % 2] ? 1 : 0;
      encodeHand(X, o, h);
      for (let k = 0; k < 4; k++) X[o + 33 + 40 * k + (bi - 4 + k >= 0 ? A[bi - 4 + k] : 0)] = 1;
    }
  }
  const stepsFor = (auc, hix) => { let i = hix; while (auc[i] === 'PAD_START') i += 4; return Math.max(1, 1 + Math.floor((auc.length - i) / 4)); };
  const vulArr = v => [v === 'NS' || v === 'Both' || v === 'All', v === 'EW' || v === 'Both' || v === 'All'];

  async function bidderLast(nn, auc, hix, hands, vul) { // hands: array of 24-arrays -> array of 40-prob rows (last step)
    const T = stepsFor(auc, hix), N = hands.length, X = new Float32Array(N * T * F);
    for (let n = 0; n < N; n++) aucBinary(X, n * T * F, T, auc, hix, hands[n], vul);
    const out = (await nn.run('bidder', { x: { data: X, dims: [N, T, F] } })).bid;
    return hands.map((_, n) => out.subarray((n * T + T - 1) * 40, (n * T + T) * 40));
  }
  const infoSteps = auc => { const b = nBids(auc); return b ? 1 + Math.floor(b / 4) : 1; }; // calculate_step_bidding_info
  async function binfoLast(nn, auc, hix, h, vul) { // de-normalised { hcp[3], shp[3][4] } of LHO, partner, RHO
    const T = infoSteps(auc), X = new Float32Array(T * F);
    aucBinary(X, 0, T, auc, hix, h, vul);
    const o = await nn.run('binfo', { x: { data: X, dims: [1, T, F] } });
    const hc = Array.from(o.hcp.subarray((T - 1) * 3, T * 3)), sh = Array.from(o.shape.subarray((T - 1) * 12, T * 12));
    return { raw: [...hc, ...sh], hcp: hc.map(x => x * 4 + 10), shp: [0, 1, 2].map(i => sh.slice(i * 4, i * 4 + 4).map(x => x * 1.75 + 3.25)) };
  }

  // ---- candidates (botbidder.get_bid_candidates, BBA off) ----
  const thr = n => CFG.thr[Math.min(n, CFG.thr.length) - 1];
  async function candidates(nn, auc, hix, h, vul) {
    const p = Array.from((await bidderLast(nn, auc, hix, [h], vul))[0]), orig = p.slice();
    const myNo = stepsFor(auc, hix), nb = nBids(auc);
    let minScore = thr(myNo), minC = 1, passout = false;
    if (nb > 3 && auc[auc.length - 1] === 'P') { minC = 2; minScore = thr(myNo + 1); passout = true; }
    const cs = [];
    for (;;) {
      let i = 0; for (let j = 1; j < 40; j++) if (p[j] > p[i]) i = j;
      if (p[i] < minScore) { if (cs.length >= minC) break; if (p[i] <= 0.01) break; }
      const c = idCall(i);
      if (c && canBid(c, auc)) cs.push({ call: c, insta: p[i] });
      else if (cs.length) break;
      p[i] = 0;
    }
    if (!cs.length) {
      let best = null; orig.forEach((v, i) => { const c = idCall(i); if (c && canBid(c, auc) && (!best || v > best.insta)) best = { call: c, insta: v }; });
      cs.push(best || { call: 'P', insta: 0 });
    }
    return { cs, passout, myNo };
  }

  // ---- sampling (sample.sample_cards_vec / sample_cards_auction / generate_samples_iterative) ----
  function dealVec(n, cH, cS, my, rand) { // -> n x 3 hidden 24-arrays (LHO, partner, RHO)
    const ak = [], rest = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 5; r++) if (!my[s * 6 + r]) (r < 2 ? ak : rest).push(s * 6 + r);
      for (let k = my[s * 6 + 5]; k < 8; k++) rest.push(s * 6 + 5);
    }
    const missing = 40 - hcp24(my), sumH = cH.reduce((a, b) => a + b, 0);
    const hf = Math.round(0.83 * sumH / Math.max(1, missing) * 100) / 100;
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const out = [];
    for (let d = 0; d < n; d++) {
      const H = [new Float32Array(24), new Float32Array(24), new Float32Array(24)], cnt = [0, 0, 0];
      const rh = cH.slice(), rs = cS.map(x => x.slice());
      const give = (card, useH) => {
        const s = card / 6 | 0, w = [0, 0, 0];
        let ws = 0, ss = 0, hs = 0;
        for (let i = 0; i < 3; i++) { ss += Math.max(rs[i][s], 0) + 0.1; hs += Math.max(rh[i], 0) + 0.1; }
        for (let i = 0; i < 3; i++) if (cnt[i] < 13) { w[i] = (Math.max(rs[i][s], 0) + 0.1) / ss * (useH ? (Math.max(rh[i], 0) + 0.1) / hs : 1); ws += w[i]; }
        let x = rand() * ws, i = 0;
        while (i < 2 && (x >= w[i] || !w[i])) { x -= w[i]; i++; }
        if (cnt[i] >= 13) i = cnt.findIndex(c => c < 13);
        H[i][card]++; cnt[i]++;
        rs[i][s] -= 0.3; if (useH) rh[i] -= 3 * hf;
      };
      for (const c of shuffle(ak.slice())) give(c, true);
      for (const c of shuffle(rest.slice())) give(c, false);
      out.push(H);
    }
    // filter on the bidding information
    const ok = out.filter(H => {
      for (let i = 0; i < 3; i++) {
        const ch = Math.round(cH[i]);
        if (ch >= 11 && hcp24(H[i]) < ch - 5) return false;
        const sh = shp24(H[i]);
        for (let j = 0; j < 4; j++) {
          if (cS[i][j] < 2 && sh[j] > Math.round(cS[i][j]) + 1) return false;
          if (cS[i][j] >= 6 && sh[j] < Math.round(cS[i][j]) - 1) return false;
        }
      }
      return true;
    });
    return ok.length >= n / 2 ? ok : out;
  }
  // score dealt layouts by how well the bidder explains the other players' calls (process_bidding + distance)
  async function scoreLayouts(nn, auc, hix, my, vul, deals) {
    const W = deals.map(() => ({ d: 0, mx: 0, min: [1, 1, 1] }));
    for (const [pos, wt] of [[2, 2], [3, 1], [1, 1]]) {
      const seat = (hix + pos) % 4, idx = [];
      for (let j = seat; j < auc.length; j += 4) if (auc[j] !== 'PAD_START') idx.push(j);
      if (!idx.length || !deals.length) continue;
      const T = 1 + Math.floor((auc.length - idx[0]) / 4), N = deals.length;
      const X = new Float32Array(N * T * F);
      aucBinary(X, 0, T, auc, seat, deals[0][pos - 1], vul);
      for (let n = 1; n < N; n++) X.copyWithin(n * T * F, 0, T * F);
      for (let n = 0; n < N; n++) for (let t = 0; t < T; t++) encodeHand(X, (n * T + t) * F, deals[n][pos - 1]);
      const out = (await nn.run('bidder', { x: { data: X, dims: [N, T, F] } })).bid;
      for (let n = 0; n < N; n++) {
        let m = 1;
        idx.forEach((j, t) => { if (t < T) m = Math.min(m, out[(n * T + t) * 40 + callId(auc[j])]); });
        W[n].min[pos - 1] = m; W[n].d += wt * (1 - m) * idx.length; W[n].mx += wt * idx.length;
      }
    }
    return W.map(w => ({ score: w.mx ? (w.mx - w.d) / w.mx : 1, mn: Math.min(...w.min), excl: Math.min(...w.min) < CFG.exclude }));
  }
  // generate_samples_iterative: -> { hands: [[lho, pd, rho]], scores, quality }
  async function sampleAuction(nn, auc, hix, my, vul, rand, o = {}) {
    const need = o.need || CFG.need, t0 = now(), ms = o.ms != null ? o.ms : CFG.ms;
    let maxB = o.maxBoards || CFG.maxBoards, step = o.step || CFG.step;
    const f = Math.floor(auc.filter(c => c !== 'P' && c !== 'PAD_START').length / 6);
    if (f > 0) maxB = Math.round(Math.pow(1.5, f) * maxB);
    const bi = await binfoLast(nn, auc, hix, my, vul);
    const others = [1, 2, 3].some(p => { for (let j = (hix + p) % 4; j < auc.length; j += 4) if (auc[j] !== 'PAD_START') return true; return false; });
    let done = 0, extend = false, qsum = 0;
    const keep = [], spare = []; // spare (o.spare): the least unlikely excluded layouts, used only if nothing else is found
    while (done < maxB && keep.length <= need) {
      const deals = dealVec(step, bi.hcp, bi.shp, my, rand);
      if (!others) { deals.forEach(H => keep.push({ H, score: 1 })); qsum += deals.length; }
      else {
        const sc = await scoreLayouts(nn, auc, hix, my, vul, deals);
        let acc = deals.map((H, i) => ({ H, ...sc[i] })).filter(x => !x.excl).sort((a, b) => b.score - a.score);
        const good = acc.filter(x => x.score >= CFG.accept);
        acc = good.length < CFG.minSamples && extend ? acc.slice(0, CFG.minSamples) : good;
        acc.forEach(x => { keep.push(x); qsum += x.score; });
        if (o.spare && !keep.length) { deals.forEach((H, i) => { if (sc[i].excl) spare.push({ H, ...sc[i] }); }); spare.sort((a, b) => b.mn - a.mn).splice(CFG.minSamples); }
      }
      done += step;
      extend = done + 3 * step >= maxB || now() - t0 > ms * 0.5;
      if (keep.length < need && extend && !o.step) step = 6000;
      if (now() - t0 > ms) break; // JS: time budget
    }
    if (!keep.length && spare.length) spare.forEach(x => { keep.push(x); qsum += x.score; }); // JS: BEN would sample longer than our time budget allows
    const quality = keep.length ? qsum / keep.length : -1;
    let pick = keep;
    if (pick.length >= need) { // a random `need` of them
      pick = pick.slice();
      for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
      pick = pick.slice(0, need);
    }
    pick.sort((a, b) => b.score - a.score);
    return { hands: pick.map(x => x.H), scores: pick.map(x => x.score), quality, binfo: bi };
  }

  // ---- 24-card hands to real cards: our hand given, x's become the missing pips 9..2 at random ----
  function realHands(myCards, hidden24, rand, used = []) {
    const have = new Set([...myCards, ...used]);
    const pips = ST.split('').map(s => { const a = []; for (const r of '98765432') if (!have.has(s + r)) a.push(s + r); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; });
    return hidden24.map(h => {
      const out = [];
      for (let s = 0; s < 4; s++) {
        for (let r = 0; r < 5; r++) if (h[s * 6 + r]) out.push(ST[s] + RK[r]);
        for (let k = 0; k < h[s * 6 + 5]; k++) out.push(pips[s].pop());
      }
      return out;
    });
  }
  const pbnOf = hands4 => 'N:' + hands4.map(h => ST.split('').map(s => h.filter(c => c[0] === s).map(c => c[1]).sort((a, b) => RK.indexOf(a) - RK.indexOf(b)).join('')).join('.')).join(' ');
  const DDT = { S: 0, H: 1, D: 2, C: 3, N: 4 };
  function declTricks(dd, hands4, strain, decl) { // hands4 absolute N E S W
    const r = dd(DDT[strain], (decl + 1) % 4, [], pbnOf(hands4));
    return 13 - Math.max(...r.map(x => x.tricks));
  }
  const vulStr = vul => vul[0] && vul[1] ? 'Both' : vul[0] ? 'NS' : vul[1] ? 'EW' : 'None';
  const appContract = c => ({ level: c.level, strain: c.strain, doubled: c.doubled, declarer: SEATS4[c.declarer] });
  function scoreFor(seat, c, tricks, vul) { // our side's duplicate score
    if (!c) return 0;
    const s = BenCore.score(c, tricks, vul);
    return c.declarer % 2 === seat % 2 ? s : -s;
  }
  const impsOf = d => (d < 0 ? -1 : 1) * toImps(Math.abs(d));
  function roundRobin(ev) { // ev: candidate -> per-sample scores; -> candidate -> mean IMPs vs the others
    const ks = Object.keys(ev), n = ks.length, out = {};
    for (const a of ks) {
      let s = 0;
      const K = ev[a].length;
      if (n > 1) for (const b of ks) if (b !== a) for (let k = 0; k < K; k++) s += impsOf(ev[a][k] - ev[b][k]);
      out[a] = n > 1 && K ? Math.round(s / (K * (n - 1)) * 100) / 100 : 0;
    }
    return out;
  }

  // ---- bidding rollout (botbidder.bidding_rollout, NN greedy) ----
  async function rollout(nn, auc0, call, hix, my, hidden, vul) { // hidden: per sample [lho, pd, rho]
    const aucs = hidden.map(() => [...auc0, call]);
    for (let guard = 0; guard < 64; guard++) {
      const act = aucs.map((a, i) => i).filter(i => !auctionOver(aucs[i]) && aucs[i].length < 64);
      if (!act.length) break;
      // all active auctions have the same length (same seat to call)
      const byLen = new Map();
      act.forEach(i => { const L = aucs[i].length; if (!byLen.has(L)) byLen.set(L, []); byLen.get(L).push(i); });
      for (const [L, ids] of byLen) {
        const seat = L % 4, pos = (seat - hix + 4) % 4, T = stepsFor(aucs[ids[0]], seat), N = ids.length;
        const X = new Float32Array(N * T * F);
        ids.forEach((i, n) => aucBinary(X, n * T * F, T, aucs[i], seat, pos ? hidden[i][pos - 1] : my, vul));
        const out = (await nn.run('bidder', { x: { data: X, dims: [N, T, F] } })).bid;
        ids.forEach((i, n) => {
          const p = Array.from(out.subarray((n * T + T - 1) * 40, (n * T + T) * 40));
          p[0] = p[1] = 0;
          for (;;) {
            let b = 2; for (let j = 2; j < 40; j++) if (p[j] > p[b]) b = j;
            const c = idCall(b);
            if (b === 2 || canBid(c, aucs[i])) { aucs[i].push(c); break; }
            p[b] = 0;
          }
        });
      }
    }
    return aucs;
  }

  // ---- bid (botbidder.bid with BBA off; rescue bids only with o.rescue) ----
  async function bid(nn, dd, m, o = {}) {
    const hix = SEATS4.indexOf(m.seat), auc = padded(m.auction.map(a => a.call || a), m.dealer), vul = vulArr(m.vul), my = h24(m.hand);
    const rand = o.rand || seededRand('ben-bid ' + m.hand.join('') + auc.length);
    const { cs, passout, myNo } = await candidates(nn, auc, hix, my, vul);
    const info = { candidates: cs, samples: 0 };
    const resc = o.rescue === true && nBids(auc) > 4; // off: no change in 300 robot-match boards, and it samples even when the network is sure
    if (cs.length < 2 && !(resc && cs[0].call === 'P')) return { call: cs[0].call, info };
    const S = await sampleAuction(nn, auc, hix, my, vul, rand, o);
    info.samples = S.hands.length; info.quality = S.quality;
    const opening = !auc.some(isBid);
    if (!S.hands.length) return { call: cs[0].call, info };
    const real = S.hands.map(H => realHands(m.hand, H, rand));
    const abs = real.map(R => { const a = []; a[hix] = m.hand; for (let p = 1; p < 4; p++) a[(hix + p) % 4] = R[p - 1]; return a; });
    const rescueOr = async pass => {
      const r = resc && await rescue(nn, dd, auc, hix, my, vul, S, abs, cs, pass, myNo, passout, rand);
      if (r) info.rescue = r;
      return { call: r || pass.call, info };
    };
    if (cs.length < 2) { // the score of passing: the current contract on the samples
      const ct = contractOf(auc); let ev = 0, tr = 0;
      if (ct) abs.forEach(A => { const t = declTricks(dd, A, ct.strain, ct.declarer); ev += scoreFor(hix, ct, t, vul); tr += t; });
      return rescueOr({ call: 'P', ev: ev / abs.length, tricks: tr / abs.length });
    }
    // JS: rollouts in chunks of layouts over all candidates, so a time budget (o.budget ms) ends on whole chunks
    const cache = new Map(), ev = {}, t0 = o.t0 || now(), budget = o.budget || Infinity, chunk = o.chunk || 10;
    const trs = {};
    cs.forEach(c => { ev[c.call] = []; trs[c.call] = []; });
    for (let s0 = 0; s0 < S.hands.length; s0 += chunk) {
      if (s0 >= (o.minRoll || 8) && now() - t0 > budget) break;
      const H = S.hands.slice(s0, s0 + chunk);
      for (const c of cs) {
        const aucs = await rollout(nn, auc, c.call, hix, my, H, vul);
        aucs.forEach((a, j) => {
          const k = s0 + j, ct = contractOf(a);
          if (!ct) { ev[c.call].push(0); trs[c.call].push(0); return; }
          const key = k + ct.strain + ct.declarer;
          if (!cache.has(key)) cache.set(key, declTricks(dd, abs[k], ct.strain, ct.declarer));
          trs[c.call].push(cache.get(key));
          ev[c.call].push(scoreFor(hix, ct, cache.get(key), vul));
        });
      }
    }
    for (const c of cs) c.ev = ev[c.call].reduce((a, b) => a + b, 0) / ev[c.call].length;
    info.rolled = ev[cs[0].call].length;
    const imp = roundRobin(ev), undist = auc.slice().reverse().filter((_, i) => i % 2 === 0).every(x => callId(x) <= 3);
    const curLevel = (() => { const b = auc.slice().reverse().find(isBid); return b ? +b[0] : 0; })();
    for (const c of cs) {
      let adj = 0;
      if (c.insta < 0.002) adj -= 200;
      if (c.insta < 0.0002) adj -= 200;
      if (!/^[567]/.test(c.call)) adj += (S.hands.length <= 15 ? 100 : undist ? 200 : 60) * c.insta;
      if (passout && c.insta < 0.10) {
        if (isBid(c.call)) adj += c.ev < 0 ? 0.5 * c.ev : -100;
        if (c.call === 'X') adj -= vul[(hix + 1) % 2] ? (c.ev < 200 ? 200 : 100) : (c.ev < 100 ? 200 : 100);
        if (c.call === 'XX') adj -= vul[hix % 2] ? 400 : 200;
      } else if (c.call === 'X' && c.insta < 0.5 && nBids(auc) > 4) adj -= curLevel > 5 ? 200 : 100;
      if (c.call === 'X' && c.insta < 0.1) adj -= 200;
      c.imp = imp[c.call]; c.adjust = adj * (o.adjK ?? 1) / 25;
    }
    void opening;
    const trust = !(S.quality < 0.70 || S.hands.length < 15), r2 = x => Math.round(x * 100) / 100;
    const sorted = cs.slice().sort((a, b) => trust
      ? (b.imp + b.adjust) - (a.imp + a.adjust) || r2(b.insta) - r2(a.insta)
      : b.insta - a.insta || (b.imp + b.adjust) - (a.imp + a.adjust));
    info.trust = trust;
    if (sorted[0].call === 'P') { const t = trs.P; return rescueOr({ call: 'P', ev: sorted[0].ev, tricks: t.reduce((x, y) => x + y, 0) / t.length }); }
    return { call: sorted[0].call, info };
  }

  // ---- rescue bid (botbidder.evaluate_rescue_bid and its check_final_contract block): instead of passing in a
  // contract the samples score badly, bid the contract the contract network picks for most of them ----
  async function rescue(nn, dd, auc, hix, my, vul, S, abs, cs, pass, myNo, passout, rand) {
    if (S.hands.length < 15 || nBids(auc) < 4 || !(S.quality > 0.40)) return null;
    if (!passout && (myNo < 2 || (myNo < 3 && callId(auc[auc.length - 1]) < 14))) return null;
    if (!(pass.ev < 1430)) return null;
    const idx = S.hands.map((_, i) => i).filter(i => S.scores[i] >= 0.55);
    if (idx.length < 15) return null;
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const chk = idx.slice(0, 20), N = chk.length, X = new Float32Array(N * 50), XT = new Float32Array(N * 5 * 55);
    chk.forEach((i, n) => {
      X[n * 50] = vul[hix % 2] ? 1 : 0; X[n * 50 + 1] = vul[(hix + 1) % 2] ? 1 : 0;
      X.set(my, n * 50 + 2); X.set(S.hands[i][1], n * 50 + 26);
      for (let st = 0; st < 5; st++) { XT.set(X.subarray(n * 50, n * 50 + 50), (n * 5 + st) * 55); XT[(n * 5 + st) * 55 + 50 + st] = 1; }
    });
    const con = (await nn.run('contract', { x: { data: X, dims: [N, 50] } })).contract;
    const tk = (await nn.run('trick', { x: { data: XT, dims: [N * 5, 55] } })).tricks;
    const c0 = contractOf(auc), cur = c0 ? c0.level + c0.strain : '', alt = new Map();
    for (let n = 0; n < N; n++) {
      let best = 0, cid = -1, tricks = 0, any = false;
      for (let i = 5; i < 40; i++) {
        if (!(con[n * 40 + i] > 0.2)) continue;
        const st = 'NSHDC'.indexOf(idCall(i)[1]);
        let mt = -1, ts = 0;
        for (let j = 0; j < 14; j++) { const q = tk[(n * 5 + st) * 14 + j]; if (q > 0.1) { any = true; if (q > ts) { ts = q; mt = j; } } }
        if (con[n * 40 + i] > best && mt >= 0) { best = con[n * 40 + i]; cid = i; tricks = mt; }
      }
      if (!any || cid < 0) break;
      let c = idCall(cid);
      while (!canBid(c, auc) && cid < 35) c = idCall(cid += 5);
      if ((cur === '4H' && c === '5H') || (cur === '4S' && c === '5S') || (cur === '3N' && /^[456]N/.test(c)) || (cur === '6N' && c === '7N') || cur === c) return null;
      if (cs.some(x => x.call === c)) return null;
      if (!canBid(c, auc)) continue;
      const lv = +c[0], sc = scoreFor(hix, { level: lv, strain: c[1], doubled: tricks < lv + 6 ? 1 : 0, declarer: hix }, tricks, vul);
      if (!alt.has(c)) alt.set(c, []);
      alt.get(c).push({ sc, tricks });
    }
    const tot = [...alt.values()].reduce((a, v) => a + v.length, 0);
    if (!(tot > 0.75 * Math.min(S.hands.length, 20))) return null;
    let top = null; for (const [c, v] of alt) if (!top || v.length > alt.get(top).length) top = c;
    const v = alt.get(top), avgS = Math.round(v.reduce((a, x) => a + x.sc, 0) / v.length), avgT = v.reduce((a, x) => a + x.tricks, 0) / v.length;
    if (!(avgS > pass.ev + 500 || avgT - pass.tricks > 4)) return null;
    const ct = contractOf([...auc, top, 'P', 'P', 'P']), A = abs.slice(0, 20);
    let ev = 0, evd = 0, et = 0;
    for (const h of A) { const t = declTricks(dd, h, ct.strain, ct.declarer); ev += scoreFor(hix, ct, t, vul); evd += scoreFor(hix, { ...ct, doubled: 1 }, t, vul); et += t; }
    const es = Math.min(ev, evd) / A.length;
    return es > pass.ev + 500 || avgT - et / A.length > 4 ? top : null;
  }

  // ======================= opening lead (botopeninglead.BotLead.find_opening_lead) =======================
  function leadX(X, off, hand32, ct, lix, vul) {
    X[off] = ct.level; X[off + 1 + NSHDC.indexOf(ct.strain)] = 1; X[off + 6] = ct.doubled ? 1 : 0; X[off + 7] = ct.doubled === 2 ? 1 : 0;
    X[off + 8] = vul[lix % 2] ? 1 : 0; X[off + 9] = vul[ct.declarer % 2] ? 1 : 0;
    for (let i = 0; i < 32; i++) X[off + 10 + i] = hand32[i];
  }
  // lead softmax for N leader hands (32-card counts), B from binfo on each hand; masked to the cards held
  async function leadSoftmax(nn, auc, lix, ct, vul, hands32, hands24) {
    const N = hands32.length, X = new Float32Array(N * 42), Bv = new Float32Array(N * 15);
    const T = infoSteps(auc), A = new Float32Array(N * T * F);
    for (let n = 0; n < N; n++) { leadX(X, n * 42, hands32[n], ct, lix, vul); aucBinary(A, n * T * F, T, auc, lix, hands24[n], vul); }
    const bi = await nn.run('binfo', { x: { data: A, dims: [N, T, F] } });
    for (let n = 0; n < N; n++) {
      for (let i = 0; i < 3; i++) Bv[n * 15 + i] = bi.hcp[(n * T + T - 1) * 3 + i];
      for (let i = 0; i < 12; i++) Bv[n * 15 + 3 + i] = bi.shape[(n * T + T - 1) * 12 + i];
    }
    const out = (await nn.run(ct.strain === 'N' ? 'lead_nt' : 'lead_suit', { x: { data: X, dims: [N, 42] }, b: { data: Bv, dims: [N, 15] } })).lead;
    return hands32.map((h, n) => {
      const p = Array.from(out.subarray(n * 32, n * 32 + 32)).map((v, i) => h[i] > 0 ? v : 0);
      const sum = p.reduce((a, b) => a + b, 0);
      return sum < 1e-9 ? p : p.map(v => v / sum);
    });
  }
  const suitCards = (hand, s) => hand.filter(c => c[0] === s).sort((a, b) => RK.indexOf(a[1]) - RK.indexOf(b[1]));
  const honHcp = cards => cards.reduce((a, c) => a + Math.max(0, 4 - RK.indexOf(c[1])), 0);
  function pip24(cs) {
    const hc = honHcp(cs), hasT = cs.some(c => c[1] === 'T'), n = cs.length;
    if (n === 2 && hasT && !hc) return cs[0];
    if (n < 4) {
      if (!hc && hasT) return cs[1];
      if (n === 2) return cs[0];
      return RK.indexOf(cs[1][1]) - RK.indexOf(cs[0][1]) === 1 ? cs[0] : cs[1];
    }
    return !hc ? cs[1] : cs[3];
  }
  function pip135(cs) { return cs.length < 3 ? cs[0] : cs.length < 5 ? cs[2] : cs[4]; }
  // carding.select_right_card: the actual card for a 32-code that is the 8 or an x
  function rightCard(hand, slot, strain, rand) {
    const s = ST[slot / 8 | 0], cs = suitCards(hand, s);
    if (strain === 'N' && cs.length > 1) return pip24(cs);
    if (strain !== 'N' && s === strain) return cs[cs.length - 1];
    if (strain !== 'N') return pip135(cs);
    if (slot % 8 === 7) { const lo = cs.filter(c => RK.indexOf(c[1]) >= 7); if (lo.length) return lo[Math.floor(rand() * lo.length)]; }
    return cs.find(c => c[1] === '8') || cs[cs.length - 1];
  }
  const slotCard = (hand, slot, rand) => {
    const s = ST[slot / 8 | 0], r = slot % 8;
    if (r < 7) return s + RK[r];
    const lo = hand.filter(c => c[0] === s && RK.indexOf(c[1]) >= 7);
    return lo[Math.floor(rand() * lo.length)];
  };
  function partnerSuit(auc, lix) { // suit of partner's first contract bid (NT: none)
    for (let j = (lix + 2) % 4; j < auc.length; j += 4) if (isBid(auc[j])) return auc[j][1] === 'N' ? null : auc[j][1];
    return null;
  }
  async function lead(nn, dd, m, o = {}) {
    const lix = SEATS4.indexOf(m.seat), auc = padded(m.auction.map(a => a.call || a), m.dealer), vul = vulArr(m.vul);
    const ct = { ...m.contract, declarer: SEATS4.indexOf(m.contract.declarer) }, hand = m.hand;
    const rand = o.rand || seededRand('ben-lead ' + hand.join('') + auc.join(''));
    const sm = (await leadSoftmax(nn, auc, lix, ct, vul, [h32(hand)], [h24(hand)]))[0];
    const s = sm.slice(), cands = [];
    for (;;) { let c = 0; for (let i = 1; i < 32; i++) if (s[i] > s[c]) c = i; if (s[c] <= 0 || (s[c] < CFG.leadThr && cands.length >= 4)) break; cands.push(c); s[c] = 0; }
    const info = { candidates: cands.map(c => ({ slot: c, insta: sm[c] })), samples: 0 };
    const finish = slot => (slot % 8 <= 5 ? ST[slot / 8 | 0] + RK[slot % 8] : rightCard(hand, slot, ct.strain, rand));
    if (sm[cands[0]] > 0.999 || cands.length < 2) return { card: finish(cands[0]), info };
    const S = await sampleAuction(nn, auc, lix, h24(hand), vul, rand, { need: o.need || CFG.leadSamples, maxBoards: o.maxBoards || CFG.leadBoards, step: o.step, ms: o.ms, spare: o.spare !== false });
    if (!S.hands.length) return { card: finish(cands[0]), info };
    info.samples = S.hands.length; info.quality = S.quality;
    const real = {}, t0 = now(), budget = o.budget || Infinity, T0 = o.t0 || t0;
    const cardOf = {}; for (const c of cands) { cardOf[c] = slotCard(hand, c, rand); real[c] = []; }
    for (let k = 0; k < S.hands.length; k++) {
      if (k >= (o.minRoll || 8) && now() - T0 > budget) break;
      const R = realHands(hand, S.hands[k], rand);
      for (const c of cands) {
        const card = cardOf[c], abs = [];
        abs[lix] = hand.filter(x => x !== card); for (let p = 1; p < 4; p++) abs[(lix + p) % 4] = R[p - 1];
        const r = dd(DDT[ct.strain], lix, [card], pbnOf(abs));
        real[c].push(-BenCore.score(ct, Math.max(...r.map(x => x.tricks)), vul));
      }
    }
    info.rolled = real[cands[0]].length;
    info.ddMs = now() - t0;
    const imp = roundRobin(real), ps = partnerSuit(auc, lix);
    for (const ci of info.candidates) {
      const su = ST[ci.slot / 8 | 0], cs = suitCards(hand, su);
      let adj = 0;
      if (su === ps) adj += 0.5;
      if (ct.strain !== 'N' && su === ct.strain) {
        adj -= 0.2;
        if (cs.length === 1) adj -= cs[0][1] === 'A' ? 0.2 : cs[0][1] === 'K' ? 0.5 : cs[0][1] === 'Q' ? 0.2 : 0;
      }
      if (ct.level >= 6 && cs.length) {
        if (cs[0][1] === 'Q' && !cs.some(c => c[1] === 'J')) adj -= 1;
        if (cs[0][1] === 'J' && !cs.some(c => c[1] === 'T')) adj -= 0.5;
      }
      ci.imp = imp[ci.slot]; ci.score = Math.round(imp[ci.slot] * 100) / 100 + adj;
    }
    const r2 = x => Math.round(x * 100) / 100;
    const best = info.candidates.slice().sort((a, b) => b.score - a.score || r2(b.insta) - r2(a.insta))[0];
    return { card: finish(best.slot), info };
  }

  // ======================= card play (botcardplayer.CardPlayer, no PIMC / SuitC) =======================
  const PF = 298, ROLE = ['lefty', 'dummy', 'righty', 'decl'];
  const lowFirst = (a, b) => RK.indexOf(b[1]) - RK.indexOf(a[1]);
  function trickWin(cards, strain) { // cards: [{seat, card}] in play order -> index of the winner
    let w = 0;
    for (let i = 1; i < cards.length; i++) {
      const a = cards[w].card, b = cards[i].card;
      if ((b[0] === a[0] && RK.indexOf(b[1]) < RK.indexOf(a[1])) || (b[0] === strain && a[0] !== strain)) w = i;
    }
    return w;
  }
  // the play so far as declarer-relative seats: tricks [{ leader, cards: [{ rel, card }] }], incl. the current one
  function relTricks(view) {
    const decl = SEATS4.indexOf(view.contract.declarer), rel = s => (SEATS4.indexOf(s) - decl + 3) % 4;
    const tr = view.tricks.filter(t => t.cards.length).map(t => ({ leader: rel(t.leader), cards: t.cards.map(pc => ({ rel: rel(pc.seat), card: pc.card })) }));
    const last = tr[tr.length - 1];
    if (!last || last.cards.length === 4) {
      const lead = last ? last.cards[trickWin(last.cards.map(c => ({ card: c.card })), view.contract.strain)].rel : 0;
      tr.push({ leader: lead, cards: [] });
    }
    return { tr, rel, decl };
  }
  // x_play [T, 298] for seat p (0..3, declarer-relative) given the full 13-card hands of p and of the public hand
  function encodePlay(X, base, p, own, pub, tr, T, level, strain) {
    const pubRel = p === 1 ? 3 : 1, si = NSHDC.indexOf(strain);
    const ownH = h32(own), pubH = h32(pub);
    for (let t = 0; t < T; t++) {
      const o = base + t * PF, cur = tr[t];
      for (let i = 0; i < 32; i++) { X[o + i] = ownH[i]; X[o + 32 + i] = pubH[i]; }
      if (t > 0) {
        const pv = tr[t - 1];
        pv.cards.forEach((c, k) => { X[o + 64 + k * 32 + c32(c.card)] = 1; });
        X[o + 288 + pv.leader] = 1;
      }
      X[o + 292] = level; X[o + 293 + si] = 1;
      const myPos = (p - cur.leader + 4) % 4;
      cur.cards.forEach((c, k) => {
        if (k >= myPos || c.rel === p) return;
        if (c.rel === pubRel) X[o + 32 + c32(c.card)] -= 1;
        const off = (p - c.rel + 4) % 4;
        X[o + 192 + (3 - off) * 32 + c32(c.card)] = 1;
      });
      // the hands at the start of the next trick
      cur.cards.forEach(c => { if (c.rel === p) ownH[c32(c.card)]--; if (c.rel === pubRel) pubH[c32(c.card)]--; });
    }
  }
  const red24 = (out, o, slot) => { const s = slot / 8 | 0, r = slot % 8; return r < 5 ? out[o + slot] : out[o + s * 8 + 5] + out[o + s * 8 + 6] + out[o + s * 8 + 7]; };
  const playModel = (p, strain) => ROLE[p] + (strain === 'N' ? '_nt' : '_suit');

  async function play(nn, solve, view, o = {}) {
    const ct = view.contract, strain = ct.strain, { tr, rel, decl } = relTricks(view);
    const seat = view.seat, p = rel(seat), sIx = SEATS4.indexOf(seat);
    const abs = r => SEATS4[(decl + 1 + r) % 4];
    const pubSeat = abs(p === 1 ? 3 : 1), T = tr.length, cur = tr[T - 1];
    const playedBy = {}; for (const s of SEATS4) playedBy[s] = [];
    for (const t of tr) for (const c of t.cards) playedBy[abs(c.rel)].push(c.card);
    const own = [...view.known[seat], ...playedBy[seat]], pub = [...(view.known[pubSeat] || []), ...playedBy[pubSeat]];
    const rand = o.rand || seededRand('ben-play ' + own.join('') + T + cur.cards.length);
    const hand = view.known[seat], ledS = cur.cards.length ? cur.cards[0].card[0] : null;
    const follow = ledS ? hand.filter(c => c[0] === ledS) : [];
    const legal = follow.length ? follow : hand.slice();
    const info = { samples: 0 };
    if (legal.length === 1) return { card: legal[0], info: { ...info, why: 'forced' } };
    if (follow.length > 1) {
      const idx = follow.map(c => RK.indexOf(c[1])).sort((a, b) => a - b);
      if (idx.every((v, i) => !i || v - idx[i - 1] === 1)) {
        const srt = follow.slice().sort((a, b) => RK.indexOf(a[1]) - RK.indexOf(b[1]));
        return { card: p === 3 ? srt[0] : srt[srt.length - 1], info: { ...info, why: 'sequence' } };
      }
    }
    // NN scores
    const X = new Float32Array(T * PF);
    encodePlay(X, 0, p, own, pub, tr, T, ct.level, strain);
    const out = (await nn.run(playModel(p, strain), { x: { data: X, dims: [1, T, PF] } })).card;
    let sm = Array.from(out.subarray((T - 1) * 32, T * 32));
    const held = h32(hand), ok = new Float32Array(32); legal.forEach(c => { ok[c32(c)] = 1; });
    sm = sm.map((v, i) => held[i] && ok[i] ? v : 0);
    const sum = sm.reduce((a, b) => a + b, 0); if (sum > 1e-9) sm = sm.map(v => v / sum);
    const seen = new Set([...Object.values(playedBy).flat(), ...Object.values(view.known).flat()]);
    const nnScore = c => {
      let v = sm[c32(c)];
      if (!ledS && T > 9) { const higher = RK.slice(0, RK.indexOf(c[1])).split('').map(r => c[0] + r); if (higher.every(x => seen.has(x) && !hand.includes(x))) v = Math.max(v, 0.5); }
      return Math.round(v * 1000) / 1000;
    };
    const nnTop = () => legal.slice().sort((a, b) => nnScore(b) - nnScore(a) || lowFirst(a, b))[0];
    // sample the hidden hands (JS: the app's auction-limit sampler deals the pool; BEN's networks weight it)
    const poolN = o.pool || 120, k = o.k || 40, t0 = now();
    const hidden = [...SEATS4].filter(s => !view.known[s]);
    const cnt = new Map(), keys = [];
    const draw = () => ddSample(view.limits ? view : { ...view, limits: {} }, poolN, rand).filter(h => { // unique layouts, as BEN's get_unique_samples (with their counts)
      const key = hidden.map(s => h[s].slice().sort().join('')).join('|');
      if (cnt.has(key)) { cnt.set(key, cnt.get(key) + 1); return false; }
      cnt.set(key, 1); keys.push(key); return true;
    });
    const pool = draw();
    if (!pool.length) return { card: nnTop(), info: { ...info, why: 'no samples' } };
    const fullOf = (h, s) => [...h[s], ...playedBy[s]];
    const vul = vulArr(view.vul), aucCalls = view.auction.map(a => a.call), dealer = view.auction.length ? view.auction[0].by : 'N';
    const auc = padded(aucCalls, dealer);
    const weigh = async pool => {
    const w = pool.map(() => ({ bid: 1, lead: 1, play: 1 }));
    for (const s of hidden) { // bidding: min over its calls of the bidder's probability of the call made
      const hix = SEATS4.indexOf(s), idx = [];
      for (let j = hix; j < auc.length; j += 4) if (auc[j] !== 'PAD_START') idx.push(j);
      if (!idx.length) continue;
      const Tb = idx.length, N = pool.length, A = new Float32Array(N * Tb * F);
      pool.forEach((h, n) => aucBinary(A, n * Tb * F, Tb, auc, hix, h24(fullOf(h, s)), vul));
      const ob = (await nn.run('bidder', { x: { data: A, dims: [N, Tb, F] } })).bid;
      pool.forEach((h, n) => { let mn = 1; idx.forEach((j, t) => { mn = Math.min(mn, ob[(n * Tb + t) * 40 + callId(auc[j])]); }); w[n].bid = Math.min(w[n].bid, mn); });
    }
    const leftySeat = abs(0), firstLead = tr[0].cards[0];
    if (hidden.includes(leftySeat) && firstLead && pool.length >= 20) { // the opening lead from the sampled lefty hand
      const H = pool.map(h => fullOf(h, leftySeat));
      const ctA = { ...ct, declarer: decl };
      const ps = await leadSoftmax(nn, auc, SEATS4.indexOf(leftySeat), ctA, vul, H.map(h32), H.map(h24));
      ps.forEach((q, n) => { w[n].lead = red24(q, 0, c32(firstLead.card)); });
    }
    for (const s of hidden) { // the play so far from each hidden hand, by its own play network
      const r = rel(s), mine = [];
      tr.forEach((t, ti) => t.cards.forEach(c => { if (c.rel === r && !(ti === 0 && (r === 0 || r === 3))) mine.push([ti, c.card]); }));
      if (!mine.length) continue;
      const Tp = mine[mine.length - 1][0] + 1, N = pool.length, A = new Float32Array(N * Tp * PF);
      const pubR = r === 1 ? 3 : 1, pubS = abs(pubR);
      pool.forEach((h, n) => encodePlay(A, n * Tp * PF, r, fullOf(h, s), view.known[pubS] ? [...view.known[pubS], ...playedBy[pubS]] : fullOf(h, pubS), tr, Tp, ct.level, strain));
      const op = (await nn.run(playModel(r, strain), { x: { data: A, dims: [N, Tp, PF] } })).card;
      pool.forEach((h, n) => { let mn = 1; for (const [ti, c] of mine) mn = Math.min(mn, red24(op, (n * Tp + ti) * 32, c32(c))); w[n].play = Math.min(w[n].play, mn); });
    }
    return w; };
    const w = await weigh(pool);
    // o.maxPool: when few layouts fit the play so far, deal more, as BEN's 5000-board pool would (closer to BEN's vectors, 1013 vs 1010/1130,
    // but -0.22 +- 0.11 IMPs/board over 300 boards at the browser's time budget, so off by default)
    const fits = i => !(w[i].lead < 0.10) && !(w[i].play < 0.10);
    for (let tries = 0; tries < 8 && pool.length < (o.maxPool || 0) && now() - t0 < (o.ms || Infinity) * 0.3 && pool.filter((_, i) => fits(i)).length < 10; tries++) {
      const more = draw(); if (!more.length) break;
      w.push(...await weigh(more)); pool.push(...more);
    }
    // filters as BEN's thresholds (lowered until enough layouts pass), then the best k by bidding score
    let ids = pool.map((_, i) => i);
    const keep = (key, thr0, step, minPass, mult) => {
      for (let t = thr0; t > 1e-3; t = mult ? t / 2 : t - step) { const f = ids.filter(i => w[i][key] > t); if (f.length >= minPass) { ids = f; return; } }
    };
    if (w.some(x => x.lead !== 1)) keep('lead', 0.10, 0, Math.min(20, ids.length), true);
    if (w.some(x => x.play !== 1)) keep('play', 0.10, 0.01, Math.min(10, ids.length), false);
    const good = ids.filter(i => w[i].bid > 0.70);
    if (good.length >= k) ids = good;
    ids.sort((a, b) => w[b].bid - w[a].bid);
    ids = ids.slice(0, k);
    const quality = ids.reduce((a, i) => a + w[i].bid, 0) / ids.length;
    info.quality = quality; info.sampleMs = now() - t0;
    // double dummy on each layout
    const res = [], prob = [];
    const ms = o.ms || Infinity, minK = Math.min(o.minK || 10, ids.length);
    for (const i of ids) {
      if (res.length >= minK && now() - t0 > ms) break;
      const r = await solve(ddJob(view, pool[i]));
      if (!r) continue;
      res.push(r); prob.push((quality > 0.5 ? Math.max(w[i].bid, 1e-4) : 1) * cnt.get(keys[i]));
    }
    if (res.length < Math.min(4, ids.length)) return { card: nnTop(), info: { ...info, why: 'dd budget' } };
    const ps = prob.reduce((a, b) => a + b, 0), pk = prob.map(x => x / ps);
    info.samples = res.length;
    // scores: our side's duplicate score for the tricks taken
    const onDecl = p === 1 || p === 3;
    let ourTaken = 0;
    tr.forEach(t => { if (t.cards.length === 4) { const wr = t.cards[trickWin(t.cards, strain)].rel; if ((wr === 1 || wr === 3) === onDecl) ourTaken++; } });
    const ctA = { ...ct, declarer: decl };
    const real = legal.map(c => res.map(r => { const our = ourTaken + (r[c] != null ? r[c] : 0); const s = BenCore.score(ctA, onDecl ? our : 13 - our, vul); return onDecl ? s : -s; }));
    const eTr = legal.map(c => res.reduce((a, r, k2) => a + pk[k2] * (r[c] || 0), 0));
    const eSc = legal.map((c, i) => {
      if (legal.length < 2) return 0;
      let s = 0;
      for (let j = 0; j < legal.length; j++) if (j !== i) for (let k2 = 0; k2 < res.length; k2++) s += impsOf(real[i][k2] - real[j][k2]) * pk[k2];
      return Math.round(s / (legal.length - 1) * 100) / 100;
    });
    // trump adjustment: declaring side on lead, opponents had at most 5 trumps
    let tAdj = 0;
    if (strain !== 'N' && onDecl && !ledS) {
      const ours = [...own, ...pub].filter(c => c[0] === strain).length;
      if (13 - ours <= 5) {
        const out = RK.split('').map(r => strain + r).filter(c => !seen.has(c));
        if (out.length) {
          const myTop = [...view.known[seat], ...(view.known[pubSeat] || [])].filter(c => c[0] === strain).sort((a, b) => RK.indexOf(a[1]) - RK.indexOf(b[1]))[0];
          tAdj = out.length === 1 && (!myTop || RK.indexOf(out[0][1]) < RK.indexOf(myTop[1])) ? 0 : 0.2;
        } else tAdj = -0.05;
      }
    }
    const cands = legal.map((c, i) => {
      const nv = nnScore(c);
      let adj = c[0] === strain ? tAdj : 0;
      if (nv > 0.25) adj += Math.round(nv * 0.2 * 100) / 100;
      return { card: c, score: Math.round((eSc[i] + adj) * 100) / 100, tricks: Math.round((eTr[i] + adj) * 1000) / 1000, nn: nv };
    });
    cands.sort((a, b) => b.score - a.score || b.tricks - a.tricks || b.nn - a.nn || lowFirst(a.card, b.card));
    info.candidates = cands; info.ms = now() - t0;
    let card = cands[0].card;
    const top = cands[0], pip = RK.indexOf(card[1]) >= 7;
    if (p !== 3 && pip) {
      if (!ledS && !playedBy[seat].some(c => c[0] === card[0]) && p !== 1) card = rightCard(hand, c32(card), strain, rand);
      else if (p === 1 && (!ledS || ledS !== card[0])) card = suitCards(hand, card[0]).pop();
    }
    if (p === 1 && ledS === top.card[0]) { // dummy following: the lowest card equal to the top
      const eq = cands.filter(c => c.card[0] === top.card[0] && c.score === top.score && c.tricks === top.tricks && c.nn === top.nn).map(c => c.card);
      card = eq.sort(lowFirst)[0];
    }
    if (!legal.includes(card)) card = top.card;
    return { card, info };
  }

  return {
    lead, play, leadSoftmax, encodePlay, relTricks, rightCard, infoSteps,
    CFG, callId, idCall, canBid, auctionOver, contractOf, padded, h24, h32, c32, hcp24, shp24, vulArr, vulStr, appContract,
    aucBinary, stepsFor, bidderLast, binfoLast, candidates, dealVec, scoreLayouts, sampleAuction, realHands, pbnOf,
    declTricks, scoreFor, roundRobin, rollout, bid, impsOf, F, RK, ST, SEATS4, DDT, now,
    score: (c, tricks, vul) => scoreContract(appContract(c), tricks, vulStr(vul)),
  };
})();
if (typeof module !== 'undefined') module.exports = BenCore;
