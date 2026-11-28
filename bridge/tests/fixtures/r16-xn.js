const R = process.env.R || require('path').join(__dirname, '../../js/');
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
Object.assign(globalThis, require(R + 'ddplay.js'));
const fs = require('fs'); const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct && r.ct.doubled);
for (const nt of [true, false]) {
const H = {}, M = {}; let n = 0, v = 0;
for (const r of recs) {
  if ((r.ct.strain === 'N') !== nt) continue;
  const x = [...r.auction].reverse().find(a => a.call === 'X'); if (!x || sameSide(x.by, r.ct.declarer)) continue;
  const h = r.hands[x.by], hcp = h.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0);
  const k = ddAuctionLimits(r.auction, x.by, r.vul, true, false, DD_LIMX);
  const b = Math.floor(hcp / 3) * 3; H[b] = (H[b] || 0) + 1; M[k.hcpMin] = (M[k.hcpMin] || 0) + 1; n++; if (hcp < k.hcpMin) v++;
}
console.log(nt ? 'NT' : 'suit', n, 'hcp (by 3s)', JSON.stringify(H), 'hcpMin', JSON.stringify(M), 'below min', v);
}
