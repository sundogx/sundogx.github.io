// node ver.js file.jsonl [play=0|1]: new botLead vs BOT_OFF lwb, DD IMPs; with play=1 also played out by botPlay (server mode)
const R = process.env.R || require('path').join(__dirname, '../../js/');
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
Object.assign(globalThis, require(R + 'ddplay.js')); const L = require(R + 'leads.js');
const fs = require('fs'); const recs = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.ct);
const play = +process.argv[3] || 0, part = process.argv[4] ? process.argv[4].split('/').map(Number) : [0, 1];
const offDef = ['trlead', 'holdup'];
let n = 0, s = 0, s2 = 0, ch = 0, p = 0, p2 = 0, ms = 0;
function playOut(r, card) {
  const t = { hands: r.hands, auction: r.auction, contract: r.ct, vul: r.vul, play: { tricks: [] }, phase: 'play' };
  applyPlay(t.play, r.ct, r.leader, card);
  for (let i = 1; i < 52; i++) { const se = playTurn(t.play, r.ct); applyPlay(t.play, r.ct, se, B.botPlay(t, se)); }
  return tricksWon(t.play, r.ct).decl;
}
for (const r of recs) {
  if (r.g % part[1] !== part[0]) continue;
  globalThis.BOT_OFF = offDef; const t0 = Date.now(); const a = L.botLead(r.hand, r.auction, r.ct, r.leader, r.vul); ms += Date.now() - t0;
  globalThis.BOT_OFF = offDef.concat(['lwb']); const b = L.botLead(r.hand, r.auction, r.ct, r.leader, r.vul);
  globalThis.BOT_OFF = offDef;
  const d = toImps(Math.round(-scoreContract(r.ct, 13 - r.actual[a], r.vul) + scoreContract(r.ct, 13 - r.actual[b], r.vul)));
  n++; s += d; s2 += d * d;
  if (a !== b) { ch++; if (play) { const q = toImps(scoreContract(r.ct, playOut(r, b), r.vul) - scoreContract(r.ct, playOut(r, a), r.vul)); p += q; p2 += q * q; } }
}
const f = (s, s2) => { const m = s / n; return `${m.toFixed(4)} ± ${Math.sqrt(Math.max(0, s2 / n - m * m) / n).toFixed(4)}`; };
console.log(JSON.stringify({ n, ch, s, s2, p, p2 }));
console.log(`boards ${n} changed ${ch}  DD IMPs ${f(s, s2)}  played out ${f(p, p2)}  botLead ms ${(ms / n).toFixed(3)}`);
