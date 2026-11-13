// ===== Par score from a double-dummy table =====
// Par: the contract both sides reach if each bids whenever bidding on beats letting the other side's
// contract stand (making a higher contract, or sacrificing doubled). Repeats until neither side gains.
function parScore(dd, vul) {
  const strains = ['C', 'D', 'H', 'S', 'N'];
  const declarers = side => side === 'NS' ? ['N', 'S'] : ['E', 'W'];
  // best result for `side` playing level+strain (its better declarer; doubled when it goes down)
  const play = (side, level, st) => {
    let best = null;
    for (const decl of declarers(side)) {
      const t = dd[decl][st];
      const c = { level, strain: st, doubled: t >= level + 6 ? 0 : 1, declarer: decl };
      const score = scoreContract(c, t, vul);
      if (!best || score > best.score) best = { score, c, tricks: t, side };
    }
    return best;
  };
  // the best contract for `side` above bid value `above` (or anything, if null)
  const bestAbove = (side, above) => {
    let best = null;
    for (let level = 1; level <= 7; level++) for (const st of strains) {
      if (above !== null && bidValue(level + st) <= above) continue;
      const r = play(side, level, st);
      if (!best || r.score > best.score) best = r; // ties keep the cheaper contract
    }
    return best;
  };
  const first = ['NS', 'EW'].map(side => bestAbove(side, null)).sort((a, b) => b.score - a.score)[0];
  if (!first || first.score <= 0) return { scoreNS: 0, text: 'Passed out' };
  let cur = first;
  for (let guard = 0; guard < 40; guard++) {
    const other = cur.side === 'NS' ? 'EW' : 'NS';
    const r = bestAbove(other, bidValue(cur.c.level + cur.c.strain));
    if (!r || r.score <= -cur.score) break; // bidding on doesn't beat conceding the current contract
    cur = r;
  }
  const scoreNS = cur.side === 'NS' ? cur.score : -cur.score;
  const diff = cur.tricks - (cur.c.level + 6);
  const text = `${cur.c.level}${SYM[cur.c.strain]}${cur.c.doubled ? 'X' : ''} by ${SEAT_NAME[cur.c.declarer]}${diff === 0 ? '=' : diff > 0 ? '+' + diff : diff}`;
  return { scoreNS, text, contract: cur.c };
}

if (typeof module !== 'undefined') module.exports = { parScore };
