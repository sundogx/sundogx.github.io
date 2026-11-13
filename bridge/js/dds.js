// ===== Double-dummy solver =====
// Seats 0..3 = N,E,S,W; suits 0..3 = S,H,D,C; ranks 0..12 = 2..A, stored as bitmasks per suit.
const DDS = (() => {
  const SEAT_IX = { N: 0, E: 1, S: 2, W: 3 }, SUIT_IX = { S: 0, H: 1, D: 2, C: 3 };
  const STRAIN_IX = { S: 0, H: 1, D: 2, C: 3, N: 4 };
  const RANK = '23456789TJQKA';
  const pc = x => { let n = 0; while (x) { x &= x - 1; n++; } return n; };
  const hiBit = x => 31 - Math.clz32(x);
  const loBit = x => 31 - Math.clz32(x & -x);

  function toMasks(handsBySeat) { // {N:[cards], ...} -> h[seat][suit]
    const h = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (const s in handsBySeat) for (const c of handsBySeat[s]) h[SEAT_IX[s]][SUIT_IX[c[0]]] |= 1 << RANK.indexOf(c[1]);
    return h;
  }

  function solver(h, trump) {
    // Partition search: every result carries a relevance mask (per suit, the lowest absolute rank that mattered).
    // Packed as 4 nibbles; 13 = nothing in that suit matters.
    const NONE = 13 | 13 << 4 | 13 << 8 | 13 << 12;
    const nib = (r, s) => (r >> (s * 4)) & 15;
    const minRel = (a, b) => { let o = 0; for (let s = 0; s < 4; s++) o |= Math.min(nib(a, s), nib(b, s)) << (s * 4); return o; };
    const setNib = (r, s, v) => (r & ~(15 << (s * 4))) | (v << (s * 4));
    const buckets = new Map();
    let nodes = 0, RET = NONE;
    const ns = p => (p & 1) === 0;
    const trickCards = [0, 0, 0, 0];
    const ordScore = new Array(13).fill(0);
    const mvBuf = []; for (let i = 0; i < 60; i++) mvBuf.push([]);

    function lenKey(leader) {
      let k = leader;
      for (let p = 0; p < 4; p++) for (let s = 0; s < 4; s++) k = k * 14 + pc(h[p][s]);
      return k; // 4 * 14^16 exceeds 2^53 slightly in theory, but real lengths sum to <= 13 per suit; keep as string to be safe
    }
    function lenKeyStr(leader) {
      let k = '' + leader;
      for (let p = 0; p < 4; p++) k += String.fromCharCode(65 + pc(h[p][0]), 65 + pc(h[p][1]), 65 + pc(h[p][2]), 65 + pc(h[p][3]));
      return k;
    }
    // owners of the remaining cards in suit s from the top, as base-4 digits; prefix values for m = 0..len
    const pref = [[], [], [], []];
    function computePrefixes() {
      for (let s = 0; s < 4; s++) {
        const a0 = h[0][s], a1 = h[1][s], a2 = h[2][s], a3 = h[3][s], all = a0 | a1 | a2 | a3;
        const P = pref[s]; P.length = 0; P.push(0); let v = 0;
        for (let r = 12; r >= 0; r--) { const bit = 1 << r; if (all & bit) { v = v * 4 + ((a0 & bit) ? 0 : (a1 & bit) ? 1 : (a2 & bit) ? 2 : 3); P.push(v); } }
      }
    }
    // translate a relevance mask to "top m cards per suit" for the current position
    function relToCounts(rel, out) {
      for (let s = 0; s < 4; s++) {
        const T = nib(rel, s), all = h[0][s] | h[1][s] | h[2][s] | h[3][s];
        out[s] = T >= 13 ? 0 : pc(all >> T);
      }
      return out;
    }
    function countsToRel(m) {
      let rel = NONE;
      for (let s = 0; s < 4; s++) {
        if (!m[s]) continue;
        const all = h[0][s] | h[1][s] | h[2][s] | h[3][s];
        let k = 0, r = 12;
        for (; r >= 0; r--) if (all & (1 << r)) { k++; if (k === m[s]) break; }
        rel = setNib(rel, s, r);
      }
      return rel;
    }
    function cashable(p, other, o1, o2, oppTrumps, s, info) {
      const mine = h[p][s]; info.low = 13; if (!mine) return 0;
      const them = h[o1][s] | h[o2][s], pd = h[other][s];
      if (!them && !pd) { const w0 = pc(mine); return oppTrumps && s !== trump ? 0 : w0; }
      const bar = Math.max(them ? hiBit(them) : -1, pd ? hiBit(pd) : -1);
      let w = 0, m = mine, lowR = 13;
      const cap = oppTrumps && s !== trump ? Math.min(pc(h[o1][s]), pc(h[o2][s])) : 13;
      while (m && hiBit(m) > bar && w < cap) { lowR = hiBit(m); w++; m &= ~(1 << hiBit(m)); }
      info.low = w ? lowR : 13;
      return w;
    }
    const qi = { low: 13 };
    function quickTricks(leader) { // returns count; sets qRel
      const pard = (leader + 2) & 3, o1 = (leader + 1) & 3, o2 = (leader + 3) & 3;
      const oppTrumps = trump < 4 ? (h[o1][trump] | h[o2][trump]) : 0;
      let qL = 0, qP = 0, entry = false, rL = NONE, rP = NONE;
      for (let s = 0; s < 4; s++) {
        const wl = cashable(leader, pard, o1, o2, oppTrumps, s, qi);
        qL += wl; if (wl && qi.low < 13) rL = setNib(rL, s, qi.low);
        const wp = cashable(pard, leader, o1, o2, oppTrumps, s, qi);
        qP += wp; if (wp && qi.low < 13) rP = setNib(rP, s, qi.low);
        if (wp > 0 && h[leader][s] && qi.low < 13) entry = true;
      }
      if (entry && qP > qL) { qRel = rP; return qP; }
      qRel = rL; return qL;
    }
    let qRel = NONE;
    function moves(p, ledSuit, out, n) {
      out.length = 0;
      const one = ledSuit >= 0 && h[p][ledSuit];
      for (let s = one ? ledSuit : 0; s < (one ? ledSuit + 1 : 4); s++) {
        const m = h[p][s]; if (!m) continue;
        let all = h[0][s] | h[1][s] | h[2][s] | h[3][s];
        for (let i = 0; i < n; i++) if ((trickCards[i] >> 4) === s) all |= 1 << (trickCards[i] & 15);
        let inRun = false;
        for (let r = 12; r >= 0; r--) {
          const bit = 1 << r;
          if (m & bit) { if (!inRun) { out.push(s * 16 + r); inRun = true; } }
          else if (all & bit) inRun = false;
        }
      }
      return out;
    }
    function beats(a, b) { const sa = a >> 4, sb = b >> 4; if (sa === sb) return (a & 15) > (b & 15); return sa === trump; }
    // a collapsed run that straddles the relevance threshold must become fully relevant
    function fixRuns(rel, p, mv, n) {
      for (const c of mv) {
        const s = c >> 4, top = c & 15, T = nib(rel, s);
        if (top < T) continue;
        let all = h[0][s] | h[1][s] | h[2][s] | h[3][s];
        for (let i = 0; i < n; i++) if ((trickCards[i] >> 4) === s) all |= 1 << (trickCards[i] & 15);
        const mine = h[p][s];
        let low = top;
        for (let r = top - 1; r >= 0; r--) { const bit = 1 << r; if (mine & bit) low = r; else if (all & bit) break; }
        if (low < T) rel = setNib(rel, s, low);
      }
      return rel;
    }
    const cnt = [0, 0, 0, 0];
    function search(leader, need, tricksLeft, depth) {
      if (need <= 0) { RET = NONE; return true; }
      if (need > tricksLeft) { RET = NONE; return false; }
      const key = lenKeyStr(leader);
      let list = buckets.get(key);
      if (list) {
        computePrefixes();
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.lo ? e.v < need : e.v >= need) continue; // bound wouldn't decide this
          let ok = true;
          for (let s = 0; s < 4 && ok; s++) if (pref[s][e.m[s]] !== e.o[s]) ok = false;
          if (ok) { RET = countsToRel(e.m); return e.lo; }
        }
      }
      const q = Math.min(quickTricks(leader), tricksLeft);
      if (ns(leader)) { if (q >= need) { RET = qRel; return true; } }
      else if (tricksLeft - q < need) { RET = qRel; return false; }
      const res = playCard(leader, 0, -1, leader, need, tricksLeft, depth);
      const rel = RET;
      // store: lower bound NS >= need on success, upper bound NS <= need-1 on failure
      const m = relToCounts(rel, [0, 0, 0, 0]);
      computePrefixes();
      const e = { lo: res, v: res ? need : need - 1, m, o: [pref[0][m[0]], pref[1][m[1]], pref[2][m[2]], pref[3][m[3]]] };
      if (!list) { list = []; buckets.set(key, list); }
      list.push(e);
      if (list.length > 40) list.shift();
      RET = rel;
      return res;
    }
    function playCard(p, n, led, leader, need, tricksLeft, depth) {
      if (++nodes > stopAt) throw ABORT;
      const mv = moves(p, led, mvBuf[depth * 4 + n], n);
      const maxi = ns(p);
      // ordering
      if (mv.length > 1) {
        if (n === 0) {
          const pard = (p + 2) & 3, o1 = (p + 1) & 3, o2 = (p + 3) & 3;
          for (let i = 0; i < mv.length; i++) {
            const c = mv[i], su = c >> 4, r = c & 15;
            const them = h[o1][su] | h[o2][su];
            const topThem = them ? hiBit(them) : -1;
            const pd = h[pard][su];
            let sc = 0;
            const oppVoidRuff = trump < 4 && su !== trump && (h[o1][trump] | h[o2][trump]) && (!h[o1][su] || !h[o2][su]);
            if (r > topThem && !oppVoidRuff) sc += 100 + r;                  // cash a winner
            else if (pd && hiBit(pd) > topThem && !oppVoidRuff) sc += 70 - r;  // low toward partner's winner
            else {
              sc += 20 - r;                                     // otherwise lead low
              if (trump < 4 && su !== trump && !pd && h[pard][trump]) sc += 40; // partner can ruff
              if (su === trump && trump < 4) sc += 10;
              if (pc(h[p][su]) === 1 && trump < 4 && su !== trump && h[p][trump]) sc += 15; // singleton for a ruff
            }
            ordScore[i] = sc;
          }
          for (let i = 1; i < mv.length; i++) {
            const c = mv[i], sc = ordScore[i]; let j = i - 1;
            while (j >= 0 && ordScore[j] < sc) { mv[j + 1] = mv[j]; ordScore[j + 1] = ordScore[j]; j--; }
            mv[j + 1] = c; ordScore[j + 1] = sc;
          }
        } else {
          let wi = 0;
          for (let i = 1; i < n; i++) if (beats(trickCards[i], trickCards[wi])) wi = i;
          const win = trickCards[wi];
          const partnerWinning = ((leader + wi) & 3) === ((p + 2) & 3);
          const ledS = trickCards[0] >> 4;
          // is partner's winning card a sure winner (no higher card left behind)?
          let pSafe = false;
          if (partnerWinning) {
            if (n === 3) pSafe = true;
            else {
              pSafe = true;
              if (n === 2) {
                const q = (p + 1) & 3, ws = win >> 4;
                if (h[q][ledS]) { if (ws === ledS && (h[q][ledS] >> ((win & 15) + 1))) pSafe = false; }
                else if (trump < 4 && ws !== trump && h[q][trump]) pSafe = false;
              } else pSafe = false;
            }
          }
          const wS = win >> 4, wR = win & 15;
          for (let i = 0; i < mv.length; i++) {
            const c = mv[i], r = c & 15, su = c >> 4;
            const w = su === wS ? r > wR : (su === trump);
            let k;
            if (partnerWinning && pSafe) k = r + (su === trump ? 20 : 0);
            else if (w) k = (n === 1 ? 30 : 0) + r + (su === trump && ledS !== trump ? 10 : 0);
            else k = (n === 1 ? 0 : 40) + r + (su === trump ? 20 : 0);
            ordScore[i] = -k;
          }
          for (let i = 1; i < mv.length; i++) {
            const c = mv[i], sc = ordScore[i]; let j = i - 1;
            while (j >= 0 && ordScore[j] < sc) { mv[j + 1] = mv[j]; ordScore[j + 1] = ordScore[j]; j--; }
            mv[j + 1] = c; ordScore[j + 1] = sc;
          }
        }
      }
      let acc = NONE;
      for (const c of mv) {
        const s = c >> 4, r = c & 15;
        h[p][s] &= ~(1 << r);
        trickCards[n] = c;
        let ok, rel;
        if (n === 3) {
          let wi = 0;
          for (let i = 1; i < 4; i++) if (beats(trickCards[i], trickCards[wi])) wi = i;
          const winner = (leader + wi) & 3, wc = trickCards[wi], ws = wc >> 4;
          let same = 0; for (let i = 0; i < 4; i++) if ((trickCards[i] >> 4) === ws) same++;
          const s0 = trickCards[0], s1 = trickCards[1], s2 = trickCards[2], s3 = trickCards[3];
          ok = ns(winner) ? search(winner, need - 1, tricksLeft - 1, depth + 1) : search(winner, need, tricksLeft - 1, depth + 1);
          rel = RET;
          trickCards[0] = s0; trickCards[1] = s1; trickCards[2] = s2; trickCards[3] = s3;
          if (same >= 2) rel = setNib(rel, ws, Math.min(nib(rel, ws), wc & 15));
        } else {
          ok = playCard((p + 1) & 3, n + 1, n === 0 ? s : led, leader, need, tricksLeft, depth);
          rel = RET;
        }
        h[p][s] |= 1 << r;
        if (maxi === ok) { RET = fixRuns(rel, p, mv, n); return ok; }
        acc = minRel(acc, rel);
      }
      RET = fixRuns(acc, p, mv, n);
      return !maxi;
    }
    const ABORT = { abort: true };
    let stopAt = Infinity;
    function maxNS(leader, tricksLeft = 13, guess = 7) {
      let lo = 0, hi = tricksLeft, first = true, lastTrue = false;
      while (lo < hi) {
        const g = first ? Math.max(lo + 1, Math.min(hi, guess)) : (lastTrue ? lo + 1 : hi);
        first = false;
        if (search(leader, g, tricksLeft, 0)) { lo = g; lastTrue = true; } else { hi = g - 1; lastTrue = false; }
      }
      return lo;
    }
    return { maxNS, get nodes() { return nodes; } };
  }

  // One strain for all four declarers. Values are exact trick counts or {lo, hi} when the budget ran out.
  function strain(handsBySeat, st, onProgress, budget = Infinity) {
    const h = toMasks(handsBySeat);
    const sv = solver(h, STRAIN_IX[st]);
    const hp = cards => cards.reduce((t, c) => t + ({ A: 4, K: 3, Q: 2, J: 1 }[c[1]] || 0), 0);
    const nsH = hp(handsBySeat.N) + hp(handsBySeat.S);
    let est = 6.5 + (nsH - 20) / 3;
    if (st !== 'N') { const tl = [...handsBySeat.N, ...handsBySeat.S].filter(c => c[0] === st).length; est += (tl - 6.5) * 0.9; }
    let nsGuess = Math.max(0, Math.min(13, Math.round(est)));
    const out = {};
    for (const decl of ['N', 'E', 'S', 'W']) {
      const leader = (SEAT_IX[decl] + 1) & 3;
      const r = sv.maxNS(leader, 13, nsGuess, budget);
      const isNS = decl === 'N' || decl === 'S';
      let v;
      if (typeof r === 'number') { nsGuess = r; v = isNS ? r : 13 - r; }
      else { nsGuess = Math.round((r.lo + r.hi) / 2); v = isNS ? { lo: r.lo, hi: r.hi } : { lo: 13 - r.hi, hi: 13 - r.lo }; }
      out[decl] = v;
      if (onProgress) onProgress(decl, st, v);
    }
    return out;
  }
  function table(handsBySeat, onProgress, budget) {
    const out = { N: {}, E: {}, S: {}, W: {} };
    for (const st of ['N', 'S', 'H', 'D', 'C']) {
      const r = strain(handsBySeat, st, onProgress, budget);
      for (const d in r) out[d][st] = r[d];
    }
    return out;
  }

  // Best play analysis for a position mid-hand: tricks for declarer side for each legal card
  function cardValues(handsLeft, trick, strain, declarer, tricksSoFarDecl) {
    // handsLeft: {seat:[cards]}, trick: [{seat,card}] cards played in current trick (not removed from handsLeft)
    const h = toMasks(handsLeft);
    const T = STRAIN_IX[strain];
    const sv = solver(h, T);
    return sv; // reserved for future hint feature
  }

  return { table, strain, toMasks, solver };
})();

// Par: best contract(s) for both sides given a DD table and vulnerability.
function parScore(dd, vul) {
  // enumerate all contracts each side can make, and the sacrifice logic (simplified par):
  // the side with the highest makeable score bids it; the other side sacrifices if cheaper.
  const strains = ['C', 'D', 'H', 'S', 'N'];
  const best = side => {
    let top = { score: 0, c: null };
    for (const decl of side === 'NS' ? ['N', 'S'] : ['E', 'W']) for (const st of strains) {
      const t = dd[decl][st];
      for (let lvl = 1; lvl <= t - 6; lvl++) {
        const c = { level: lvl, strain: st, doubled: 0, declarer: decl };
        const sc = scoreContract(c, t, vul);
        if (sc > top.score || (sc === top.score && top.c && bidValue(lvl + st) > bidValue(top.c.level + top.c.strain))) top = { score: sc, c, tricks: t };
      }
    }
    return top;
  };
  const ns = best('NS'), ew = best('EW');
  let lead = ns.score >= ew.score ? ns : ew;
  const leadSide = lead === ns ? 'NS' : 'EW';
  if (!lead.c) return { scoreNS: 0, text: 'Passed out' };
  // can the other side sacrifice above the leading contract cheaper than conceding it?
  let bestSac = null;
  const opp = leadSide === 'NS' ? ['E', 'W'] : ['N', 'S'];
  const lv = bidValue(lead.c.level + lead.c.strain);
  for (const decl of opp) for (const st of strains) for (let lvl = 1; lvl <= 7; lvl++) {
    if (bidValue(lvl + st) <= lv) continue;
    const t = dd[decl][st];
    const c = { level: lvl, strain: st, doubled: t >= lvl + 6 ? 0 : 1, declarer: decl };
    const sc = scoreContract(c, t, vul);
    if (-sc < lead.score && (!bestSac || sc > bestSac.score)) bestSac = { score: sc, c, tricks: t };
    break; // only cheapest level in each strain matters
  }
  let res = lead;
  if (bestSac) {
    // check that the leading side can't then make a higher contract profitably — simplified: accept the sacrifice
    res = bestSac;
  }
  const sideNS = sideOf(res.c.declarer) === 'NS';
  const scoreNSv = sideNS ? res.score : -res.score;
  const diff = res.tricks - (res.c.level + 6);
  const txt = `${res.c.level}${SYM[res.c.strain]}${res.c.doubled ? 'X' : ''} by ${SEAT_NAME[res.c.declarer]}${diff === 0 ? '=' : diff > 0 ? '+' + diff : diff}`;
  return { scoreNS: scoreNSv, text: txt, contract: res.c };
}

if (typeof module !== 'undefined') module.exports = { DDS, parScore };
