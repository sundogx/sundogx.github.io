const R = process.env.R || require('path').join(__dirname, '../../js/');
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
const fs = require('fs'); const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct && r.ct.doubled);
let n = 0, weak = 0; const ex = [];
for (const r of recs) {
  const x = [...r.auction].reverse().find(a => a.call === 'X'); if (!x || sameSide(x.by, r.ct.declarer)) continue;
  const h = r.hands[x.by], hcp = h.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0);
  n++; if (hcp <= 5) { weak++; if (ex.length < 8) { const i = r.auction.indexOf(x); const dealer = r.auction[0].by; const res = B.botCall(h, x.by, dealer, r.auction.slice(0, i), r.vul); ex.push(r.auction.map(a => a.call).join(' ') + ' | ' + x.by + ' hcp ' + hcp + ' ' + JSON.stringify(res).slice(0, 200)); } }
}
console.log(n, 'weak (<=5 hcp) doublers', weak); ex.forEach(e => console.log(e));
