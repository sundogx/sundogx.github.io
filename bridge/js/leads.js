// ===== Robot opening leads =====
// One decision per board, made with the least information, so it gets its own code:
//  - leadCardOf: the conventional card in a suit (top of a sequence, interior sequences, ace against suits,
//    fourth best from an honour, top of a doubleton, middle from three small).
//  - leadPrior: how good leading each suit tends to be, from the leader's holding and the auction. A linear
//    score on lead "features" (sequences, length, partner's and the opponents' suits, unsupported honours,
//    singletons, trumps…), fitted to double-dummy results of thousands of robot auctions, the way Bird and
//    Anthias's "Winning Notrump Leads" / "Winning Suit Contract Leads" rate leads by simulation.
//  - botLead: the heuristic robot's lead, the suit with the best prior.
//  - leadChoose: the double-dummy robot's lead. Deals the unseen cards many times, consistent with the
//    auction (leadLimits: shown() ranges and lengths, both the minimum and the maximum), solves each layout,
//    and leads the suit whose conventional card has the best average IMP result against the other leads,
//    plus the prior. The prior steadies the choice when only ~20 layouts fit in the time budget.
// Pure functions over plain data, no DOM: used by js/bots.js, js/ddplay.js (in the page's worker) and tests.
if (typeof require !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('./engine.js'));


// ---- The card in a suit ----
// cards: the leader's cards in one suit. strain: the contract's strain.
function leadCardOf(cards, strain) {
  const h = cards.slice().sort((a, b) => rankOf(b) - rankOf(a));
  if (h.length <= 2) return h[0];
  const r = h.map(rankOf), nt = strain === 'N';
  if (r[0] >= 8 && r[0] - r[1] === 1) { // top two touching (AK, KQ, QJ, JT, T9)
    if (h.length < 4 || !nt) return h[0];
    if (r[1] - r[2] <= 2) return h[0]; // KQJ, KQT: top of a (near) sequence; KQxx vs NT: fourth best
    if (r[0] === 12) return h[0]; // AKxx
  }
  if (r[1] >= 7 && r[1] - r[2] === 1 && r[0] - r[1] >= 2 && (nt || r[0] !== 12)) return h[1]; // interior: KJT, QT9, AJT (NT)
  if (!nt && h[0][1] === 'A') return h[0]; // no underleading aces against a suit
  if (h.length === 3) return r[0] >= 8 ? h[2] : h[1]; // low from an honour, middle from three small
  return r[0] >= 8 ? h[3] : h[1]; // fourth best from an honour, second highest from four small (MUD-ish)
}
function leadCards(hand, strain) { return SUITS.filter(s => hand.some(c => c[0] === s)).map(s => leadCardOf(hand.filter(c => c[0] === s), strain)); }

// ---- What the auction showed, tightened for the lead ----
function leadShown(auction, seat, vul) {
  try { if (typeof shown === 'function') return shown(auction, seat, vul); } catch (e) { }
  return null;
}
function leadLimits(auction, seat, vul) {
  const k = leadDD().ddAuctionLimits(auction, seat, vul);
  const info = leadShown(auction, seat, vul);
  if (info) {
    if (info.ptsMax < 37) k.hcpMax = Math.min(k.hcpMax, info.ptsMax + (info.nt ? 0 : 1));
    if (info.maxLen) for (const s of SUITS) if (info.maxLen[s] < 13) k.lenMax[s] = Math.min(k.lenMax[s], info.maxLen[s]);
  }
  // 1NT-3NT / 2NT-3NT: responder went straight to game without Stayman or a transfer
  const mine = auction.filter(a => a.by === seat && a.call !== 'P');
  if (mine.length === 1 && mine[0].call === '3N') {
    const i = auction.indexOf(mine[0]), p = auction.slice(0, i).filter(a => a.call !== 'P');
    if (p.length === 1 && sameSide(p[0].by, seat) && /^[12]N$/.test(p[0].call)) { k.lenMax.S = Math.min(k.lenMax.S, 4); k.lenMax.H = Math.min(k.lenMax.H, 4); }
  }
  if (k.hcpMax < k.hcpMin) k.hcpMax = k.hcpMin;
  for (const s of SUITS) if (k.lenMax[s] < k.lenMin[s]) k.lenMax[s] = k.lenMin[s];
  return k;
}

// ---- The prior: features of leading each suit ----
const LEAD_FEATURES = ['len4', 'len5', 'single', 'dbl', 'xxx', 'seq3', 'seq2', 'AK', 'inter', 'Kunsup', 'Aunsup', 'Qunsup', 'honDbl', 'singHon',
  'pSuit', 'pSuitA', 'oSuit', 'oSuit5', 'unbid', 'major', 'trump', 'trumpDummyPref', 'trumpPenPass', 'singleTrumpCtl', 'hcpOther'];
// Feature vector for leading suit s. hand: the leader's 13 cards; seat: the leader.
function leadFeatures(hand, s, auction, contract, seat, ctx) {
  ctx = ctx || leadContext(hand, auction, contract, seat);
  const cs = hand.filter(c => c[0] === s).sort((a, b) => rankOf(b) - rankOf(a)), r = cs.map(rankOf), L = cs.length;
  const has = x => cs.some(c => c[1] === x), trump = contract.strain === 'N' ? null : contract.strain;
  const f = {};
  f.len4 = L >= 4 ? 1 : 0; f.len5 = Math.max(0, L - 4);
  f.single = L === 1 && s !== trump ? 1 : 0;
  f.dbl = L === 2 && r[0] < 9 ? 1 : 0; // two small
  f.xxx = L >= 3 && r[0] < 8 ? 1 : 0; // no honour (ten or better)
  f.seq3 = L >= 3 && r[0] >= 9 && r[0] - r[1] === 1 && r[1] - r[2] === 1 ? 1 : 0;
  f.seq2 = !f.seq3 && L >= 2 && r[0] >= 9 && r[0] - r[1] === 1 && r[0] < 12 ? 1 : 0; // KQ, QJ (not AK)
  f.AK = has('A') && has('K') ? 1 : 0;
  f.inter = L >= 3 && r[1] >= 7 && r[1] - r[2] === 1 && r[0] - r[1] >= 2 && r[0] >= 9 ? 1 : 0;
  f.Kunsup = has('K') && !has('A') && !has('Q') && L >= 2 ? 1 : 0;
  f.Aunsup = has('A') && !has('K') ? 1 : 0;
  f.Qunsup = has('Q') && !has('K') && !has('J') && L >= 2 ? 1 : 0;
  f.honDbl = L === 2 && r[0] >= 9 && !(r[0] - r[1] === 1) && r[0] !== 12 ? 1 : 0; // Kx, Qx, Jx
  f.singHon = L === 1 && r[0] >= 9 ? 1 : 0;
  f.pSuit = ctx.pLen[s] >= 4 ? 1 : 0;
  f.pSuitA = f.pSuit && has('A') ? 1 : 0;
  f.oSuit = ctx.oLen[s] >= 4 ? 1 : 0;
  f.oSuit5 = ctx.oLen[s] >= 5 ? 1 : 0;
  f.unbid = !ctx.bidSuits.has(s) ? 1 : 0;
  f.major = s === 'S' || s === 'H' ? 1 : 0;
  f.trump = s === trump ? 1 : 0;
  f.trumpDummyPref = f.trump && ctx.dummyPref ? 1 : 0;
  f.trumpPenPass = f.trump && ctx.penPass ? 1 : 0;
  f.singleTrumpCtl = f.single && ctx.trumpCtl ? 1 : 0;
  f.hcpOther = (ctx.hcp - leadHcp(cs)) / 10; // outside entries
  return LEAD_FEATURES.map(n => f[n] || 0);
}
function leadHcp(cs) { return cs.reduce((a, c) => a + Math.max(0, rankOf(c) - 8), 0); }
function leadContext(hand, auction, contract, seat) {
  const decl = contract.declarer, dummy = partnerOf(decl), partner = partnerOf(seat);
  const pInfo = leadShown(auction, partner), dInfo = leadShown(auction, decl), mInfo = leadShown(auction, dummy);
  const pLen = {}, oLen = {}, bidSuits = new Set();
  for (const s of SUITS) {
    pLen[s] = pInfo && pInfo.len ? pInfo.len[s] || 0 : 0;
    oLen[s] = Math.max(dInfo && dInfo.len ? dInfo.len[s] || 0 : 0, mInfo && mInfo.len ? mInfo.len[s] || 0 : 0);
  }
  for (const a of auction) if (/^[1-7][CDHS]$/.test(a.call)) bidSuits.add(a.call[1]);
  // natural suit bids by partner that shown() didn't record as length (e.g. overcalls read loosely)
  for (const a of auction) if (a.by === partner && /^[1-7][CDHS]$/.test(a.call) && pLen[a.call[1]] < 4) pLen[a.call[1]] = Math.max(pLen[a.call[1]], 3);
  const trump = contract.strain === 'N' ? null : contract.strain;
  // dummy only gave preference / raised to a part score with a short side suit likely: their side bid two suits and
  // dummy's last bid was trumps at a low level
  const theirSuits = new Set(auction.filter(a => sameSide(a.by, decl) && /^[1-7][CDHS]$/.test(a.call)).map(a => a.call[1]));
  const dBids = auction.filter(a => a.by === dummy && a.call !== 'P');
  const dummyPref = !!trump && theirSuits.size >= 2 && dBids.length > 0 && dBids[dBids.length - 1].call[1] === trump && +dBids[dBids.length - 1].call[0] <= 3;
  // partner passed our takeout double, or doubled a low contract: penalty
  const penPass = !!trump && contract.doubled && contract.level <= 2;
  const myTr = trump ? hand.filter(c => c[0] === trump) : [];
  const trumpCtl = !!trump && myTr.length >= 1 && myTr.length <= 3 && myTr.some(c => c[1] === 'A' || (c[1] === 'K' && myTr.length >= 2));
  return { pLen, oLen, bidSuits, dummyPref, penPass, trumpCtl, hcp: leadHcp(hand) };
}

// Weights (tricks per feature, against the average lead from the same hand), fitted by ridge regression on the
// double-dummy result of every lead on 1,500 robot auctions (node tests/leadsim.js fit). LEAD_W.N for notrump, .S for suits.
// Read as Bird and Anthias would: sequences, AK and partner's suit are good leads; unsupported kings and queens and the
// opponents' suits are bad ones; against suits short suits (singletons, doubletons) are good and a trump lead slightly bad;
// against notrump length and the majors help.
const LEAD_W = {
  N: [0.06, 0.01, -0.01, 0.09, -0.01, 0.18, 0.01, 0.13, 0, -0.09, -0.03, -0.14, -0.03, -0.02, 0.16, 0.01, -0.11, 0, 0.07, 0.07, 0, 0, 0, 0, -0.01],
  S: [-0.01, 0.04, 0.1, 0.09, -0.06, 0.12, 0.02, 0.12, 0.01, -0.17, -0.03, -0.08, -0.03, 0.04, 0.13, -0.05, -0.07, -0.03, 0.02, -0.01, -0.05, 0, 0.04, 0.07, 0],
};
// Prior per suit in tricks (higher is a better lead). Returns { suit: value } for the suits the leader holds.
function leadPrior(hand, auction, contract, seat, W) {
  W = W || LEAD_W[contract.strain === 'N' ? 'N' : 'S'];
  const ctx = leadContext(hand, auction, contract, seat), out = {};
  for (const s of SUITS) {
    if (!hand.some(c => c[0] === s)) continue;
    const f = leadFeatures(hand, s, auction, contract, seat, ctx);
    let v = 0; for (let i = 0; i < f.length; i++) v += f[i] * (W[i] || 0);
    out[s] = v;
  }
  return out;
}
// The heuristic robot's opening lead.
function botLead(hand, auction, contract, seat) {
  const p = leadPrior(hand, auction, contract, seat);
  let best = null;
  for (const s in p) if (best === null || p[s] > p[best]) best = s;
  return leadCardOf(hand.filter(c => c[0] === best), contract.strain);
}

// ---- The double-dummy lead ----
// results: one {card: defenders' tricks} per sampled layout; cands: candidate cards. Returns {card: average value} for
// the defenders: tricks, or IMPs / points against the average candidate on the same layout.
function leadValues(view, cands, results, metric = LEAD_METRIC) {
  const c = view.contract, val = {};
  for (const x of cands) val[x] = 0;
  let n = 0;
  for (const r of results) {
    if (!cands.every(x => x in r)) continue;
    const sc = cands.map(x => -scoreContract(c, 13 - r[x], view.vul));
    const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
    cands.forEach((x, i) => { val[x] += metric === 'score' ? (sc[i] - mean) / 100 : metric === 'tricks' ? r[x] : toImps(Math.round(sc[i] - mean)); });
    n++;
  }
  if (n) for (const x of cands) val[x] /= n;
  return { val, n };
}
// Adds what the lead needs to a robot's view (js/ddplay.js ddView calls it before the opening lead): the
// auction limits for the sampler, and the prior. Done where the view is made, where js/bidding.js is loaded.
function leadView(view, t) {
  const auction = t.auction || [];
  for (const s of SEATS) if (!view.known[s]) view.limits[s] = leadLimits(auction, s, t.vul);
  view.prior = leadPrior(view.known[view.seat], auction, t.contract, view.seat);
  return view;
}
// view: ddView (with leadView). solve(job) -> Promise<{card: tricks}>. Returns { card, stats, samples, ms } or null.
// opts: k (layouts), minK, ms (time budget), rand, w (weight of the prior).
async function leadChoose(view, solve, opts = {}) {
  const cands = leadCards(view.known[view.seat], view.contract.strain);
  if (cands.length < 2) return null;
  const t0 = leadNow(), results = await leadSample(view, solve, opts);
  if (results.length < Math.min(opts.k || 24, opts.minK || 6)) return null;
  return { ...leadPick(view, cands, results, opts), samples: results.length, ms: leadNow() - t0 };
}
// The solver's results ({card: defenders' tricks}) on up to opts.k layouts, as many as fit in opts.ms: it stops
// before a solve that would probably end past the budget (elapsed + the average solve so far), once it has opts.minK.
// opts.onResult(r) is called after each solve (the page's workers stream their results, js/dds-worker.js).
// The page runs this in several workers at once and pools the results (js/analysis.js robotDDLead).
async function leadSample(view, solve, opts = {}) {
  const t0 = leadNow(), k = opts.k || 24, minK = Math.min(k, opts.minK || 6), budget = opts.ms || Infinity;
  const results = [];
  const D = leadDD();
  let solving = 0;
  for (const h of D.ddSample(view, k, opts.rand || Math.random, 0, null, opts)) {
    const t = leadNow();
    if (results.length >= minK && t - t0 + (results.length ? solving / results.length : 0) > budget) break;
    const r = await solve(D.ddJob(view, h));
    solving += leadNow() - t;
    results.push(r);
    if (opts.onResult) opts.onResult(r);
  }
  return results;
}
// js/ddplay.js: page globals, or required in Node
// In Node tests ddplay.js may not be loaded yet; the page and the server bundle always have it. (The require is
// indirect so the server bundler doesn't try to resolve it: src/game.js already contains ddplay.js.)
function leadDD() { if (typeof ddSample === 'function') return { ddSample, ddJob, ddAuctionLimits }; const req = require; return req('./ddplay.js'); }
function leadNow() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function leadPick(view, cands, results, opts = {}) {
  const { val } = leadValues(view, cands, results, opts.metric);
  const prior = view.prior || {}, w = opts.w != null ? opts.w : LEAD_PRIOR_W;
  const stats = cands.map(x => ({ card: x, dd: val[x], prior: prior[x[0]] || 0, v: val[x] + w * (prior[x[0]] || 0) }));
  stats.sort((a, b) => b.v - a.v);
  return { card: stats[0].card, stats };
}
// How the solver's results are averaged ('tricks': defenders' tricks; 'imp': IMPs against the average lead; 'score'),
// and the weight of the prior. Chosen by cross-validation in tests/leadsim.js (tricks with weight 2 was best, about
// level with IMPs; with no prior the solver's choice was noticeably noisier on ~24 layouts).
const LEAD_METRIC = 'tricks', LEAD_PRIOR_W = 2;

if (typeof module !== 'undefined') module.exports = { leadCardOf, leadCards, leadLimits, leadFeatures, leadContext, leadPrior, botLead, leadValues, leadView, leadChoose, leadSample, leadPick, LEAD_FEATURES, LEAD_W };
