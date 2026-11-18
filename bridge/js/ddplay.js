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
// Uses shown() from js/bots.js when it is loaded (it reads the robots' own bidding), plus a few
// limits shown() doesn't give (ranges of the opening bids, a passed hand).
function ddAuctionLimits(auction, seat) {
  const k = { hcpMin: 0, hcpMax: 37, lenMin: { S: 0, H: 0, D: 0, C: 0 }, lenMax: { S: 13, H: 13, D: 13, C: 13 } };
  let info = null;
  try { if (typeof shown === 'function') info = shown(auction, seat); } catch (e) { info = null; }
  if (info) {
    if (info.pts > 0) k.hcpMin = Math.max(0, info.pts - (info.nt ? 0 : 2)); // suit bidders count some shape
    if (info.len) for (const s of SUITS) k.lenMin[s] = Math.max(k.lenMin[s], info.len[s] || 0);
  }
  const i0 = auction.findIndex(a => a.by === seat);
  if (i0 < 0) return k;
  const first = auction[i0], before = auction.slice(0, i0);
  const anyBid = before.some(a => bidValue(a.call) >= 0);
  if (!anyBid) { // the seat had the chance to open
    const c = first.call;
    if (c === 'P') k.hcpMax = 12;
    else if (c === '1N') { k.hcpMin = 15; k.hcpMax = 17; for (const s of SUITS) { k.lenMin[s] = Math.max(k.lenMin[s], 2); k.lenMax[s] = 5; } }
    else if (c === '2N') { k.hcpMin = 20; k.hcpMax = 21; for (const s of SUITS) { k.lenMin[s] = Math.max(k.lenMin[s], 2); k.lenMax[s] = 5; } }
    else if (c === '2C') k.hcpMin = 22;
    else if (/^1[CDHS]$/.test(c)) { k.hcpMin = Math.max(k.hcpMin, 10); k.hcpMax = 21; }
    else if (/^[23][DHS]$|^3C$/.test(c)) { k.hcpMax = 11; k.lenMin[c[1]] = Math.max(k.lenMin[c[1]], c[0] === '2' ? 6 : 7); }
  } else if (auction.filter(a => a.by === seat).every(a => a.call === 'P')) {
    // never bid although the opponents opened, or partner opened and it never responded
    const opener = before.find(a => bidValue(a.call) >= 0);
    k.hcpMax = opener && sameSide(opener.by, seat) ? 7 : 17;
  }
  return k;
}

// The robot's view of the table: only what it is allowed to see.
function ddView(t, seat) {
  const c = t.contract, play = t.play, decl = c.declarer, dummy = partnerOf(decl);
  const onDecl = sameSide(seat, decl);
  const dummyUp = play.tricks.length > 0 && play.tricks[0].cards.length > 0;
  const visible = onDecl ? [decl, dummy] : dummyUp ? [seat, dummy] : [seat];
  const known = {};
  for (const s of visible) known[s] = remainingHand(t.hands, play, s);
  const limits = {};
  for (const s of SEATS) if (!visible.includes(s)) limits[s] = ddAuctionLimits(t.auction || [], s);
  return {
    seat, vul: t.vul, contract: { level: c.level, strain: c.strain, doubled: c.doubled, declarer: decl },
    tricks: play.tricks.map(tr => ({ leader: tr.leader, cards: tr.cards.map(pc => ({ seat: pc.seat, card: pc.card })) })),
    auction: (t.auction || []).map(a => ({ call: a.call, by: a.by })), // public; the play model reads partner's suits for leads
    known, limits,
  };
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
function ddShuffle(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Returns up to k full layouts {N,E,S,W: remaining cards}, best fits to the auction first.
// pens (optional array) receives each returned layout's distance from the auction (0 = fits).
function ddSample(view, k, rand = Math.random, maxTries = 0, pens = null) {
  const played = ddPlayedSet(view), seen = new Set(played);
  for (const s in view.known) view.known[s].forEach(x => seen.add(x));
  const unseen = [];
  for (const s of SUITS) for (const r of RANKS) if (!seen.has(s + r)) unseen.push(s + r);
  const hidden = SEATS.filter(s => !view.known[s]);
  const playedBy = {}, voids = {};
  for (const s of SEATS) { playedBy[s] = []; voids[s] = new Set(); }
  for (const tr of view.tricks) {
    const led = suitOf(tr.cards[0].card);
    for (const pc of tr.cards) { playedBy[pc.seat].push(pc.card); if (suitOf(pc.card) !== led) voids[pc.seat].add(led); }
  }
  const need = {}; let total = 0;
  for (const s of hidden) { need[s] = 13 - playedBy[s].length; total += need[s]; }
  if (total !== unseen.length) throw new Error('ddSample: card count mismatch');
  const allowed = x => hidden.filter(s => !voids[s].has(suitOf(x)));
  const penalty = h => { // how far each hidden hand is from what the auction showed
    let p = 0;
    for (const s of hidden) {
      const lim = view.limits[s]; if (!lim) continue;
      const full = h[s].concat(playedBy[s]);
      const pts = hcp(full), L = suitLengths(full);
      if (pts < lim.hcpMin) p += lim.hcpMin - pts;
      if (pts > lim.hcpMax) p += pts - lim.hcpMax;
      for (const su of SUITS) { if (L[su] < lim.lenMin[su]) p += 2 * (lim.lenMin[su] - L[su]); if (L[su] > lim.lenMax[su]) p += 2 * (L[su] - lim.lenMax[su]); }
    }
    return p;
  };
  const tries = maxTries || Math.max(200, 60 * k);
  const good = [], spare = [];
  const order = unseen.map(x => ({ x, a: allowed(x) }));
  for (let t = 0; t < tries && good.length < k; t++) {
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
    const p = penalty(h);
    for (const s in view.known) h[s] = view.known[s].slice();
    if (p === 0) good.push(h); else spare.push({ h, p });
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
function ddConsistency(view, h, opts = {}) {
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
      if (legal.length > 1) {
        let bot = null;
        try { bot = botPlay(t, seat); } catch (e) { bot = null; }
        const rem = remainingHand(full, t.play, seat);
        if (bot && !ddEqual(rem, gone, bot, card)) {
          if (first) w *= ddLeadCards(rem, c.strain).includes(card) ? mLeadSuit : mLead;
          else w *= sameSide(chooser, me) ? mPart : mOpp;
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
// Runs one job on a fresh solver instance (this build is wrong if an instance is reused).
// Returns { card: tricks the mover's side takes from here on, including the current trick } for every card the mover may play.
function ddRun(inst, job) {
  const dp = inst.allocateUTF8(job.pbn), op = inst._malloc(13 * 12 + 64);
  const listed = {};
  try {
    for (let i = 0; i < 13 * 3; i++) inst.setValue(op + i * 4, -1, 'i32');
    const tc = [0, 1, 2].map(i => job.trick[i] ? [DD_SUIT[job.trick[i][0]], rankOf(job.trick[i]) + 2] : [0, 0]);
    inst._dds_solve_board(job.trump, job.first, tc[0][0], tc[0][1], tc[1][0], tc[1][1], tc[2][0], tc[2][1], dp, op);
    for (let i = 0; i < 13; i++) {
      const rank = inst.getValue(op + i * 12, 'i32'); if (rank < 2 || rank > 14) break;
      const suit = inst.getValue(op + i * 12 + 4, 'i32'), tricks = inst.getValue(op + i * 12 + 8, 'i32');
      listed['SHDC'[suit] + RANKS[rank - 2]] = tricks;
    }
  } finally { inst._free(op); inst._free(dp); }
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
// A solve function for ddChoose: createModule is create_dds_module (wasm/compiled.js), wasmModule the compiled WebAssembly.Module.
function ddSolver(createModule, wasmModule) {
  return async job => {
    const inst = await createModule({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(wasmModule, imports).then(i => cb(i, wasmModule)); return {}; } });
    inst._dds_init();
    return ddRun(inst, job);
  };
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
// rand, prefer (the heuristic card, for ties), tol.
// Inference from the play (after the opening lead): pool (layouts dealt before the k best-fitting are solved),
// weigh (average by fit), wOpp/wPart/wLead/wLeadSuit (see ddConsistency). opts.declarer / opts.defender hold
// extra options for the declaring side's and the defenders' decisions after the opening lead.
async function ddChoose(view, solve, opts = {}) {
  const legal = ddLegal(view);
  if (!ddWorthIt(view)) return null;
  const side = sameSide(view.seat, view.contract.declarer) ? opts.declarer : opts.defender;
  if (side && view.tricks.length) opts = { ...opts, ...side };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now(), k = opts.k || 20, minK = Math.min(k, opts.minK || 6), budget = opts.ms || Infinity;
  const rand = opts.rand || Math.random;
  let deals, weights = null;
  if (opts.pool > k && view.tricks.length && typeof botPlay === 'function') {
    // BEN-style: deal a larger pool, weight each layout by how well it explains the play so far, solve the best k
    const pens = [], pool = ddSample(view, opts.pool, rand, 0, pens);
    const ws = pool.map((h, i) => ddConsistency(view, h, opts) * Math.pow(0.7, pens[i] || 0));
    const order = pool.map((h, i) => i).sort((a, b) => ws[b] - ws[a]); // stable: ties keep the sampler's order
    deals = order.slice(0, k).map(i => pool[i]);
    if (opts.weigh) weights = order.slice(0, k).map(i => ws[i]);
  } else deals = ddSample(view, k, rand);
  const results = [];
  for (const h of deals) {
    if (results.length >= minK && now() - t0 > budget) break;
    results.push(await solve(ddJob(view, h)));
  }
  if (results.length < minK) return null;
  if (weights) { const m = Math.max(...weights.slice(0, results.length)); weights = m > 0 ? weights.slice(0, results.length).map(x => x / m) : null; }
  let cands = legal, o = opts;
  if (!view.tricks.length && opts.lead === 'conv') { // opening lead: the solver picks the suit, convention the card
    cands = ddLeadCards(legal, view.contract.strain);
    if (opts.prefer && !cands.includes(opts.prefer)) cands.push(opts.prefer);
    o = { ...opts, tol: opts.leadTol != null ? opts.leadTol : opts.tol };
  }
  if (weights) o = { ...o, weights };
  const r = ddPick(view, cands, results, opts.prefer, o);
  r.samples = results.length; r.ms = now() - t0;
  return r;
}

if (typeof module !== 'undefined') module.exports = { ddConsistency, ddAuctionLimits, ddView, ddLegal, ddClasses, ddLeadCards, ddSample, ddPBN, ddJob, ddRun, ddSolver, ddPick, ddWorthIt, ddChoose };
