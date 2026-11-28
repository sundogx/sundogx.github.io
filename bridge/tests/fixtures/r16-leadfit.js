// node fit.js train.jsonl[,..] test.jsonl[,..] variants...   (test may be 'cv' = odd g of train held out)
const R = process.env.R || '/Users/admin/Documents/sundogx.github.io/.claude/worktrees/r16-play16/bridge/js/';
Object.assign(globalThis, require(R + 'engine.js')); const B = require(R + 'bots.js'); globalThis.shown = B.shown;
const D = require(R + 'ddplay.js'); Object.assign(globalThis, D); const L = require(R + 'leads.js');
const fs = require('fs');
const load = fl => fl.split(',').flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)).filter(r => r.ct && r.actual);
let train = load(process.argv[2]), test;
if (process.argv[3] === 'cv') { test = train.filter(r => r.g % 2); train = train.filter(r => !(r.g % 2)); } else test = load(process.argv[3]);
const variants = process.argv.slice(4);
// precompute per record: cands, base features, context
function prep(r) {
  if (r._p) return r._p;
  const ctx = L.leadContext(r.hand, r.auction, r.ct, r.leader, r.vul);
  const cands = L.leadCards(r.hand, r.ct.strain);
  const xs = cands.map(c => L.leadFeatures(r.hand, c[0], r.auction, r.ct, r.leader, ctx));
  const def = c => -scoreContract(r.ct, 13 - r.actual[c], r.vul);
  const sc = cands.map(def), msc = sc.reduce((a, b) => a + b, 0) / sc.length;
  const tr = cands.map(c => r.actual[c]), mtr = tr.reduce((a, b) => a + b, 0) / tr.length;
  const lv = r.ct.level, kind = r.ct.strain === 'N' ? 'N' : 'S';
  const game = lv >= 6 ? 'slam' : (lv >= 3 && r.ct.strain === 'N') || (lv >= 4 && 'HS'.includes(r.ct.strain)) || lv >= 5 ? 'game' : 'part';
  const more = cands.map(c => moreF(r, c[0], ctx));
  return r._p = { more, cands, xs, imp: sc.map(s => toImps(Math.round(s - msc))), trd: tr.map(t => t - mtr), kind, game, dbl: !!r.ct.doubled, sc };
}
function moreF(r, s, ctx) {
  const cs = r.hand.filter(c => c[0] === s).sort((a, b) => rankOf(b) - rankOf(a)), rk = cs.map(rankOf), Lg = cs.length, has = x => cs.some(c => c[1] === x);
  const hon = cs.filter(c => 'AKQJ'.includes(c[1])).length, hcp = ctx.hcp, nt = r.ct.strain === 'N';
  return [
    Lg >= 4 && hon >= 1 && (has('T') || has('9')) ? 1 : 0, // length with intermediates
    has('A') && has('Q') && !has('K') ? 1 : 0, // AQ tenace
    has('K') && has('J') && !has('Q') && !has('A') ? 1 : 0, // KJ tenace
    Lg >= 4 && hon === 0 ? 1 : 0, // length without honour
    Lg >= 4 && hcp <= 6 ? 1 : 0, // length, weak hand
    Lg >= 4 && hcp >= 12 ? 1 : 0, // length, strong hand
    Lg >= 5 && hon >= 2 ? 1 : 0, // good long suit
    ctx.pLen[s] >= 4 && Lg <= 2 ? 1 : 0, // partner's suit, short
    ctx.oLen[s] >= 4 && Lg >= 4 ? 1 : 0, // their suit, we're long behind/before
    Lg === 3 && hon === 1 && rk[0] <= 10 ? 1 : 0, // Qxx/Jxx
  ];
}
// extended features: base + interactions
function feats(p, j, v) {
  const x = p.xs[j];
  if (v.ext === 'none') return x;
  const out = x.slice();
  if (v.ext.includes('more')) out.push(...p.more[j]);
  if (v.ext.includes('dbl')) for (const i of v.dblIdx) out.push(p.dbl ? x[i] : 0);
  if (v.ext.includes('slam')) for (const i of v.dblIdx) out.push(p.game === 'slam' ? x[i] : 0);
  if (v.ext.includes('part')) for (const i of v.dblIdx) out.push(p.game === 'part' ? x[i] : 0);
  return out;
}
function groupOf(p, v) { return v.split === 'kind' ? p.kind : v.split === 'kg' ? p.kind + p.game : p.kind; }
function fit(recs, v) {
  const W = {};
  const groups = {};
  for (const r of recs) { const p = prep(r); (groups[groupOf(p, v)] = groups[groupOf(p, v)] || []).push(p); }
  for (const g in groups) {
    const F = feats(groups[g][0], 0, v).length;
    const A = Array.from({ length: F }, () => Array(F + 1).fill(0));
    for (const p of groups[g]) {
      const xs = p.cands.map((c, j) => feats(p, j, v)), y = v.y === 'imp' ? p.imp : p.trd;
      const my = y.reduce((a, b) => a + b, 0) / y.length;
      const mx = Array(F).fill(0); xs.forEach(x => x.forEach((q, i) => mx[i] += q / xs.length));
      xs.forEach((x0, j) => { const x = x0.map((q, i) => q - mx[i]), yy = y[j] - my; for (let i = 0; i < F; i++) { A[i][F] += x[i] * yy; for (let m = 0; m < F; m++) A[i][m] += x[i] * x[m]; } });
    }
    for (let i = 0; i < F; i++) { A[i][i] += v.lambda; if (v.to0) A[i][F] += v.lambda * ((L.LEAD_W[g] || [])[i] || 0) * (v.to0 || 1); }
    for (let i = 0; i < F; i++) { let q = i; for (let k = i + 1; k < F; k++) if (Math.abs(A[k][i]) > Math.abs(A[q][i])) q = k; [A[i], A[q]] = [A[q], A[i]]; for (let k = 0; k < F; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let m = i; m <= F; m++) A[k][m] -= f * A[i][m]; } }
    W[g] = A.map((row, i) => row[F] / row[i]);
  }
  return W;
}
function pick(r, v, W) {
  const p = prep(r), w = v.nOnly && p.kind !== 'N' ? null : W[groupOf(p, v)] || W[p.kind];
  if (!w) return L.botLead(r.hand, r.auction, r.ct, r.leader, r.vul);
  let best = -1e9, bc = null;
  p.cands.forEach((c, j) => { const f = feats(p, j, v); let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * w[i]; if (s > best) { best = s; bc = c; } });
  return bc;
}
function evalRule(recs, rule, label) {
  const sl = {}; const add = (k, d, ch) => { const a = sl[k] || (sl[k] = { n: 0, s: 0, s2: 0, ch: 0 }); a.n++; a.s += d; a.s2 += d * d; if (ch) a.ch++; };
  for (const r of recs) {
    const p = prep(r), a = rule(r), b = L.botLead(r.hand, r.auction, r.ct, r.leader, r.vul);
    const d = toImps(Math.round(-scoreContract(r.ct, 13 - r.actual[a], r.vul) + scoreContract(r.ct, 13 - r.actual[b], r.vul)));
    add('all', d, a !== b); add(p.kind, d, a !== b); add(p.kind + p.game + (p.dbl ? 'X' : ''), d, a !== b);
  }
  const f = a => { const m = a.s / a.n, se = Math.sqrt(Math.max(0, a.s2 / a.n - m * m) / a.n); return `${m >= 0 ? '+' : ''}${m.toFixed(4)} ± ${se.toFixed(4)} (n ${a.n}, ch ${a.ch})`; };
  console.log(label.padEnd(28), 'all', f(sl.all), ' N', f(sl.N), ' S', f(sl.S));
  if (process.env.SLICES) for (const k of Object.keys(sl).sort()) if (k.length > 1) console.log('    ', k.padEnd(10), f(sl[k]));
}
console.log('train', train.length, 'test', test.length);
// oracle: best lead available among cands (upper bound)
evalRule(test, r => { const p = prep(r); let bi = 0; p.sc.forEach((s, i) => { if (s > p.sc[bi]) bi = i; }); return p.cands[bi]; }, 'oracle');
const ALL = [...Array(25).keys()];
const V = {
  w10: { ext: 'none', y: 'tr', lambda: 30, split: 'kind' },
  tr30: { ext: 'none', y: 'tr', lambda: 30, split: 'kind' },
  tr100: { ext: 'none', y: 'tr', lambda: 100, split: 'kind' },
  tr300: { ext: 'none', y: 'tr', lambda: 300, split: 'kind' },
  imp30: { ext: 'none', y: 'imp', lambda: 30, split: 'kind' },
  imp100: { ext: 'none', y: 'imp', lambda: 100, split: 'kind' },
  imp300: { ext: 'none', y: 'imp', lambda: 300, split: 'kind' },
  imp1000: { ext: 'none', y: 'imp', lambda: 1000, split: 'kind' },
  kgtr100: { ext: 'none', y: 'tr', lambda: 100, split: 'kg' },
  kgimp300: { ext: 'none', y: 'imp', lambda: 300, split: 'kg' },
  dbltr100: { ext: 'dbl', dblIdx: ALL, y: 'tr', lambda: 100, split: 'kind' },
  dblimp300: { ext: 'dbl', dblIdx: ALL, y: 'imp', lambda: 300, split: 'kind' },
  dslimp300: { ext: 'dbl,slam,part', dblIdx: ALL, y: 'imp', lambda: 300, split: 'kind' },
  NimpA: { ext: 'none', y: 'imp', lambda: 300, split: 'kind', nOnly: 1 },
  NmoreA: { ext: 'more', y: 'tr', lambda: 100, split: 'kind', nOnly: 1 },
  s0tr300: { ext: 'none', y: 'tr', lambda: 300, split: 'kind', to0: 1 },
  s0tr1000: { ext: 'none', y: 'tr', lambda: 1000, split: 'kind', to0: 1 },
  s0tr3000: { ext: 'none', y: 'tr', lambda: 3000, split: 'kind', to0: 1 },
  s0imp1000: { ext: 'none', y: 'imp', lambda: 1000, split: 'kind', to0: 4 },
  more100: { ext: 'more', y: 'tr', lambda: 100, split: 'kind' },
  moreimp300: { ext: 'more', y: 'imp', lambda: 300, split: 'kind' },
  moreimp100: { ext: 'more', y: 'imp', lambda: 100, split: 'kind' },
  dsltr100: { ext: 'dbl,slam,part', dblIdx: ALL, y: 'tr', lambda: 100, split: 'kind' },
};
for (const name of variants) { const v = V[name]; const W = fit(train, v); evalRule(test, r => pick(r, v, W), name); if (process.env.DUMP) console.log(JSON.stringify(Object.fromEntries(Object.entries(W).map(([k, w]) => [k, w.map(x => +x.toFixed(3))])))); }
