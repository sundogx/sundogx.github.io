const R = process.env.R || require('path').join(__dirname, '../../js/');
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
Object.assign(globalThis, require(R + 'ddplay.js')); const L = require(R + 'leads.js');
const fs = require('fs'); const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct && r.ct.doubled && r.ct.strain !== 'N');
const H = {}, P = {}; let n = 0, viol = 0, violHcp = 0;
for (const r of recs) {
  const x = [...r.auction].reverse().find(a => a.call === 'X'); if (!x || sameSide(x.by, r.ct.declarer)) continue;
  const h = r.hands[x.by], tl = h.filter(c => c[0] === r.ct.strain).length; H[tl] = (H[tl] || 0) + 1; n++;
  const k = ddAuctionLimits(r.auction, x.by, r.vul, true, false, DD_LIMX);
  const hcp = h.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0);
  if (tl < k.lenMin[r.ct.strain]) viol++; if (hcp < k.hcpMin || hcp > k.hcpMax) violHcp++;
  P[k.lenMin[r.ct.strain]] = (P[k.lenMin[r.ct.strain]] || 0) + 1;
}
console.log('doubled suit contracts, defender doubled:', n, 'trump len hist', H, 'lenMin hist', P, 'trump viol', viol, 'hcp viol', violHcp);
