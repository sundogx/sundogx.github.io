// ===== Par score from a double-dummy table =====
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

if (typeof module !== 'undefined') module.exports = { parScore };
