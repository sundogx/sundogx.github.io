// ===== Robot card play by double-dummy sampling (the Monte Carlo method of GIB and BEN) =====
// For the robot's turn: deal the cards it cannot see at random, many times, consistent with what it
// legitimately knows (its own hand, dummy once it is face up, the cards played, suits a player has shown
// out of, and what the auction said about each hand). Solve every layout double-dummy for every legal
// card and play the card with the best average score for its side. Ties go to the heuristic robot's
// card (js/bots.js botPlay), which keeps sequence leads, signals and lowest-of-equals.
//
// Pure functions over plain data, no DOM: used by js/dds-worker.js in the page and by tests/playsim.js.
// The robot never sees a hidden hand: ddView() copies only the visible cards out of the table, and
// everything after that works from the view alone.
if (typeof require !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('./engine.js'));
if (typeof require !== 'undefined' && typeof botPlay === 'undefined') globalThis.botPlay = require('./bots.js').botPlay;

// What a seat's calls say about its hand: HCP range and suit lengths, as soft limits for the sampler.
// Uses shown() from js/bidding.js when it is loaded (what the robots' own system says each call shows: the
// minimum and maximum points and suit lengths, and whether the hand is balanced), plus a few limits shown()
// doesn't give (ranges of the opening bids, a passed hand). vul: the board's vulnerability (some calls depend on it).
// full === false: only the minimums from shown() (the earlier sampler, for comparisons in tests/playsim.js).
// A 2C opening raises the minimum to 22 but never lowers a higher one shown later (2C-2D-3N shows 25-27; before round 14
// the sampler set it to 22, a bug: only 2C...3N auctions change, 22 boards in 30,000). keep2C: unused now (it was this).
// X (the play sampler's ddView passes DD_LIMX): closer to what the robots' bidding shows (round 12, scratch audit of
// robot auctions): X.p6c a non-vulnerable 3C opening may hold six clubs (63% did, the limit said 7+); X.pre the most
// points of a hand that passed throughout after partner's preempt or weak two (cap 7 before: real median 12, p98 16);
// X.cont the same after partner's one-level opening when the opponents bid (p98 10). X.c2 (test knob): 2C opener's minimum.
const DD_LIMX = { p6c: 1, pre: 15, cont: 10 };
function ddAuctionLimits(auction, seat, vul, full = true, keep2C = false, X = {}) {
  const k = { hcpMin: 0, hcpMax: 37, lenMin: { S: 0, H: 0, D: 0, C: 0 }, lenMax: { S: 13, H: 13, D: 13, C: 13 }, bal: false };
  let info = null;
  try { if (typeof shown === 'function') info = shown(auction, seat, vul); } catch (e) { info = null; }
  if (info) {
    if (info.pts > 0) k.hcpMin = Math.max(0, info.pts - (info.nt ? 0 : 2)); // suit bidders count some shape
    if (info.len) for (const s of SUITS) k.lenMin[s] = Math.max(k.lenMin[s], info.len[s] || 0);
    if (full) {
      if (info.ptsMax < 37) k.hcpMax = Math.min(37, info.ptsMax + (info.nt ? 0 : 1));
      if (info.maxLen) for (const s of SUITS) if (info.maxLen[s] < 13) k.lenMax[s] = info.maxLen[s];
      k.bal = ddShownBalanced(auction, seat, vul);
    }
  }
  const i0 = auction.findIndex(a => a.by === seat);
  if (i0 < 0) return k;
  const first = auction[i0], before = auction.slice(0, i0);
  const anyBid = before.some(a => bidValue(a.call) >= 0);
  if (!anyBid) { // the seat had the chance to open
    const c = first.call;
    if (c === 'P') k.hcpMax = Math.min(k.hcpMax, 12);
    else if (c === '1N') { k.hcpMin = Math.max(k.hcpMin, 15); k.hcpMax = Math.min(k.hcpMax, 17); for (const s of SUITS) { k.lenMin[s] = Math.max(k.lenMin[s], 2); k.lenMax[s] = Math.min(k.lenMax[s], 5); } }
    else if (c === '2N') { k.hcpMin = Math.max(k.hcpMin, 20); k.hcpMax = Math.min(k.hcpMax, 21); for (const s of SUITS) { k.lenMin[s] = Math.max(k.lenMin[s], 2); k.lenMax[s] = Math.min(k.lenMax[s], 5); } }
    else if (c === '2C') k.hcpMin = Math.max(k.hcpMin, X.c2 != null ? X.c2 : 22); // never below what shown() read (2C-2D-3N: 25)
    else if (/^1[CDHS]$/.test(c)) { k.hcpMin = Math.max(k.hcpMin, 10); k.hcpMax = Math.min(k.hcpMax, 21); }
    else if (/^[23][DHS]$|^3C$/.test(c)) { k.hcpMax = Math.min(k.hcpMax, 11); k.lenMin[c[1]] = Math.max(k.lenMin[c[1]], c[0] === '2' || (X.p6c && c === '3C' && !isVul(vul, seat)) ? 6 : 7); }
  } else if (auction.filter(a => a.by === seat).every(a => a.call === 'P')) {
    // never bid although the opponents opened, or partner opened and it never responded
    const opener = before.find(a => bidValue(a.call) >= 0);
    let cap = opener && sameSide(opener.by, seat) ? 7 : 17;
    if (cap === 7 && X.pre && !/^1|^2[CN]$/.test(opener.call)) cap = X.pre;
    if (cap === 7 && X.cont && /^1/.test(opener.call) && auction.some(a => !sameSide(a.by, seat) && a.call !== 'P')) cap = X.cont;
    k.hcpMax = Math.min(k.hcpMax, cap);
  }
  if (k.hcpMax < k.hcpMin) k.hcpMax = k.hcpMin;
  for (const s of SUITS) if (k.lenMax[s] < k.lenMin[s]) k.lenMax[s] = k.lenMin[s];
  return k;
}
// Did the seat show a balanced hand (a natural notrump bid, by the system's own meanings)?
let ddMetaMemo = { key: null, metas: null }; // the last auction's meanings (ddView asks for each hidden seat)
function ddShownBalanced(auction, seat, vul) {
  const key = vul + ':' + auction.map(a => a.by + a.call).join(',') + ':' + JSON.stringify([globalThis.BID_OFF, globalThis.BID_K]); // (the bidding's test knobs too)
  let metas = ddMetaMemo.key === key ? ddMetaMemo.metas : null;
  if (!metas) {
    try {
      if (typeof auctionMetas === 'function') metas = auctionMetas(auction, vul);
      else if (typeof require !== 'undefined') { const req = require; metas = req('./bidding.js')._metas(auction, vul); }
    } catch (e) { metas = null; }
    ddMetaMemo = { key, metas };
  }
  return !!metas && auction.some((a, i) => a.by === seat && metas[i] && metas[i].bal);
}

// The robot's view of the table: only what it is allowed to see.
// opts.limits 'min': the earlier, looser auction limits (minimums only), for comparisons in tests.
function ddView(t, seat, opts = {}) {
  const c = t.contract, play = t.play, decl = c.declarer, dummy = partnerOf(decl);
  const onDecl = sameSide(seat, decl);
  const dummyUp = play.tricks.length > 0 && play.tricks[0].cards.length > 0;
  const visible = onDecl ? [decl, dummy] : dummyUp ? [seat, dummy] : [seat];
  const known = {};
  for (const s of visible) known[s] = remainingHand(t.hands, play, s);
  const limits = {};
  for (const s of SEATS) if (!visible.includes(s)) limits[s] = ddAuctionLimits(t.auction || [], s, t.vul, opts.limits !== 'min', false, opts.limx || DD_LIMX);
  const view = {
    seat, vul: t.vul, contract: { level: c.level, strain: c.strain, doubled: c.doubled, declarer: decl },
    tricks: play.tricks.map(tr => ({ leader: tr.leader, cards: tr.cards.map(pc => ({ seat: pc.seat, card: pc.card })) })),
    auction: (t.auction || []).map(a => ({ call: a.call, by: a.by })), // public; the play model reads partner's suits for leads
    known, limits,
  };
  if (!play.tricks.length && typeof leadView === 'function') leadView(view, t, opts); // opening lead: js/leads.js
  const xp = opts.xpen != null ? opts.xpen : DD_XPEN;
  if (xp >= 0) ddXpenLimit(view, xp);
  if (opts.xpenH != null ? opts.xpenH : DD_XPENH) ddXpenHcp(view, t.vul, opts);
  return view;
}
// The trump minimum read from a defender's penalty double of the final suit contract (opts.xpen: test knob, -1 = off).
// shown() reads one as 3+ trumps, but the robots' judgement doubles (bidding.js judgeX) count defensive tricks: in 89,000
// robot auctions (round 16, seed p16a-c) the doublers held 0/1/2/3/4/5+ trumps 284/1151/1512/1402/1477/419 of 6,245
// times, so the real hand broke the 3+ limit on 41% of these boards (round 12: 24% with an odd bidder). Round 16 reads
// no trump minimum from the double (DD_XPEN 0), for the lead and the play: see HANDOFF-r16-play16.md for the measurement.
const DD_XPEN = 0;
function ddXpenLimit(view, n) {
  const c = view.contract, st = c.strain; if (!c.doubled || st === 'N') return;
  const x = [...view.auction].reverse().find(a => a.call === 'X');
  const lim = x && !sameSide(x.by, c.declarer) && view.limits[x.by];
  if (lim && lim.lenMin[st] > n) lim.lenMin[st] = n;
}

// A defender's double of the final contract sets no HCP minimum either (DD_XPENH; opts.xpenH 0: off): the doubler's minimum
// is the one its calls before the double showed. The robots' notrump doublers had less than the limit on 30% of 1,605
// boards, suit doublers on 10% of 6,245 (round 16; js/bidding.js judgeX doubles 3NT even with 0-5 HCP). Measured on
// doubled boards (tests/ddacc.js XONLY=1, seed p16xb, 16,000 boards, on top of DD_XPEN): declarer +0.016 +- 0.005,
// defenders +0.015 +- 0.005 IMPs per decision.
const DD_XPENH = true;
function ddXpenHcp(view, vul, opts) {
  const c = view.contract; if (!c.doubled) return;
  const a = view.auction, i = a.map(q => q.call).lastIndexOf('X'), x = a[i];
  if (!x || sameSide(x.by, c.declarer) || !view.limits[x.by] || (opts.xpenH === 'N' && c.strain !== 'N')) return;
  const before = ddAuctionLimits(a.slice(0, i), x.by, vul, false, false, opts.limx || DD_LIMX); // (minimums only: full would also redo ddShownBalanced and evict its one-auction memo)
  const lim = view.limits[x.by];
  lim.hcpMin = Math.min(lim.hcpMin, before.hcpMin);
}

function ddLegal(view) {
  const hand = view.known[view.seat];
  const tr = view.tricks[view.tricks.length - 1];
  if (!tr || tr.cards.length === 4 || !tr.cards.length) return hand.slice();
  const f = hand.filter(x => suitOf(x) === suitOf(tr.cards[0].card));
  return f.length ? f : hand.slice();
}
function ddPlayedSet(view) { const s = new Set(); view.tricks.forEach(tr => tr.cards.forEach(pc => s.add(pc.card))); return s; }
// Groups of the robot's legal cards that are equivalent whatever the layout: same suit, and every
// card ranking between them is already played or also in this hand.
function ddClasses(view, legal) {
  const gone = ddPlayedSet(view), mine = new Set(view.known[view.seat]);
  const out = [];
  for (const s of SUITS) {
    const cs = legal.filter(x => suitOf(x) === s).sort((a, b) => rankOf(b) - rankOf(a));
    let cur = null;
    for (const x of cs) {
      if (cur) {
        const lo = rankOf(x), hi = rankOf(cur[cur.length - 1]);
        let same = true;
        for (let r = lo + 1; r < hi; r++) { const y = s + RANKS[r]; if (!gone.has(y) && !mine.has(y)) { same = false; break; } }
        if (same) { cur.push(x); continue; }
      }
      cur = [x]; out.push(cur);
    }
  }
  return out;
}

// ---- Sampling the unseen cards ----
// How far a hidden hand (its full 13 cards: held plus played) is from what the auction showed (0 = fits).
function ddSeatPen(lim, full) {
  if (!lim) return 0;
  let p = 0;
  const pts = hcp(full), L = suitLengths(full);
  if (pts < lim.hcpMin) p += lim.hcpMin - pts;
  if (pts > lim.hcpMax) p += pts - lim.hcpMax;
  for (const su of SUITS) { if (L[su] < lim.lenMin[su]) p += 2 * (lim.lenMin[su] - L[su]); if (L[su] > lim.lenMax[su]) p += 2 * (L[su] - lim.lenMax[su]); }
  if (lim.bal && SUITS.some(su => L[su] < 2)) p += 2; // a singleton or void in a hand that showed a (semi-)balanced one
  return p;
}
// The unseen cards, who may hold them (voids shown) and how many each hidden player holds.
function ddUnseen(view) {
  const played = ddPlayedSet(view), seen = new Set(played);
  for (const s in view.known) view.known[s].forEach(x => seen.add(x));
  const unseen = [];
  for (const s of SUITS) for (const r of RANKS) if (!seen.has(s + r)) unseen.push(s + r);
  const hidden = SEATS.filter(s => !view.known[s]);
  const playedBy = {}, voids = {};
  for (const s of SEATS) { playedBy[s] = []; voids[s] = new Set(); }
  for (const tr of view.tricks) {
    if (!tr.cards.length) continue;
    const led = suitOf(tr.cards[0].card);
    for (const pc of tr.cards) { playedBy[pc.seat].push(pc.card); if (suitOf(pc.card) !== led) voids[pc.seat].add(led); }
  }
  const need = {};
  for (const s of hidden) need[s] = 13 - playedBy[s].length;
  return { unseen, hidden, playedBy, voids, need };
}
function ddBinom(n, r) { if (r < 0 || r > n) return 0; let x = 1; for (let i = 1; i <= r; i++) x = x * (n - r + i) / i; return Math.round(x); }
// Every layout of the unseen cards when there are at most max of them (two hidden hands, after the lead), else null.
// pens receives each layout's distance from the auction, as in ddSample (opts.relax applies the same way).
function ddEnumerate(view, max, pens, opts = {}) {
  const { unseen, hidden, playedBy, voids, need } = ddUnseen(view);
  if (hidden.length !== 2) return null;
  const [A, B] = hidden, base = { [A]: [], [B]: [] }, free = [];
  for (const x of unseen) {
    const a = !voids[A].has(suitOf(x)), b = !voids[B].has(suitOf(x));
    if (a && b) free.push(x); else if (a) base[A].push(x); else if (b) base[B].push(x); else return null;
  }
  const r = need[A] - base[A].length;
  if (r < 0 || r > free.length || free.length - r !== need[B] - base[B].length) return null;
  if (ddBinom(free.length, r) > max) return null;
  const out = [], ps = [], fits = { [A]: 0, [B]: 0 };
  const pick = [];
  const rec = (i, left) => {
    if (left === 0) {
      const set = new Set(pick), h = { [A]: base[A].concat(pick), [B]: base[B].concat(free.filter(x => !set.has(x))) };
      const pa = ddSeatPen(view.limits[A], h[A].concat(playedBy[A])), pb = ddSeatPen(view.limits[B], h[B].concat(playedBy[B]));
      if (!pa) fits[A]++; if (!pb) fits[B]++;
      for (const s in view.known) h[s] = view.known[s].slice();
      out.push(h); ps.push({ [A]: pa, [B]: pb });
      return;
    }
    if (free.length - i < left) return;
    pick.push(free[i]); rec(i + 1, left - 1); pick.pop();
    rec(i + 1, left);
  };
  rec(0, r);
  const drop = opts.relax ? hidden.filter(s => fits[s] < out.length * opts.relax) : [];
  for (const p of ps) pens.push(p[A] + p[B] - drop.reduce((t, s) => t + p[s], 0));
  return out;
}
function ddShuffle(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Returns up to k full layouts {N,E,S,W: remaining cards}, best fits to the auction first.
// pens (optional array) receives each returned layout's distance from the auction (0 = fits).
// opts.stop: stop dealing early when few layouts fit the auction (the remaining tries would mostly add spares).
// opts.relax (a fraction, e.g. 0.05): a hidden player whose limits fewer than this share of the layouts meet has them
// ignored when ranking the spares (the auction must have been misread, or a human bid oddly).
function ddSample(view, k, rand = Math.random, maxTries = 0, pens = null, opts = {}) {
  const { unseen, hidden, playedBy, voids, need } = ddUnseen(view);
  let total = 0;
  for (const s of hidden) total += need[s];
  if (total !== unseen.length) throw new Error('ddSample: card count mismatch');
  const allowed = x => hidden.filter(s => !voids[s].has(suitOf(x)));
  const seatPen = (s, h) => ddSeatPen(view.limits[s], h[s].concat(playedBy[s]));
  const tries = maxTries || Math.max(200, 60 * k);
  const good = [], spare = [], fits = {};
  hidden.forEach(s => { fits[s] = 0; });
  let dealt = 0;
  const order = unseen.map(x => ({ x, a: allowed(x) }));
  for (let t = 0; t < tries && good.length < k; t++) {
    // few layouts fit: the rest of the tries would mostly add spares, so stop once there are plenty of those
    if (opts.stop && t >= 300 && t % 100 === 0 && spare.length >= 4 * k && good.length * tries / t < k * 0.75) break;
    ddShuffle(order, rand);
    order.sort((p, q) => p.a.length - q.a.length); // stable: cards with fewest possible owners first
    const left = { ...need }, h = {};
    hidden.forEach(s => { h[s] = []; });
    let ok = true;
    for (const { x, a } of order) {
      let room = 0; for (const s of a) room += left[s];
      if (!room) { ok = false; break; }
      let r = rand() * room, pick = a[a.length - 1];
      for (const s of a) { r -= left[s]; if (r < 0) { pick = s; break; } }
      h[pick].push(x); left[pick]--;
    }
    if (!ok) continue;
    dealt++;
    const ps = {}; let p = 0;
    for (const s of hidden) { ps[s] = seatPen(s, h); p += ps[s]; if (!ps[s]) fits[s]++; }
    for (const s in view.known) h[s] = view.known[s].slice();
    if (p === 0) good.push(h); else spare.push({ h, p, ps });
  }
  // a player whose limits (almost) no layout meets, e.g. after a human's odd bid: judge the spares without them
  if (opts.relax && good.length < k && dealt >= 50) {
    const drop = hidden.filter(s => fits[s] < dealt * opts.relax);
    if (drop.length) for (const sp of spare) for (const s of drop) sp.p -= sp.ps[s];
  }
  if (pens) good.forEach(() => pens.push(0));
  if (good.length < k) { spare.sort((a, b) => a.p - b.p); for (const s of spare) { if (good.length >= k) break; good.push(s.h); if (pens) pens.push(s.p); } }
  return good;
}

// ---- How well a layout explains the cards already played (BEN's play-consistency check) ----
// BEN replays the play so far through its card-play neural networks and drops or down-weights layouts in
// which a hidden player would not have chosen the card actually played. Here the play model is the
// heuristic robot (botPlay): it plays standard carding (sequence leads, attitude signals, second hand low,
// third hand high, discards from weak suits), so in a layout where it would have played the same card
// (or one equal to it) the play fits. Each mismatch multiplies the layout's weight by a factor:
// opts.wOpp for the opponents' choices, opts.wPart for partner's, opts.wLead / opts.wLeadSuit for the
// opening lead (wLeadSuit when the lead is still the conventional card of its suit, e.g. the K from KQ;
// wLead when it isn't, e.g. the Q lead from a hand that holds the K).
function ddEqual(hand, gone, a, b) { // a and b equal for whoever holds `hand` (cards between them played or held)
  if (a === b) return true;
  if (suitOf(a) !== suitOf(b)) return false;
  const lo = Math.min(rankOf(a), rankOf(b)), hi = Math.max(rankOf(a), rankOf(b)), s = suitOf(a);
  for (let r = lo + 1; r < hi; r++) { const y = s + RANKS[r]; if (!gone.has(y) && !hand.includes(y)) return false; }
  return true;
}
// floor: stop as soon as the weight falls below it (the caller only needs to know it is below; see ddDeals).
function ddConsistency(view, h, opts = {}, floor = 0) {
  if (typeof botPlay !== 'function' || !view.tricks.length) return 1;
  const me = view.seat, c = view.contract, decl = c.declarer, dummy = partnerOf(decl);
  const onDecl = sameSide(me, decl);
  const full = {};
  for (const s of SEATS) full[s] = h[s].slice();
  for (const tr of view.tricks) for (const pc of tr.cards) full[pc.seat].push(pc.card);
  for (const s of SEATS) full[s] = sortHand(full[s]); // as dealt: the heuristic lead looks at cards in this order
  const t = { hands: full, auction: view.auction || [], contract: c, vul: view.vul, play: { tricks: [] } };
  const mOpp = opts.wOpp != null ? opts.wOpp : 0.5, mPart = opts.wPart != null ? opts.wPart : 0.5;
  const mLead = opts.wLead != null ? opts.wLead : 0.25, mLeadSuit = opts.wLeadSuit != null ? opts.wLeadSuit : 0.7;
  const gone = new Set();
  let w = 1, first = true;
  for (const tr of view.tricks) for (const { seat, card } of tr.cards) {
    const chooser = seat === dummy ? decl : seat;
    if (chooser !== me && !(onDecl && sameSide(chooser, me))) {
      const legal = legalPlays(full, t.play, c, seat);
      const rem = legal.length > 1 ? remainingHand(full, t.play, seat) : null;
      // all the legal cards equal (e.g. two low cards with the ones between them played): any choice fits
      if (legal.length > 1 && !(!first && opts.skipEq !== false && legal.every(x => ddEqual(rem, gone, legal[0], x)))) {
        let bot = null;
        try { bot = botPlay(t, seat); } catch (e) { bot = null; }
        if (first && opts.leadBeta && typeof leadPrior === 'function') {
          // the opening lead, read softly by the lead prior (js/leads.js): a suit the prior rates worse in this
          // layout is a less likely lead (the robots lead by the solver plus the prior, people by rules like it)
          if (!ddLeadCards(rem, c.strain).includes(card)) w *= mLead;
          else {
            const pr = leadPrior(rem, t.auction, c, seat, null, opts.leadNoVul ? undefined : t.vul), best = Math.max(...Object.values(pr));
            w *= Math.exp(-opts.leadBeta * (best - (pr[suitOf(card)] || 0)));
          }
        } else if (bot && !ddEqual(rem, gone, bot, card)) {
          if (first) w *= ddLeadCards(rem, c.strain).includes(card) ? mLeadSuit : mLead;
          else w *= sameSide(chooser, me) ? mPart : mOpp;
          if (w < floor) return w;
        }
      }
    }
    first = false;
    applyPlay(t.play, c, seat, card); gone.add(card);
  }
  return w;
}

// ---- The solver ----
const DD_SUIT = { S: 0, H: 1, D: 2, C: 3 }, DD_TRUMP = { S: 0, H: 1, D: 2, C: 3, N: 4 };
function ddPBN(h) {
  return 'N:' + SEATS.map(s => SUITS.map(su => h[s].filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => c[1]).join('') || '-').join('.')).join(' ');
}
// One solve: the position after `trick` (cards already played to the current trick) with these remaining hands.
function ddJob(view, hands) {
  const tr = view.tricks[view.tricks.length - 1];
  const cur = tr && tr.cards.length < 4 ? tr.cards.map(pc => pc.card) : [];
  const leader = cur.length ? tr.leader : view.seat;
  return { trump: DD_TRUMP[view.contract.strain], first: SEATS.indexOf(leader), trick: cur, pbn: ddPBN(hands), hands, mover: view.seat };
}
// Runs one job on a solver instance (create_dds_module from js/wasm/compiled.js, after _dds_init). Instances are
// reused: DDS keeps its transposition table only for the same or a similar deal, as in its own batch calls, and
// tests/ddtest.js checks reused instances against brute force and against fresh instances.
// Returns { card: tricks the mover's side takes from here on, including the current trick } for every card the mover may play.
function ddBuffers(inst) { // input (PBN) and output buffers, allocated once per instance
  return inst.ddIO || (inst.ddIO = { dp: inst._malloc(128), op: inst._malloc(13 * 12 + 64) });
}
function ddSolveRaw(inst, trump, first, trick, pbn) { // -> [{ suit, rank, tricks }] as DDS lists them
  const { dp, op } = ddBuffers(inst);
  for (let i = 0; i < pbn.length; i++) inst.setValue(dp + i, pbn.charCodeAt(i), 'i8');
  inst.setValue(dp + pbn.length, 0, 'i8');
  for (let i = 0; i < 13 * 3; i++) inst.setValue(op + i * 4, -1, 'i32'); // stale results must never be read
  const tc = [0, 1, 2].map(i => trick[i] ? [DD_SUIT[trick[i][0]], rankOf(trick[i]) + 2] : [0, 0]);
  inst._dds_solve_board(trump, first, tc[0][0], tc[0][1], tc[1][0], tc[1][1], tc[2][0], tc[2][1], dp, op);
  const out = [];
  for (let i = 0; i < 13; i++) {
    const rank = inst.getValue(op + i * 12, 'i32'); if (rank < 2 || rank > 14) break;
    out.push({ suit: inst.getValue(op + i * 12 + 4, 'i32'), rank, tricks: inst.getValue(op + i * 12 + 8, 'i32') });
  }
  return out;
}
// The double-dummy table of a whole deal (pbn: ddPBN of 13-card hands) with DDS's own table routine
// (dds_calc_table in wasm/dds_wrapper.cpp; about twice as fast as four ddSolveRaw per strain, same numbers).
// strain: 'S' 'H' 'D' 'C' 'N' for one strain, or omitted for all five. -> { N: { S: tricks, ... }, E, S, W },
// declarer's tricks, with only the asked strain filled in.
function ddTableRaw(inst, pbn, strain) {
  const { dp } = ddBuffers(inst), op = inst.ddTab || (inst.ddTab = inst._malloc(20 * 4));
  for (let i = 0; i < pbn.length; i++) inst.setValue(dp + i, pbn.charCodeAt(i), 'i8');
  inst.setValue(dp + pbn.length, 0, 'i8');
  for (let i = 0; i < 20; i++) inst.setValue(op + i * 4, -1, 'i32');
  const st = strain === undefined ? -1 : DD_TRUMP[strain];
  const ret = inst._dds_calc_table(dp, st, op);
  if (ret !== 0) throw new Error('DDS table error ' + ret);
  const table = { N: {}, E: {}, S: {}, W: {} };
  for (const s of [4, 0, 1, 2, 3]) { // N S H D C, the hand record's order
    if (st >= 0 && s !== st) continue;
    SEATS.forEach((seat, h) => {
      const v = inst.getValue(op + (s * 4 + h) * 4, 'i32');
      if (v < 0 || v > 13) throw new Error('DDS returned no result');
      table[seat]['SHDCN'[s]] = v;
    });
  }
  return table;
}
function ddRun(inst, job) {
  const listed = {};
  for (const r of ddSolveRaw(inst, job.trump, job.first, job.trick, job.pbn)) listed['SHDC'[r.suit] + RANKS[r.rank - 2]] = r.tricks;
  if (!Object.keys(listed).length) throw new Error('DDS returned no result');
  // DDS lists one card of each run of equals; give the others the same result
  const mine = new Set(job.hands[job.mover]), held = new Set(SEATS.flatMap(s => job.hands[s]));
  const out = {};
  for (const x of job.hands[job.mover]) {
    if (x in listed) { out[x] = listed[x]; continue; }
    const s = x[0];
    for (const dir of [1, -1]) {
      for (let r = rankOf(x) + dir; r >= 0 && r < 13; r += dir) {
        const y = s + RANKS[r];
        if (y in listed && mine.has(y)) { out[x] = listed[y]; break; }
        if (mine.has(y) || !held.has(y)) continue; // own card or already played: still equal
        break;
      }
      if (x in out) break;
    }
  }
  return out;
}
// A solver instance: createModule is create_dds_module (wasm/compiled.js), wasmModule the compiled WebAssembly.Module.
async function ddInstance(createModule, wasmModule) {
  const inst = await createModule({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(wasmModule, imports).then(i => cb(i, wasmModule)); return {}; } });
  inst._dds_init();
  return inst;
}
// A solve function for ddChoose, on one instance made on first use and kept. If a solve fails (the instance
// may be broken, e.g. out of memory), the instance is dropped and the solve retried once on a new one.
// opts.fresh: a new instance for every solve instead (for tests).
function ddSolver(createModule, wasmModule, opts = {}) {
  let inst = null;
  const get = async () => inst || (inst = await ddInstance(createModule, wasmModule));
  const solve = async job => {
    if (opts.fresh) return ddRun(await ddInstance(createModule, wasmModule), job);
    try { return ddRun(await get(), job); }
    catch (err) { inst = null; return ddRun(await get(), job); }
  };
  solve.table = async (pbn, strain) => { // ddTableRaw on the same instance, with the same retry
    try { return ddTableRaw(await get(), pbn, strain); }
    catch (err) { inst = null; return ddTableRaw(await get(), pbn, strain); }
  };
  return solve;
}

// ---- Choosing the card ----
// results: one {card: tricks} per sampled layout. Returns { card, stats } or null.
// opts.weights: one weight per layout (default all 1). opts.agg 'imp': rank cards by average IMPs against the
// other candidate cards layout by layout (BEN's use_real_imp_or_mp), scaled x10 to keep the tolerances' meaning.
function ddPick(view, legal, results, prefer, opts = {}) {
  const c = view.contract, onDecl = sameSide(view.seat, c.declarer);
  let sideWon = 0;
  for (const tr of view.tricks) if (tr.cards.length === 4) {
    const w = trickWinner(tr, c.strain);
    if (sameSide(w, view.seat)) sideWon++;
  }
  const W = opts.weights || results.map(() => 1);
  const pts = (r, card) => { const side = sideWon + r[card], s = scoreContract(c, onDecl ? side : 13 - side, view.vul); return onDecl ? s : -s; };
  const stats = legal.map(card => {
    let sc = 0, tk = 0, n = 0, wt = 0;
    results.forEach((r, i) => {
      if (!(card in r)) return;
      sc += W[i] * pts(r, card); tk += W[i] * (sideWon + r[card]); wt += W[i]; n++;
    });
    return { card, score: wt ? sc / wt : -1e9, tricks: wt ? tk / wt : 0, n };
  });
  // opts.trW (test knob, off): points added per average trick, a steadier estimate than the score on ~24 layouts
  if (opts.trW) stats.forEach(a => { if (a.n) a.score += opts.trW * a.tricks; });
  if (opts.agg === 'impref' && stats.length > 1) {
    // IMPs against a reference result: on each layout, the best any candidate card achieves (what the other table's
    // declarer or defenders could do), scaled x10 like 'imp'. Concave in points, so it values safety the way IMPs do.
    const ref = results.map(r => Math.max(...legal.filter(x => x in r).map(x => pts(r, x))));
    stats.forEach(a => {
      if (!a.n) return;
      let sum = 0, wt = 0;
      results.forEach((r, i) => { if (a.card in r) { sum += W[i] * toImps(pts(r, a.card) - ref[i]); wt += W[i]; } });
      a.score = wt ? 10 * sum / wt : a.score;
    });
  }
  if (opts.agg === 'imp' && stats.length > 1) {
    const imp = stats.map(a => {
      if (!a.n) return a.score;
      let sum = 0, wt = 0;
      for (const b of stats) if (b !== a) results.forEach((r, i) => {
        if (!(a.card in r) || !(b.card in r)) return;
        sum += W[i] * toImps(pts(r, a.card) - pts(r, b.card)); wt += W[i];
      });
      return wt ? 10 * sum / wt : 0;
    });
    stats.forEach((a, i) => { a.score = imp[i]; });
  }
  if (!stats.length) return null; // no candidate cards
  const best = Math.max(...stats.map(s => s.score));
  const tol = opts.tol != null ? opts.tol : 0.5;
  const near = stats.filter(s => s.score >= best - tol);
  let pick = near.find(s => s.card === prefer);
  if (!pick) {
    const leading = !view.tricks.length || view.tricks[view.tricks.length - 1].cards.length === 4;
    near.sort((a, b) => b.score - a.score || b.tricks - a.tricks);
    const top = near.filter(s => s.score === near[0].score && s.tricks === near[0].tricks);
    // among exact equals: lowest card, but the top of touching cards when leading
    top.sort((a, b) => rankOf(a.card) - rankOf(b.card));
    pick = leading && top.length > 1 && suitOf(top[0].card) === suitOf(top[top.length - 1].card) ? top[top.length - 1] : top[0];
  }
  return { card: pick.card, stats };
}

// The standard opening-lead card in each suit: top of a doubleton or of touching honours, the ace against
// a suit contract, low from an honour, middle from three small, fourth best from length.
function ddLeadCards(hand, strain) {
  const out = [];
  for (const s of SUITS) {
    const h = hand.filter(x => suitOf(x) === s).sort((a, b) => rankOf(b) - rankOf(a));
    if (!h.length) continue;
    const hon = rankOf(h[0]) >= 9; // jack or better
    let c;
    if (h.length <= 2) c = h[0];
    else if (rankOf(h[0]) >= 8 && rankOf(h[0]) - rankOf(h[1]) === 1 && (h.length < 4 || strain !== 'N' || rankOf(h[1]) - rankOf(h[2]) <= 2)) c = h[0];
    else if (strain !== 'N' && h[0][1] === 'A') c = h[0];
    else if (h.length === 3) c = hon ? h[2] : h[1];
    else c = hon ? h[3] : h[1];
    out.push(c);
  }
  return out;
}

// Does this turn need the solver at all? (false: one legal card, or all legal cards are equals)
function ddWorthIt(view) {
  const legal = ddLegal(view);
  return legal.length > 1 && ddClasses(view, legal).length > 1;
}
// The whole decision. solve(job) -> Promise<{card: tricks}>. Returns { card, stats, samples, ms } or null (use the heuristic).
// opts: k (layouts, default 20), minK (fewest solved layouts worth trusting, default 6), ms (time budget),
// hardMs (when the caller stops waiting: give up early if minK layouts can't be solved by then), rand,
// prefer (the heuristic card, for ties), tol, agg (see ddPick).
// Inference from the play (after the opening lead): pool (layouts dealt before the k best-fitting are solved),
// weigh (average by fit), wOpp/wPart/wLead/wLeadSuit (see ddConsistency), consMs (time for the play check,
// default 30% of the budget), penBase (weight factor per point of distance from the auction, default 0.7).
// opts.declarer / opts.defender hold extra options for the declaring side's and the defenders' decisions after the lead.
// The parts (ddOpts, ddDeals, ddSolveDeals, ddDecide) are also used separately: the page can split the layouts of a
// slow decision between several workers (js/dds-worker.js playSamples) and decide on the pooled results.
async function ddChoose(view, solve, opts = {}) {
  if (!ddWorthIt(view)) return null;
  opts = ddOpts(view, opts);
  if (!view.tricks.length && opts.lead === 'conv' && view.prior && typeof leadChoose === 'function') return leadChoose(view, solve, opts); // js/leads.js
  const t0 = ddNow();
  const { deals, weights } = ddDeals(view, opts, t0);
  const results = await ddSolveDeals(view, deals, solve, opts, t0);
  if (!results) return null;
  const r = ddDecide(view, results, weights, opts);
  if (r) r.ms = ddNow() - t0;
  return r;
}
function ddNow() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
// The options for this decision: the side's own (opts.declarer / opts.defender) after the opening lead.
function ddOpts(view, opts) {
  const side = sameSide(view.seat, view.contract.declarer) ? opts.declarer : opts.defender;
  return side && view.tricks.length ? { ...opts, ...side } : opts;
}
// The layouts to solve, best first, and their weights (null: all equal). t0: when the decision started (for consMs).
function ddDeals(view, opts, t0 = ddNow()) {
  const k = opts.k || 20, budget = opts.ms || Infinity, rand = opts.rand || Math.random;
  if (!(opts.pool > k && view.tricks.length && typeof botPlay === 'function')) return { deals: ddSample(view, k, rand, 0, null, opts), weights: null };
  // BEN-style: deal a larger pool, weight each layout by how well it explains the play so far, solve the best k
  // opts.exact: late in the play, when there are at most that many layouts, take every one of them instead
  // (opts.exactK: solve the best exactK of them, default all)
  let pens = [], pool = opts.exact ? ddEnumerate(view, opts.exact, pens, opts) : null;
  if (pool) {
    const ws = pool.map((h, i) => ddConsistency(view, h, opts) * Math.pow(opts.penBase != null ? opts.penBase : 0.7, pens[i]));
    const order = pool.map((h, i) => i).sort((a, b) => ws[b] - ws[a]).slice(0, opts.exactK || pool.length);
    return { deals: order.map(i => pool[i]), weights: order.map(i => ws[i]), exact: true };
  }
  pens = []; pool = ddSample(view, opts.pool, rand, 0, pens, opts);
  // the play check costs time on every layout: on a slow device score only as many as fit in a share of the budget
  const consMs = opts.consMs != null ? opts.consMs : budget * 0.3, pb = opts.penBase != null ? opts.penBase : 0.7;
  // late in the play the same layout is often dealt several times: its check is done once (opts.memo false: every time)
  // A layout whose weight falls below the k-th best so far can't be among the k solved (that only rises, and ties go
  // to the earlier layout), so its check stops there (opts.floor false: check every layout to the end).
  const ws = [], memo = opts.memo === false ? null : new Map(), top = [], cut = opts.floor !== false && !opts.exact;
  for (let i = 0; i < pool.length; i++) {
    if (i >= k && ddNow() - t0 > consMs) { pool.length = i; break; }
    const key = memo && ddKey(pool[i]), pf = Math.pow(pb, pens[i] || 0);
    const floor = cut && top.length >= k ? top[k - 1] / pf : 0;
    let w = memo ? memo.get(key) : undefined;
    if (w === undefined) { w = ddConsistency(view, pool[i], opts, floor); if (memo) memo.set(key, w); }
    w *= pf; ws.push(w);
    if (cut && (top.length < k || w > top[k - 1])) { // the k best weights so far, highest first
      let j = Math.min(top.length, k - 1);
      while (j > 0 && top[j - 1] < w) { top[j] = top[j - 1]; j--; }
      top[j] = w; if (top.length > k) top.length = k;
    }
  }
  const order = pool.map((h, i) => i).sort((a, b) => ws[b] - ws[a]); // stable: ties keep the sampler's order
  return { deals: order.slice(0, k).map(i => pool[i]), weights: opts.weigh ? order.slice(0, k).map(i => ws[i]) : null };
}
function ddKey(h) { return SEATS.map(s => h[s].slice().sort().join('')).join('|'); }
// Solves the layouts in order until the budget: stops before a solve that would probably end past opts.ms, once it
// has opts.minK. Returns the results ({card: tricks} per layout), or null when minK can't be reached by opts.hardMs.
// onResult(r, i) is called after each solve.
async function ddSolveDeals(view, deals, solve, opts, t0 = ddNow(), onResult = null) {
  const minK = Math.min(opts.k || 20, opts.minK || 6, deals.length), budget = opts.ms || Infinity, hardMs = opts.hardMs || Infinity;
  const results = [], seen = opts.memo === false ? null : new Map(); // a layout dealt twice is solved once
  let solving = 0, solved = 0;
  for (const h of deals) {
    const t = ddNow(), key = seen && ddKey(h);
    if (seen && seen.has(key)) { const r = seen.get(key); results.push(r); if (onResult) onResult(r, results.length - 1); continue; }
    if (results.length >= minK && t - t0 + (solved ? solving / solved : 0) > budget) break;
    // too slow to reach minK before the caller stops waiting: give up now and free the worker for the next card
    if (solved && results.length < minK && t - t0 + (minK - results.length) * solving / solved > hardMs) return null;
    const r = await solve(ddJob(view, h));
    solving += ddNow() - t; solved++;
    if (seen) seen.set(key, r);
    results.push(r);
    if (onResult) onResult(r, results.length - 1);
  }
  return results;
}
// The card from solved layouts (weights: one per result, or null). Returns { card, stats, samples } or null when
// fewer than opts.minK layouts were solved.
function ddDecide(view, results, weights, opts) {
  if (results.length < Math.min(opts.k || 20, opts.minK || 6)) return null;
  const legal = ddLegal(view);
  if (weights) { const m = Math.max(...weights.slice(0, results.length)); weights = m > 0 ? weights.slice(0, results.length).map(x => x / m) : null; }
  let cands = legal, o = opts;
  if (!view.tricks.length && opts.lead === 'conv') { // opening lead: the solver picks the suit, convention the card
    cands = ddLeadCards(legal, view.contract.strain);
    if (opts.prefer && !cands.includes(opts.prefer)) cands.push(opts.prefer);
    o = { ...opts, tol: opts.leadTol != null ? opts.leadTol : opts.tol };
  }
  if (weights) o = { ...o, weights };
  const r = ddPick(view, cands, results, opts.prefer, o);
  if (!r) return null;
  r.samples = results.length;
  return r;
}

if (typeof module !== 'undefined') module.exports = { DD_LIMX, ddEnumerate, ddSeatPen, ddConsistency, ddAuctionLimits, ddView, ddLegal, ddClasses, ddLeadCards, ddSample, ddPBN, ddJob, ddRun, ddSolveRaw, ddTableRaw, ddInstance, ddSolver, ddPick, ddWorthIt, ddChoose, ddOpts, ddDeals, ddSolveDeals, ddDecide };
