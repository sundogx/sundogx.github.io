const R = '/Users/admin/Documents/sundogx.github.io/.claude/worktrees/r16-play16/bridge/js/';
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown; const L = require(R + 'leads.js');
const fs = require('fs'); const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct && r.ct.doubled === 1);
const st = {}; let tot = 0, N = 0;
for (const r of recs) {
  const x = [...r.auction].reverse().find(a => a.call === 'X'); if (!x || sameSide(x.by, r.ct.declarer)) continue;
  const h = r.hands[x.by], hcp = h.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0);
  const lead = L.botLead(r.hand, r.auction, r.ct, r.leader, r.vul), dt = 13 - r.actual[lead];
  const und = { ...r.ct, doubled: 0 };
  const imp = toImps(scoreContract(und, dt, r.vul) - scoreContract(r.ct, dt, r.vul)); // defenders' gain from doubling (decl-perspective scores)
  const k = (r.ct.strain === 'N' ? 'N' : 'S') + ' hcp' + (hcp <= 5 ? '0-5' : hcp <= 8 ? '6-8' : hcp <= 11 ? '9-11' : '12+');
  const a = st[k] || (st[k] = { n: 0, s: 0, made: 0 }); a.n++; a.s += imp; if (dt >= r.ct.level + 6) a.made++;
}
for (const k of Object.keys(st).sort()) { const a = st[k]; console.log(k.padEnd(12), 'n', a.n, 'IMPs gained by the X per board', (a.s / a.n).toFixed(2), 'made', (a.made / a.n * 100).toFixed(0) + '%', 'total', a.s); }
