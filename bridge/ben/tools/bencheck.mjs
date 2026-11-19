// Checks the BEN port against the recorded vectors (tests/vectors): exact input encodings and candidate lists,
// and how often the final decision matches BEN's (sampling differs: BEN's RNG isn't reproduced).
// Usage: node bridge/ben/tools/bencheck.mjs [bid|lead|play] [maxDecisions]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, D, B, pbnHand, vcall, vdv, dense } from './benenv.mjs';
const vecDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'vectors');
const deals = readdirSync(vecDir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(path.join(vecDir, f), 'utf8')));
const kind = process.argv[2] || 'bid', max = +process.argv[3] || 1e9;
const { nn, dd, inst } = await setup();
const solve = async job => D.ddRun(inst, job);
const r = { n: 0, enc: 0, encBad: 0, cand: 0, candBad: 0, same: 0, ms: 0 };
const close = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 2e-3);
for (const d of deals.filter(d => !process.env.DEAL || process.env.DEAL.split(',').includes(String(d.board)))) {
  const { dealer, vul } = vdv(d.dealer_vul);
  for (const dec of d.decisions) {
    if (kind !== 'bid' || dec.kind !== kind || r.n >= max) continue;
    r.n++;
    const seat = 'NESW'[dec.seat], hand = pbnHand(dec.hand), auction = dec.auction.filter(c => c !== 'PAD_START').map(vcall);
    if (kind === 'bid') {
      const auc = B.padded(auction, dealer), hix = dec.seat, v = B.vulArr(vul);
      const T = B.stepsFor(auc, hix), X = new Float32Array(T * B.F);
      B.aucBinary(X, 0, T, auc, hix, B.h24(hand), v);
      if (dec.nn.length) {
        const ref = dense(dec.nn[0].inputs.x[0]);
        r.enc++; if (!close(Array.from(X), Array.from(ref))) { r.encBad++; if (r.encBad < 4) console.log('enc mismatch', d.board, dec.auction.join(' '), X.length, ref.length); }
      }
      const { cs } = await B.candidates(nn, auc, hix, B.h24(hand), v);
      const want = dec.candidates.map(c => vcall(c.call)).sort().join(','), got = cs.map(c => c.call).sort().join(',');
      r.cand++; if (dec.candidates.length > 1) r.multi = (r.multi || 0) + 1; if (want !== got) { r.candBad++; console.log('cand', d.board, dec.auction.join(' '), 'BEN', want, 'JS', got); }
      const t = performance.now();
      const res = await B.bid(nn, dd, { hand, seat, dealer, auction, vul }, { need: 50 });
      r.ms += performance.now() - t;
      if (res.call === vcall(dec.result)) r.same++;
      else console.log('diff', d.board, dec.auction.join(' ') || '-', 'BEN', dec.result, 'JS', res.call, JSON.stringify(res.info.candidates.map(c => [c.call, +c.insta.toFixed(3), c.imp, c.adjust && +c.adjust.toFixed(2)])), 'BEN', JSON.stringify(dec.candidates.map(c => [c.call, c.insta_score, c.expected_score])), res.info.samples, 'BENs', dec.samples, res.info.quality && res.info.quality.toFixed(2));
    }
  }
}

// lead / play: build the app-side request from the deal and the play so far
function ctOf(d) {
  const m = d.contract.match(/^(\d)([CDHSN])(X{0,2})([NESW])$/);
  return { level: +m[1], strain: m[2], doubled: m[3].length, declarer: m[4] };
}
function viewOf(d, dec, ct, dealer, vul) {
  const hands = Object.fromEntries(d.deal.split(' ').map((h, i) => ['NESW'[i], pbnHand(h)]));
  const di = 'NESW'.indexOf(ct.declarer), abs = i => 'NESW'[(di + i + 1) % 4];
  const n = dec.trick_i * 4 + dec.current_trick52.length, tricks = [];
  let leader = abs(0), seq = [];
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { seq = []; tricks.push({ leader, cards: seq }); }
    const seat = 'NESW'[(('NESW'.indexOf(leader)) + i % 4) % 4];
    seq.push({ seat, card: d.play[i] });
    if (i % 4 === 3) leader = abs(d.trick_winners[i >> 2]);
  }
  if (n % 4 === 0) tricks.push({ leader, cards: [] });
  const played = new Set(d.play.slice(0, n)), left = s => hands[s].filter(c => !played.has(c));
  const seat = abs(dec.player_i), dummy = abs(1), decl = abs(3);
  const known = { [seat]: left(seat) };
  known[dummy] = left(dummy);
  if (dec.player_i === 1) known[decl] = left(decl);
  const auction = d.auction.filter(c => c !== 'PAD_START').map((c, i) => ({ call: vcall(c), by: 'NESW'[('NESW'.indexOf(dealer) + i) % 4] }));
  const limits = {}; for (const s of 'NESW') if (!known[s]) limits[s] = D.ddAuctionLimits(auction, s, vul, true);
  return { seat, vul, contract: ct, tricks, auction, known, limits };
}
const spy = (log) => ({ stats: nn.stats, async run(name, feeds) { log.push({ name, feeds }); return nn.run(name, feeds); } });
const rowEq = (feed, ref) => { const n = ref.shape.reduce((a, b) => a * b, 1); const a = Array.from(feed.data.subarray(0, n)); return close(a, Array.from(dense(ref))); };
if (kind !== 'bid') {
  const q = { n: 0, enc: 0, encBad: 0, same: 0, fixed: 0, fixedSame: 0, ms: 0 };
  for (const d of deals.filter(d => !process.env.DEAL || process.env.DEAL.split(',').includes(String(d.board)))) {
    const { dealer, vul } = vdv(d.dealer_vul); const ct = ctOf(d);
    for (const dec of d.decisions) {
      if (dec.kind !== kind || q.n >= max) continue;
      q.n++;
      const log = [], t = performance.now();
      let res;
      if (kind === 'lead') res = await B.lead(spy(log), dd, { hand: pbnHand(dec.hand), seat: 'NESW'[dec.seat], dealer, auction: d.auction.filter(c => c !== 'PAD_START').map(vcall), vul, contract: ct }, { ms: 1500, budget: 3600 });
      else {
        const view = viewOf(d, dec, ct, dealer, vul);
        const vv = process.env.PLIM === 'none' ? { ...view, limits: {} } : process.env.PLIM === 'min' ? { ...view, limits: Object.fromEntries(Object.keys(view.limits).map(s => [s, D.ddAuctionLimits(view.auction, s, vul, false)])) } : view;
        res = await B.play(spy(log), solve, vv, { ms: 2400, pool: +process.env.POOL || undefined, k: +process.env.K || undefined, maxPool: process.env.MAXPOOL ? +process.env.MAXPOOL : undefined });
        { // the double-dummy result on the real layout
          const hands = Object.fromEntries(d.deal.split(' ').map((h, i) => ['NESW'[i], pbnHand(h)]));
          const gone = new Set(view.tricks.flatMap(t => t.cards.map(c => c.card)));
          for (const s of 'NESW') hands[s] = hands[s].filter(c => !gone.has(c));
          const tr = await solve(D.ddJob(view, hands));
          if (res.info.candidates) res.info.candidates.forEach(c => { c.score = c.score + '/' + c.tricks + '/dd' + tr[c.card]; });
          const best = Math.max(...Object.values(tr));
          q.loss = (q.loss || 0) + best - tr[res.card]; q.benLoss = (q.benLoss || 0) + best - tr[dec.result];
        }
      }
      q.ms += performance.now() - t;
      const own = dec.nn.filter(e => e.batch === 1 && e.model !== 'binfo' && e.model !== 'bidder');
      if (own.length) {
        const ref = own[own.length - 1], mine = log.filter(e => e.name === ref.model && e.feeds.x.dims[0] === 1);
        q.enc++;
        const ok = mine.some(e => Object.keys(ref.inputs).every(k => rowEq(e.feeds[k], ref.inputs[k][0])));
        if (!ok) { q.encBad++; if (q.encBad < 6) console.log('enc', d.board, kind, dec.player_i, dec.trick_i, ref.model, 'mine', mine.map(e => e.name + e.feeds.x.dims.join('x')).join(' ')); }
      }
      if (!dec.samples) { q.fixed++; if (res.card === dec.result) q.fixedSame++; }
      if (res.card === dec.result) q.same++;
      else if (process.env.V) console.log('diff', d.board, dec.trick_i, dec.player_i, 'n', res.info && res.info.samples, 'BEN', dec.result, 'JS', res.card, res.info && res.info.why || '', JSON.stringify((res.info.candidates || []).slice(0, 4).map(c => [c.card || c.slot, c.score, c.insta && +c.insta.toFixed(3)])), JSON.stringify(dec.candidates.slice(0, 4).map(c => [c.card, c.insta_score, c.expected_score_imp])));
    }
  }
  console.log(JSON.stringify(q));
}
console.log(JSON.stringify(r), 'nn', JSON.stringify(nn.stats));
