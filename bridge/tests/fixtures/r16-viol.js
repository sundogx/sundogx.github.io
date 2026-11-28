// limit violations of ddAuctionLimits (play sampler, DD_LIMX) by the real hands, by the seat's calls
const R = '/Users/admin/Documents/sundogx.github.io/.claude/worktrees/r16-play16/bridge/js/';
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
Object.assign(globalThis, require(R + 'ddplay.js'));
const fs = require('fs'); const recs = process.argv.slice(2).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct);
const st = {}; let seats = 0, bad = 0;
for (const r of recs) for (const s of SEATS) {
  const k = ddAuctionLimits(r.auction, s, r.vul, true, false, DD_LIMX), h = r.hands[s];
  const hcp = h.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0), len = x => h.filter(c => c[0] === x).length;
  const why = []; if (hcp < k.hcpMin) why.push('hcpLo'); if (hcp > k.hcpMax) why.push('hcpHi');
  for (const x of SUITS) { if (len(x) < k.lenMin[x]) why.push('lenLo'); if (len(x) > k.lenMax[x]) why.push('lenHi'); }
  seats++; if (!why.length) continue; bad++;
  const mine = r.auction.map((a, i) => ({ a, i })).filter(o => o.a.by === s && o.a.call !== 'P');
  // describe: the seat's calls with the calls before each (compact)
  const desc = mine.length ? mine.map(o => o.a.call).join('-') : 'passes';
  const ctx = r.auction.filter(a => a.call !== 'P').slice(0, 3).map(a => (sameSide(a.by, s) ? (a.by === s ? 'me' : 'pd') : 'op') + a.call).join(' ');
  for (const w of new Set(why)) { const key = w + ' | ' + desc + ' | ' + ctx; st[key] = (st[key] || 0) + 1; }
}
console.log('seats', seats, 'violated', bad, (100 * bad / seats).toFixed(1) + '%');
Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(x => console.log(x[1], x[0]));
