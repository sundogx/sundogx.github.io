// ===== Robot bidding: 2/1 Game Forcing =====
// The system is written as tables. For each situation (worked out from the auction alone) a table lists the
// calls the system allows, each with the hands that make it (`w`) and what it shows (`m`). The robot makes the
// first call whose hand test passes; to understand a call, anyone's, alerted or not, the same table is read
// backwards. So robots read human partners by the system, and every alert says what the call means.
// Situations without a table fall back to natural bidding from what both hands have shown (`natural`).
if (typeof require !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('./engine.js'));

const BID_OFF = k => ((typeof globalThis !== 'undefined' && globalThis.BID_OFF) || []).includes(k); // toggles for tests
const SNAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs', N: 'notrump' };
const SSYM = { S: '♠', H: '♥', D: '♦', C: '♣', N: 'NT' };
const MAJ = s => s === 'S' || s === 'H';
const MIN = s => s === 'C' || s === 'D';
const otherM = s => s === 'S' ? 'H' : 'S';
const gameLevel = st => st === 'N' ? 3 : MAJ(st) ? 4 : 5;
// vulnerability for my side: 2 unfavourable (we vulnerable, they not), 1 both vulnerable, 0 neither, -1 favourable
const vulK = (ctx, k) => { const v = BID_OFF('vul') || BID_OFF(k) ? 0 : ctx.weVul ? (ctx.theyVul ? 1 : 2) : ctx.theyVul ? -1 : 0; return (v < 0 && BID_OFF(k + 'L')) || (v > 0 && BID_OFF(k + 'S')) ? 0 : v; };

const BID_K = k => ((typeof globalThis !== 'undefined' && globalThis.BID_K) || {})[k]; // tuning knobs for tests
const SD = () => BID_K('sd') ?? 2; // how much lighter than the textbook point counts the slam tries below are

// ---- Hand evaluation ----
const HONV = { A: 4, K: 3, Q: 2, J: 1 };
function evalHand(hand) {
  const L = suitLengths(hand), H = hcp(hand), sp = {}, has = {};
  for (const s of SUITS) {
    const r = hand.filter(c => c[0] === s).map(c => c[1]);
    has[s] = r.join(''); sp[s] = r.reduce((t, x) => t + (HONV[x] || 0), 0);
  }
  const sh = SUITS.map(s => L[s]).sort((a, b) => b - a);
  const bal = sh[3] >= 2 && sh[2] >= 3;                     // 4333 4432 5332
  const semi = sh[3] >= 2 && sh[1] <= 4 && sh[0] <= 6;      // also 5422 6322
  return { hand, H, L, sp, has, sh, bal, semi, lp: SUITS.reduce((t, s) => t + Math.max(0, L[s] - 4), 0) };
}
const hon = (h, s, set = 'AKQ') => [...set].filter(r => h.has[s].includes(r)).length;
const goodSuit = (h, s) => hon(h, s) >= 2 || hon(h, s, 'AKQJT') >= 3;
const stopper = (h, s) => !!h.has[s] && (h.has[s].includes('A') || (h.has[s].includes('K') && h.L[s] >= 2) || (h.has[s].includes('Q') && h.L[s] >= 3) || (h.has[s].includes('J') && h.L[s] >= 4) || h.L[s] >= 5);
function supPts(h, tr) { // points as dummy for partner's suit: high cards plus shortness
  if (h.L[tr] < 3) return h.H;
  const four = h.L[tr] >= 4;
  return h.H + SUITS.filter(s => s !== tr).reduce((t, s) => t + (h.L[s] === 0 ? (four ? 5 : 3) : h.L[s] === 1 ? (four ? 3 : 2) : h.L[s] === 2 ? 1 : 0), 0);
}
function ownPts(h, tr) { // points as the hand with the long trumps: high cards, length and a little for shortness
  return h.H + h.lp + SUITS.filter(s => s !== tr).reduce((t, s) => t + (h.L[s] === 0 ? 2 : h.L[s] === 1 ? 1 : 0), 0);
}
function ltc(h) {
  let n = 0;
  for (const s of SUITS) { const k = Math.min(3, h.L[s]); n += k; ['A', 'K', 'Q'].slice(0, k).forEach(r => { if (h.has[s].includes(r)) n--; }); }
  return n;
}
const keycards = (h, tr) => [...'SHDC'].filter(s => h.has[s].includes('A')).length + (tr && tr !== 'N' && h.has[tr].includes('K') ? 1 : 0);

// ---- Meanings ----
// lo/hi: high-card points; mn/mx: suit lengths; f: 1 forcing one round, 2 game forcing; inv: invitational;
// art: artificial (says nothing about the suit named); agree: trump suit this call agrees; a: the alert text.
function MM(lo, hi, o = {}) {
  return { lo, hi, mn: o.mn || {}, mx: o.mx || {}, bal: !!o.bal, f: o.f || 0, inv: !!o.inv, art: !!o.art, agree: o.agree || null,
    alert: o.a || null, tag: o.t || '', trump: o.trump || null, kc: o.kc || null, nt: !!o.nt, stop: o.stop || null, q: o.q, short: o.short || null };
}
const ANY = () => MM(0, 37);
function mergeM(ms) { // a call listed more than once in a table means "any of these"
  if (ms.length === 1) return ms[0];
  const r = Object.assign({}, ms[0]);
  r.lo = Math.min(...ms.map(m => m.lo)); r.hi = Math.max(...ms.map(m => m.hi));
  r.mn = {}; r.mx = {};
  for (const s of SUITS) {
    const a = Math.min(...ms.map(m => m.mn[s] || 0)); if (a) r.mn[s] = a;
    const b = Math.max(...ms.map(m => m.mx[s] === undefined ? 13 : m.mx[s])); if (b < 13) r.mx[s] = b;
  }
  r.bal = ms.every(m => m.bal); r.inv = ms.every(m => m.inv); r.f = Math.min(...ms.map(m => m.f));
  return r;
}
function agg(ms) { // what a seat has shown with all its calls
  const r = { lo: 0, hi: 37, mn: { S: 0, H: 0, D: 0, C: 0 }, mx: { S: 13, H: 13, D: 13, C: 13 }, bal: false, nt: false };
  // a takeout double followed by a long suit of my own (X, then 2H on five or more) was a strong hand with that suit:
  // the double's promise of support for the other suits no longer stands
  const xi = BID_OFF('xlong') ? -1 : ms.findIndex(m => m && m.tag === 'xto');
  const xVoid = xi >= 0 && ms.some((m, j) => j > xi && m && !m.agree && SUITS.some(s => m.mn[s] >= 5));
  for (const [j, m] of ms.entries()) {
    if (!m) continue;
    r.lo = Math.max(r.lo, m.lo); r.hi = Math.min(r.hi, m.hi);
    if (xVoid && j === xi) continue;
    for (const s of SUITS) { if (m.mn[s]) r.mn[s] = Math.max(r.mn[s], m.mn[s]); if (m.mx[s] !== undefined) r.mx[s] = Math.min(r.mx[s], m.mx[s]); }
    if (m.bal) r.bal = true; if (m.nt) r.nt = true;
  }
  if (r.hi < r.lo) r.hi = r.lo;
  return r;
}

// ---- The auction as seen by one seat ----
function legalFor(prefix, seat) {
  const calls = ['P'], lb = lastBid(prefix);
  for (let v = lb ? bidValue(lb.call) + 1 : 0; v < 35; v++) calls.push(`${Math.floor(v / 5) + 1}${STRAINS[v % 5]}`);
  const lnp = lastNonPass(prefix);
  if (lnp && !sameSide(lnp.by, seat)) { if (bidValue(lnp.call) >= 0) calls.push('X'); if (lnp.call === 'X') calls.push('XX'); }
  return calls;
}
function mkCtx(prefix, seat, metas, vul) {
  const p = partnerOf(seat);
  const items = prefix.map((a, i) => ({ call: a.call, by: a.by, m: metas[i], i }));
  const nonP = items.filter(x => x.call !== 'P');
  const first = items.find(x => bidValue(x.call) >= 0);
  const ours = nonP.filter(x => sameSide(x.by, seat)), theirs = nonP.filter(x => !sameSide(x.by, seat));
  const lb = [...items].reverse().find(x => bidValue(x.call) >= 0) || null;
  const of = s => items.filter(x => x.by === s).map(x => x.m);
  const lho = nextSeat(seat), rho = nextSeat(p);
  const L = agg(of(lho)), R = agg(of(rho));
  const ourFirst = ours.length ? ours[0].i : prefix.length;
  const ctx = {
    prefix, seat, p, lho, rho, items, ours, theirs, first, lb,
    opener: first ? first.by : null, weOpened: !!first && sameSide(first.by, seat),
    mine: ours.filter(x => x.by === seat), pards: ours.filter(x => x.by === p),
    Me: agg(of(seat)), P: agg(of(p)), O: { mn: {}, lo: L.lo + R.lo }, L, R,
    iPH: items.some(x => x.by === seat && x.call === 'P' && x.i < ourFirst),
    pPH: items.some(x => x.by === p && x.call === 'P' && x.i < ourFirst),
    quiet: theirs.length === 0,
    rhoCall: prefix.length ? prefix[prefix.length - 1].call : null,
    legal: legalFor(prefix, seat),
    vul: vul || 'None', weVul: !!vul && isVul(vul, seat), theyVul: !!vul && isVul(vul, nextSeat(seat)), metas,
  };
  for (const s of SUITS) ctx.O.mn[s] = Math.max(L.mn[s], R.mn[s]);
  ctx.seq = ctx.ours.map(x => x.call);
  ctx.gf = ours.some(x => x.m && x.m.f === 2);
  // our strong 2♣ opening forces to game once they have come in
  if (!ctx.quiet && ctx.first && ctx.first.call === '2C' && sameSide(ctx.first.by, seat) && ctx.first.m && ctx.first.m.art && !BID_OFF('int2c')) ctx.gf = true;
  ctx.pLast = ctx.pards[ctx.pards.length - 1] || null;
  ctx.myLast = ctx.mine[ctx.mine.length - 1] || null;
  ctx.forced = !!ctx.pLast && ctx.pLast.m && ctx.pLast.m.f >= 1 && (ctx.rhoCall === 'P' || ctx.rhoCall === 'X') && !items.some(x => x.by === seat && x.i > ctx.pLast.i);
  ctx.cheap = st => { const v = lb ? bidValue(lb.call) : -1; for (let l = 1; l <= 7; l++) if (bidValue(l + st) > v) return l; return 8; };
  ctx.ok = c => ctx.legal.includes(c);
  ctx.oppSuits = SUITS.filter(s => ctx.O.mn[s] >= 4 || theirs.some(x => bidValue(x.call) >= 0 && x.call[1] === s && !(x.m && x.m.art)));
  // agreed trump: the latest call that agreed one, else a known 8-card fit (majors first)
  let agree = null;
  for (const x of ours) if (x.m && x.m.agree) agree = x.m.agree;
  if (!agree) for (const s of ['S', 'H', 'D', 'C']) if (ctx.Me.mn[s] + ctx.P.mn[s] >= 8 && ctx.Me.mn[s] >= 3 && ctx.P.mn[s] >= 3) { agree = s; break; }
  ctx.agree = agree;
  return ctx;
}
const ourGame = ctx => { const lb = ctx.lb; return lb && sameSide(lb.by, ctx.seat) && +lb.call[0] >= gameLevel(lb.call[1]); };

// ---- Doubles: what they mean is fixed by the auction ----
function dblMeaning(ctx) {
  const lb = ctx.lb, lv = +lb.call[0], st = lb.call[1];
  const unbidM = ['H', 'S'].filter(s => !ctx.ours.some(x => bidValue(x.call) >= 0 && x.call[1] === s && !(x.m && x.m.art)) && !ctx.oppSuits.includes(s));
  const theirMeta = lb.m || ANY();
  const ourBids = ctx.ours.filter(x => bidValue(x.call) >= 0);
  if (theirMeta.art && st !== 'N' && lv <= 3 && !(theirMeta.mn[st] >= 2) && lb.by === ctx.rho) return MM(6, 37, { mn: { [st]: 5 }, a: `Lead-directing: good ${SNAME[st]}`, t: 'xlead' });
  if (ctx.ours.some(x => x.call === 'XX')) return MM(8, 37, { mn: st === 'N' ? {} : { [st]: 4 }, a: 'Penalty', t: 'xpen' });
  if (st === 'N') {
    if (!ourBids.length && lv === 1 && ctx.first && ctx.first.call === '1N' && ctx.first === lb) return MM(15, 37, { a: 'Penalty: 15+ points', t: 'xpen' });
    return MM(10, 37, { a: lv >= 3 ? 'Penalty: expects to beat the contract' : 'Penalty', t: 'xpen' });
  }
  const balancing = ctx.prefix.length >= 3 && ctx.rhoCall === 'P' && ctx.prefix[ctx.prefix.length - 2].call === 'P' && lb.by === ctx.lho;
  // our side has not bid yet: takeout
  if (!ourBids.length && !ctx.ours.some(x => x.call === 'X') && lv <= 4 && !(lv === 4 && st === 'S')) {
    return MM(balancing ? 9 : lv >= 3 ? 13 : 12, 37, { mx: { [st]: 2 }, mn: Object.fromEntries(unbidM.map(s => [s, 3])), a: 'Takeout double', t: 'xto' });
  }
  // partner opened a suit, they overcalled, my first action: negative
  const pOpen = ctx.first && ctx.first.by === ctx.p && /^[1][CDHS]$|^[1][CDHS]$/.test(ctx.first.call);
  if (pOpen && !ctx.mine.length && ourBids.length === 1 && lv <= 3 && !(lv === 3 && st === 'S' && false) && ctx.theirs.length && ctx.theirs.every(x => x.call !== 'X') && bidValue(lb.call) <= bidValue('3S')) {
    const mn = {}; unbidM.forEach(s => { mn[s] = 4; });
    const what = unbidM.length === 2 ? '4+ cards in both majors' : unbidM.length ? `4+ ${SNAME[unbidM[0]]}` : 'values, length in the minors';
    return MM(lv === 1 ? 6 : lv === 2 ? 8 : 10, 37, { mn, mx: { [st]: 3 }, a: `Negative double: ${what}`, t: 'xneg' });
  }
  // partner made a takeout double, they raised: responsive
  const pX = ctx.pLast && ctx.pLast.call === 'X' && ctx.pLast.m && ctx.pLast.m.tag === 'xto';
  if (pX && !ctx.mine.length && !ourBids.length && lv <= 3 && ctx.theirs.filter(x => bidValue(x.call) >= 0 && x.call[1] === st).length >= 2)
    return MM(lv === 2 ? 7 : 9, 37, { mx: { [st]: 3 }, a: 'Responsive double: values, no clear suit to bid', t: 'xresp' });
  // partner overcalled, they raised: responsive too (the two unbid suits, no fit for partner)
  const pO = ctx.pLast && ctx.pards.length === 1 && bidValue(ctx.pLast.call) >= 0 && ctx.pLast.m && ctx.pLast.m.tag === 'ovc';
  if (pO && !BID_OFF('resp2') && !ctx.mine.some(x => x.call !== 'P') && ourBids.length === 1 && lv <= 3 && lb.by === ctx.rho && ctx.theirs.filter(x => bidValue(x.call) >= 0 && x.call[1] === st).length >= 2) {
    const ps = ctx.pLast.call[1], two = SUITS.filter(s => s !== st && s !== ps);
    return MM(8, 37, { mx: { [ps]: 2 }, mn: Object.fromEntries(two.map(s => [s, 4])), a: `Responsive double: ${SNAME[two[0]]} and ${SNAME[two[1]]}, no fit for ${SNAME[ps]}`, t: 'xresp' });
  }
  // I opened, they overcalled and it came back to me: reopening double
  if (ctx.first && ctx.first.by === ctx.seat && ourBids.length === 1 && ctx.pards.length === 0 && lv <= 2 && ctx.rhoCall === 'P' && lb.by === ctx.lho && ctx.theirs.length === 1)
    return MM(12, 37, { mx: { [st]: 2 }, a: 'Reopening double: takeout, short in their suit', t: 'xreopen' });
  // I opened, partner passed, RHO came in: takeout with a strong hand
  if (!BID_OFF('xstrong') && ctx.first && ctx.first.by === ctx.seat && ourBids.length === 1 && ctx.pards.length === 0 && lv <= 2 && lb.by === ctx.rho && ctx.theirs.length === 1 && ctx.mine.length === 1)
    return MM(16, 37, { mx: { [st]: 2 }, a: 'Takeout double: strong hand (16+), short in their suit', t: 'xreopen' });
  return MM(10, 37, { mn: { [st]: 3 }, a: lv >= 3 ? 'Penalty: expects to beat the contract' : 'Penalty', t: 'xpen' });
}

// ---- 4NT: Roman Key Card Blackwood (1430) or quantitative ----
function fourNTMeaning(ctx) {
  const ourBids = ctx.ours.filter(x => bidValue(x.call) >= 0);
  if (!ourBids.length) return MM(8, 37, { a: 'Two lowest unbid suits', t: 'unusual4', art: true });
  let tr = ctx.agree;
  const pl = [...ctx.pards].reverse().find(x => bidValue(x.call) >= 0);
  if (!tr && pl && pl.call[1] === 'N' && !(pl.m && pl.m.art)) return MM(0, 37, { a: 'Quantitative: invites 6NT', t: 'quant' });
  if (!tr) { const nat = [...ourBids].reverse().find(x => x.call[1] !== 'N' && !(x.m && x.m.art)); tr = nat ? nat.call[1] : null; }
  if (!tr) return MM(0, 37, { a: 'Quantitative: invites 6NT', t: 'quant' });
  return MM(0, 37, { a: `Roman Key Card Blackwood (1430) for ${SNAME[tr]}: asks for key cards (4 aces and the trump king)`, t: 'rkcb', trump: tr, art: true, f: 1 });
}

// ---- Calls the robots never make, read by their usual natural meaning (a human partner's) ----
// A responder's jump shift is strong and game forcing (weak in competition), a double jump preemptive; 1M-3NT is
// 13-15 balanced; a three-level suit over our 1NT is natural (a major forces to game, a minor invites 3NT);
// opener's jump shift forces to game; after 1M-2M opener's new suit (or 2NT) is a game try.
function humanMean(ctx, call) {
  if (BID_OFF('hum') || !ctx.first || bidValue(call) < 0) return null;
  const lv = +call[0], st = call[1], jump = lv - ctx.cheap(st), op = ctx.first, t = op.call[1];
  const myBids = ctx.mine.filter(x => bidValue(x.call) >= 0);
  const ourSuit = ctx.ours.some(x => bidValue(x.call) >= 0 && x.call[1] === st && !(x.m && x.m.art));
  const theyOnce = ctx.theirs.length === 1 && ctx.theirs[0].by === ctx.rho && ctx.rhoCall !== 'P';
  // their suit, which our side has not bid or shown: a cue bid, strong and forcing (says nothing about the suit)
  if (st !== 'N' && ctx.theirs.some(x => bidValue(x.call) >= 0 && x.call[1] === st && !(x.m && x.m.art)) && !ourSuit && !ctx.Me.mn[st] && !ctx.P.mn[st] && lv < gameLevel(st) && !BID_OFF('humcue'))
    return MM(ctx.mine.length ? Math.max(ctx.Me.lo, 13) : 13, 37, { art: true, f: 1, a: 'Cue bid: a strong hand, forcing', t: 'hcue' });
  if (!ctx.weOpened) { // partner's overcall, my first call: a jump raise is preemptive
    const pl = ctx.pLast;
    if (pl && ctx.pards.length === 1 && bidValue(pl.call) >= 0 && pl.m && pl.m.tag === 'ovc' && !ctx.mine.length && st === pl.call[1] && jump === 1 && lv < gameLevel(st)) return MM(0, 9, { mn: { [st]: 4 }, agree: st, t: 'pre' });
    return null;
  }
  if (op.by === ctx.p && /^1[CDHS]$/.test(op.call) && !ctx.mine.length && ctx.pards.length === 1 && !ctx.iPH && lv <= 3) { // responder's first call
    if (st === t && jump === 1 && theyOnce) return MM(3, 9, { mn: { [st]: MIN(st) ? 5 : 4 }, agree: st, t: 'pre' });
    if (st !== 'N' && st !== t && !ctx.oppSuits.includes(st)) {
      if (jump === 1 && ctx.quiet) return MM(17, 37, { mn: { [st]: 5 }, f: 2, a: 'Jump shift: 17+ points, game forcing', t: 'jsr' });
      if (jump === 1 && theyOnce) return MM(3, 9, { mn: { [st]: 6 }, t: 'pre' });
      if (jump === 2 && ctx.quiet) return MM(3, 9, { mn: { [st]: 6 }, t: 'pre' });
    }
    if (call === '3N' && MAJ(t) && ctx.quiet) return MM(13, 15, { bal: true, nt: true });
    if (call === '2N' && MIN(t) && ctx.rhoCall === 'X' && ctx.theirs.length === 1) return MM(10, 37, { mn: { [t]: 4 }, agree: t, art: true, f: 1, a: `Jordan 2NT: 4+ ${SNAME[t]}, limit raise or better`, t: 'jordan' });
  }
  if (!ctx.quiet) return null;
  const nb = ntBase(ctx);
  if (nb && nb.k === 0 && !nb.interfered && nb.x.by === ctx.p && !ctx.mine.length && lv === 3 && st !== 'N' && (nb.x.call === '1N' || MAJ(st))) { // natural over our 1NT/2NT
    const lo = nb.x.m.lo;
    return MAJ(st) ? MM(Math.max(0, 25 - lo), 37, { mn: { [st]: 5 }, f: 2 }) : MM(Math.max(0, 23 - lo), Math.max(0, 24 - lo), { mn: { [st]: 6 }, inv: true });
  }
  if (op.by === ctx.seat && /^1[CDHS]$/.test(op.call) && myBids.length === 1 && ctx.pards.length === 1 && bidValue(ctx.pards[0].call) >= 0 && !ctx.gf) { // opener's second call
    const pm = ctx.pards[0].m || ANY();
    if (MAJ(t) && ctx.pards[0].call === '2' + t && pm.tag === 'raise' && bidValue(call) < bidValue('3' + t) && st !== t)
      return st === 'N' ? MM(16, 18, { f: 1, inv: true, a: 'Invites game', t: 'hsgt' })
        : MM(16, 18, { mn: { [st]: 3 }, f: 1, inv: true, a: `Invites game: asks for help in ${SNAME[st]} (help-suit game try)`, t: 'hsgt' });
    if (st !== 'N' && !ourSuit && jump === 1 && lv <= 3 && !pm.art) return MM(18, 37, { mn: { [st]: 4 }, f: 2, a: 'Jump shift: 18+ points, game forcing', t: 'jso' });
  }
  return null;
}

// ---- Natural meaning of a call no table covers ----
function natMean(ctx, call) {
  if (call === 'P') return ANY();
  if (call === 'X') return dblMeaning(ctx);
  if (call === 'XX') return MM(10, 37, { a: 'Redouble: 10+ points', t: 'xx' });
  if (call === '4N') return fourNTMeaning(ctx);
  const lv = +call[0], st = call[1], Me = ctx.Me, P = ctx.P;
  const pBid = ctx.pards.some(x => bidValue(x.call) >= 0 && !(x.m && x.m.art));
  const myBids = ctx.mine.filter(x => bidValue(x.call) >= 0);
  const hm = humanMean(ctx, call); if (hm) return hm;
  if (st === 'N') {
    const lo = myBids.length || pBid ? Me.lo : lv === 1 ? 8 : lv === 2 ? 12 : 13;
    return MM(lo, 37, { nt: true, stop: ctx.oppSuits });
  }
  const cm = ctlBidMeaning(ctx, call); if (cm) return cm;
  const pShown = P.mn[st] >= 3;
  // game forcing, a cheap raise of partner's major when game was there to bid: slam interest (fast arrival)
  if (pShown && (MAJ(st) || (lv >= 3 && !BID_OFF('slowm'))) && !BID_OFF('slow') && ctx.quiet && ctx.gf && !ourGame(ctx) && lv === ctx.cheap(st) && lv < gameLevel(st) && ctx.ok(gameLevel(st) + st) && !ctx.ours.some(x => x.m && x.m.agree === st) && pBid)
    return MM(Me.lo + 3, 37, { mn: { [st]: Math.max(3, 8 - P.mn[st]) }, agree: st, f: 2, t: 'slow' });
  if (pShown) return MM(Me.lo, 37, { mn: { [st]: Math.max(3, 8 - P.mn[st]) }, agree: st });
  if (myBids.some(x => x.call[1] === st && !(x.m && x.m.art))) return MM(Me.lo, 37, { mn: { [st]: Math.min(7, Math.max(Me.mn[st] + 1, 6)) } });
  const lo = myBids.length ? Me.lo : pBid ? (lv >= 2 ? 10 : 6) : (lv >= 2 ? 10 : 8);
  return MM(lo, 37, { mn: { [st]: pBid || myBids.length ? 4 : 5 } });
}

// ---- Tables ----
const T_ = (c, w, m) => ({ c, w, m });
function openingTable(ctx) {
  const pos = ctx.prefix.length + 1, T = [];
  const r20 = h => h.H + h.sh[0] + h.sh[1];
  const opens = h => pos <= 2 ? (h.H >= 12 || (h.H >= 10 && r20(h) >= 20)) : pos === 3 ? (h.H >= 11 || (h.H >= 10 && r20(h) >= 19)) : (h.H >= 11 && h.H + h.L.S >= 15);
  T.push(T_('2C', h => h.H >= 22 || (h.H >= 18 && ltc(h) <= 3 && !h.bal), MM(19, 37, { f: 1, art: true, a: 'Strong and artificial: 22+ points or 9+ playing tricks', t: '2C' })));
  T.push(T_('2N', h => h.bal && h.H >= 20 && h.H <= 21, MM(20, 21, { bal: true, nt: true, a: '20-21 points, balanced', t: 'nt' })));
  T.push(T_('1N', h => h.bal && h.H >= 15 && h.H <= 17, MM(15, 17, { bal: true, nt: true, a: '15-17 points, balanced', t: 'nt' })));
  T.push(T_('1S', h => opens(h) && h.L.S >= 5 && h.L.S >= h.L.H, MM(11, 21, { mn: { S: 5 } })));
  T.push(T_('1H', h => opens(h) && h.L.H >= 5, MM(11, 21, { mn: { H: 5 }, mx: { S: 5 } })));
  T.push(T_('1D', h => opens(h) && (h.L.D > h.L.C || (h.L.D === h.L.C && h.L.D >= 4)), MM(11, 21, { mn: { D: 3 }, mx: { H: 4, S: 4 } })));
  T.push(T_('1C', h => opens(h), MM(11, 21, { mn: { C: 3 }, mx: { H: 4, S: 4 } })));
  if (pos <= 3) {
    const otherOK = (h, s) => !MAJ(s) || h.L[otherM(s)] <= 3;
    const vk = vulK(ctx, 'vpre'), pq = (h, s) => hon(h, s, 'AKQ') >= 1; // favourable vulnerability: a point lighter (sounder when vulnerable measured worse)
    const w27 = !BID_OFF('w27'); // a seven-card suit too weak for the three level (fewer than 3 honour points in it) opens a weak two
    for (const s of ['S', 'H', 'D']) T.push(T_('2' + s, h => h.L[s] === 6 && h.H >= (vk < 0 ? 4 : 5) && h.H <= 10 && h.sp[s] >= 3 && pq(h, s) && otherOK(h, s), MM(5, 10, { mn: { [s]: 6 }, mx: { [s]: w27 ? 7 : 6 }, a: `Weak two: 6${w27 ? ' (rarely 7)' : ''} ${SNAME[s]}, 5-10 points`, t: 'weak2' })));
    if (w27) for (const s of ['S', 'H', 'D']) T.push(T_('2' + s, h => h.L[s] === 7 && h.H >= 5 && h.H <= 9 && h.sp[s] < 3 && hon(h, s, 'AKQJ') >= 1 && otherOK(h, s), MM(5, 10, { mn: { [s]: 6 }, mx: { [s]: 7 }, t: 'weak2' })));
    for (const s of ['S', 'H']) T.push(T_('4' + s, h => h.L[s] >= 8 && h.H <= 11, MM(4, 11, { mn: { [s]: 8 }, t: 'pre' })));
    // not vulnerable, 3♣ also on a good six-card suit (there is no weak 2♣), without a four-card major
    if (!BID_OFF('p6c')) T.push(T_('3C', h => h.L.C === 6 && h.sh[1] <= 4 && h.H >= 5 && h.H <= 9 && h.sp.C >= 4 && vk <= 0 && h.L.H < 4 && h.L.S < 4, MM(5, 10, { mn: { C: 6 }, t: 'pre' })));
    for (const s of ['S', 'H', 'D', 'C']) T.push(T_('3' + s, h => h.L[s] >= 7 && h.H >= (vk < 0 ? 4 : 5) && h.H <= 10 && h.sp[s] >= 3, MM(5, 10, { mn: { [s]: 7 }, t: 'pre' })));
  }
  T.push(T_('P', () => true, MM(0, pos === 4 ? 14 : 11)));
  return T;
}

function splinterCall(t, s) { // double jump in a new suit
  if (t === 'H') return s === 'S' ? '3S' : '4' + s;
  return '4' + s;
}
function resp1M(ctx) {
  const t = ctx.seq[0][1], ph = ctx.iPH, T = [];
  const gfOK = h => !ph && (h.H >= 13 || (h.H >= 12 && h.sh[0] >= 6));
  if (!ph) {
    for (const s of SUITS.filter(x => x !== t)) T.push(T_(splinterCall(t, s), h => h.L[t] >= 4 && h.L[s] <= 1 && h.H >= 11 && h.H <= 15,
      MM(11, 15, { mn: { [t]: 4 }, mx: { [s]: 1 }, f: 2, art: true, agree: t, a: `Splinter: 4+ ${SNAME[t]}, game values, singleton or void in ${SNAME[s]}`, t: 'splinter', short: s })));
    T.push(T_('2N', h => h.L[t] >= 4 && h.H >= 13, MM(13, 37, { mn: { [t]: 4 }, f: 2, art: true, agree: t, a: `Jacoby 2NT: 4+ ${SNAME[t]}, game forcing`, t: 'jacoby' })));
  }
  T.push(T_('4' + t, h => (h.L[t] >= 5 && h.H <= 9 && h.H >= 3 && (h.sh[3] <= 1 || h.L[t] >= 6)) || (ph && h.L[t] >= 3 && supPts(h, t) >= 13), MM(3, 12, { mn: { [t]: 4 }, agree: t, t: 'pre' })));
  T.push(T_('3' + t, h => (h.L[t] >= 4 || (ph && h.L[t] >= 3)) && supPts(h, t) >= 10 && h.H <= 12 && h.H >= 8, MM(8, 12, { mn: { [t]: ph ? 3 : 4 }, agree: t, inv: true, t: 'limit', a: 'Limit raise: invites game' })));
  T.push(T_('2' + t, h => h.L[t] >= 3 && supPts(h, t) >= 6 && supPts(h, t) <= 10 && h.H >= 4 && h.H <= 10, MM(4, 10, { mn: { [t]: 3 }, agree: t, t: 'raise' })));
  if (t === 'H') {
    for (const m of ['D', 'C']) T.push(T_('2' + m, h => gfOK(h) && h.L[m] >= 5 && h.L[m] > h.L.S && h.L[m] >= h.L[m === 'D' ? 'C' : 'D'], MM(12, 37, { mn: { [m]: m === 'C' ? 3 : 4 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
    T.push(T_('2C', h => gfOK(h) && h.L.H >= 3 && h.L.C >= 3 && h.L.C >= h.L.D, MM(12, 37, { mn: { C: 3 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
    T.push(T_('2D', h => gfOK(h) && h.L.H >= 3 && h.L.D >= 4, MM(12, 37, { mn: { D: 4 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
    T.push(T_('1S', h => h.L.S >= 4 && h.H >= 6, MM(6, 37, { mn: { S: 4 }, f: 1, t: 'new1' })));
  }
  if (t === 'S') T.push(T_('2H', h => gfOK(h) && h.L.H >= 5 && h.L.H >= h.L.D && h.L.H >= h.L.C, MM(12, 37, { mn: { H: 5 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
  T.push(T_('2D', h => gfOK(h) && h.L.D >= 4 && (h.L.D > h.L.C || (h.L.D === h.L.C && h.L.D >= 4)), MM(12, 37, { mn: { D: 4 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
  T.push(T_('2C', h => gfOK(h) && h.L.C >= 3, MM(12, 37, { mn: { C: 3 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
  if (ph) {
    for (const s of ['H', 'D', 'C']) if (bidValue('2' + s) > bidValue('1' + t) || s !== 'H') {
      if (s === 'H' && t === 'H') continue;
      T.push(T_('2' + s, h => h.H >= 9 && h.L[s] >= 6 && goodSuit(h, s) && h.L[t] <= 2, MM(9, 11, { mn: { [s]: 6 } })));
    }
    T.push(T_('2N', h => h.H >= 11 && h.bal && h.L[t] <= 2, MM(11, 12, { bal: true, nt: true, mx: { [t]: 2 } })));
  }
  T.push(T_('1N', h => h.H >= 6, ph ? MM(6, 11, { mx: { [t]: 3, ...(t === 'H' ? { S: 3 } : {}) }, t: '1NPH' })
    : MM(6, 12, { mx: { [t]: 3, ...(t === 'H' ? { S: 3 } : {}) }, f: 1, a: 'Forcing one round: 6-12 points', t: '1NF' })));
  T.push(T_('P', () => true, MM(0, 5)));
  return T;
}
function resp1m(ctx) {
  const t = ctx.seq[0][1], ph = ctx.iPH, T = [];
  const noM = h => h.L.H < 4 && h.L.S < 4;
  if (t === 'D') T.push(T_('2C', h => !ph && h.H >= 13 && (h.L.C >= 5 || (h.L.C >= 4 && noM(h))) && !(h.L.H >= 4 && h.L.C < 5) && !(h.L.S >= 4 && h.L.C < 5), MM(12, 37, { mn: { C: 4 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
  if (t === 'C') T.push(T_('1D', h => h.H >= 6 && h.L.D >= 5 && h.L.D > Math.max(h.L.H, h.L.S) && (h.H >= 12 || h.L.D >= 6) && !(MAJ(longest(h)) && false), MM(6, 37, { mn: { D: 4 }, f: 1 })));
  T.push(T_('1H', h => h.H >= 6 && h.L.H >= 4 && (h.L.H > h.L.S || (h.L.H === 4 && h.L.S === 4)), MM(6, 37, { mn: { H: 4 }, f: 1, t: 'new1' })));
  T.push(T_('1S', h => h.H >= 6 && h.L.S >= 4, MM(6, 37, { mn: { S: 4 }, f: 1, t: 'new1' })));
  if (t === 'C') T.push(T_('1D', h => h.H >= 6 && h.L.D >= 4 && !(h.bal && h.L.D === 4 && h.H <= 10 && h.L.C >= 3 && false), MM(6, 37, { mn: { D: 4 }, f: 1 })));
  const need = t === 'C' ? 5 : 4;
  T.push(T_('3' + t, h => noM(h) && h.L[t] >= need && h.H >= 10 && h.H <= 12 && !h.bal, MM(10, 12, { mn: { [t]: need }, agree: t, inv: true, t: 'limit', a: 'Limit raise: invites game' })));
  T.push(T_('2' + t, h => noM(h) && h.L[t] >= need && h.H >= 6 && h.H <= 10 && !(h.bal && h.H >= 8), MM(6, 10, { mn: { [t]: need }, agree: t, t: 'raise' })));
  T.push(T_('2N', h => noM(h) && h.H >= 11 && h.H <= 12 && h.semi, MM(11, 12, { bal: true, nt: true, inv: true, mx: { H: 3, S: 3 } })));
  T.push(T_('3N', h => noM(h) && h.H >= 13 && h.H <= 15 && h.semi, MM(13, 15, { bal: true, nt: true, mx: { H: 3, S: 3 } })));
  T.push(T_('1N', h => h.H >= 6 && h.H <= 10, MM(6, 10, { nt: true, mx: { H: 3, S: 3 } })));
  if (t === 'D') T.push(T_('2C', h => !ph && h.H >= 11 && h.L.C >= 3, MM(12, 37, { mn: { C: 4 }, f: 2, a: 'Two over one: game forcing', t: '21' })));
  if (!BID_OFF('r6n')) T.push(T_('6N', h => noM(h) && h.H >= (BID_K('r6n') ?? 19), MM(BID_K('r6n') ?? 19, 37, { nt: true, mx: { H: 3, S: 3 } }))); // slam values (3NT had no upper limit)
  T.push(T_('3N', h => h.H >= 11, MM(13, 15, { bal: true, nt: true, mx: { H: 3, S: 3 } })));
  T.push(T_('P', () => true, MM(0, 5)));
  return T;
}
function longest(h, ex = []) { let b = null; for (const s of ['S', 'H', 'D', 'C']) if (!ex.includes(s) && (!b || h.L[s] > h.L[b])) b = s; return b; }

// opener's rebid after 1M - 1NT
function reb1M1N(ctx) {
  const t = ctx.seq[0][1], forcing = !ctx.pPH, T = [];
  T.push(T_('4' + t, h => h.L[t] >= 6 && h.H + h.lp >= 19, MM(17, 21, { mn: { [t]: 6 } })));
  T.push(T_('3' + t, h => h.L[t] >= 6 && h.H + h.lp >= 16, MM(15, 18, { mn: { [t]: 6 }, inv: true })));
  T.push(T_('2N', h => h.bal && h.H >= 18, MM(18, 19, { bal: true, nt: true })));
  for (const m of ['C', 'D']) T.push(T_('3' + m, h => h.L[m] >= 4 && h.H >= 18 && !h.bal, MM(18, 21, { mn: { [m]: 4 }, f: 2 })));
  if (t === 'H') T.push(T_('2S', h => h.L.S >= 4 && h.H >= 16, MM(16, 21, { mn: { S: 4 }, f: 1, t: 'reverse' })));
  if (t === 'S') T.push(T_('2H', h => h.L.H >= 4, MM(11, 18, { mn: { H: 4 } })));
  T.push(T_('2' + t, h => h.L[t] >= 6, MM(11, 15, { mn: { [t]: 6 } })));
  if (!forcing) T.push(T_('P', h => h.bal && h.H <= 14, MM(11, 14, { bal: true })));
  T.push(T_('2D', h => h.L.D >= 3 && h.L.D > h.L.C, MM(11, 18, { mn: { D: 3 } })));
  T.push(T_('2C', h => h.L.C >= 3, MM(11, 18, { mn: { C: 3 } })));
  T.push(T_('2D', h => h.L.D >= 3, MM(11, 18, { mn: { D: 3 } })));
  T.push(T_('2' + t, () => true, MM(11, 15, { mn: { [t]: 5 } })));
  return T;
}
function resp1M1N(ctx) { // responder after 1M - 1NT - rebid
  const t = ctx.seq[0][1], r = ctx.seq[2], T = [], st = r[1];
  if (r === '2C' || r === '2D') {
    T.push(T_('3' + t, h => h.L[t] === 3 && supPts(h, t) >= 10, MM(10, 12, { mn: { [t]: 3 }, inv: true, agree: t, a: '3-card limit raise' })));
    T.push(T_('2N', h => h.H >= 11 && h.L[t] <= 2, MM(11, 12, { nt: true, inv: true })));
    T.push(T_('3' + st, h => h.L[st] >= 5 && h.H >= 10 && h.L[t] <= 2, MM(10, 12, { mn: { [st]: 5 }, inv: true, agree: st })));
    for (const s of ['D', 'H']) if (bidValue('2' + s) > bidValue(r) && s !== t) T.push(T_('2' + s, h => h.L[s] >= 6 && h.H <= 10 && h.L[t] <= 2, MM(6, 10, { mn: { [s]: 6 } })));
    for (const s of ['C', 'D', 'H']) if (s !== st && s !== t && bidValue('3' + s) > bidValue('3' + st) - 5) {
      if (bidValue('2' + s) > bidValue(r)) continue; // the two-level bid is available: jumps to 3 are invitational
      T.push(T_('3' + s, h => h.L[s] >= 6 && goodSuit(h, s) && h.H >= 9 && h.L[t] <= 2, MM(9, 12, { mn: { [s]: 6 }, inv: true })));
    }
    T.push(T_('P', h => h.L[st] >= 4 && h.L[t] <= 1 && h.H <= 9, MM(6, 9, { mn: { [st]: 4 } })));
    T.push(T_('P', h => h.L[st] >= 5 && h.L[t] <= 2 && h.H <= 9, MM(6, 9, { mn: { [st]: 4 } })));
    T.push(T_('2' + t, () => true, MM(6, 10, { mn: { [t]: 2 } })));
    return T;
  }
  if (r === '2H' && t === 'S') {
    T.push(T_('4H', h => h.L.H >= 4 && supPts(h, 'H') >= 12, MM(10, 12, { mn: { H: 4 }, agree: 'H' })));
    T.push(T_('3H', h => h.L.H >= 4 && supPts(h, 'H') >= 9, MM(8, 11, { mn: { H: 4 }, agree: 'H', inv: true })));
    T.push(T_('3S', h => h.L.S === 3 && supPts(h, 'S') >= 10, MM(10, 12, { mn: { S: 3 }, agree: 'S', inv: true, a: '3-card limit raise' })));
    T.push(T_('2N', h => h.H >= 11, MM(11, 12, { nt: true, inv: true })));
    T.push(T_('P', h => h.L.H >= 4 || (h.L.H === 3 && h.L.S <= 1), MM(6, 8, { mn: { H: 3 } })));
    T.push(T_('2S', () => true, MM(6, 10, { mn: { S: 2 } })));
    return T;
  }
  if (r === '2' + t) {
    T.push(T_('4' + t, h => (h.L[t] >= 2 && h.H >= 11) || (h.L[t] >= 3 && supPts(h, t) >= 11), MM(11, 12, { agree: t })));
    T.push(T_('3' + t, h => h.L[t] >= 2 && h.H >= 10, MM(10, 11, { inv: true, agree: t })));
    T.push(T_('2N', h => h.H >= 11 && h.L[t] <= 1, MM(11, 12, { nt: true, inv: true })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  if (r === '3' + t) {
    T.push(T_('4' + t, h => h.H >= 8 || (h.L[t] >= 2 && h.H >= 7), MM(7, 12, { agree: t })));
    T.push(T_('3N', h => h.H >= 9 && h.L[t] <= 1, MM(9, 12)));
    T.push(T_('P', () => true, MM(6, 7)));
    return T;
  }
  if (r === '2N') {
    T.push(T_('4' + t, h => h.L[t] >= 3, MM(6, 12, { agree: t })));
    T.push(T_('3N', () => true, MM(6, 12)));
    return T;
  }
  return null;
}
function reb1M2M(ctx) { // 1M - 2M
  const t = ctx.seq[0][1];
  return [T_('4' + t, h => ownPts(h, t) >= 19, MM(17, 21)), T_('3' + t, h => ownPts(h, t) >= 16, MM(15, 18, { inv: true, a: 'Invites game' })), T_('P', () => true, MM(11, 15))];
}
function acceptInv(ctx, game, mid) { // partner invited: accept with the top half of what I showed
  return [T_(game, h => h.H + h.lp >= mid || supPts(h, game[1]) >= mid + 1, ANY()), T_('P', () => true, ANY())];
}
function gameTryAnswer(ctx) { // 1M - 2M - opener's game try (a new suit or 2NT): game with a maximum or help in that suit
  const t = ctx.seq[0][1], s = ctx.pLast.call[1];
  const losers = h => s === 'N' ? 0 : Math.min(3, h.L[s]) - ['A', 'K', 'Q'].slice(0, Math.min(3, h.L[s])).filter(r => h.has[s].includes(r)).length;
  return [T_('4' + t, h => supPts(h, t) >= 8 || (supPts(h, t) >= 6 && (s === 'N' ? h.H >= 7 : losers(h) <= 1)), MM(6, 10, { agree: t })), T_('3' + t, () => true, MM(4, 7, { agree: t, t: 'signoff' }))];
}
function reb1MJ(ctx) { // 1M - 2NT Jacoby
  const t = ctx.seq[0][1], T = [];
  for (const s of SUITS.filter(x => x !== t)) T.push(T_('3' + s, h => h.L[s] <= 1, MM(11, 21, { mx: { [s]: 1 }, art: true, agree: t, a: `Shortness: singleton or void in ${SNAME[s]}`, t: 'jshort' })));
  T.push(T_('3' + t, h => h.H >= 17, MM(17, 21, { art: true, agree: t, a: '17+ points, no shortness, slam interest' })));
  T.push(T_('3N', h => h.H >= 14, MM(14, 16, { art: true, agree: t, a: '14-16 points, no shortness' })));
  T.push(T_('4' + t, () => true, MM(11, 13, { agree: t, a: 'Minimum, no shortness', t: 'signoff' })));
  return T;
}
function openSuits(ctx, h, tr) { // side suits with two fast losers in my hand that partner hasn't shown
  if (ctx.P.bal && ctx.P.lo >= 15) return 0;
  return SUITS.filter(s => s !== tr && h.L[s] >= 2 && !h.has[s].includes('A') && !h.has[s].includes('K') && ctx.P.mn[s] < 4 && ctx.P.mx[s] > 1).length;
}
function respJ2N2(ctx) { // responder after 1M - 2NT - opener's rebid
  const t = ctx.seq[0][1], r = ctx.seq[2], T = [];
  const om = ctx.pLast.m;
  const rk = h => {
    if (openSuits(ctx, h, t)) return false;
    if (om.tag === 'jshort') { const s = Object.keys(om.mx)[0]; const waste = h.sp[s] - (h.has[s].includes('A') ? 4 : 0); return h.H - waste >= 16 - SD(); }
    return h.H + om.lo >= 32 - SD();
  };
  if (bidValue('4N') > bidValue(r)) T.push(T_('4N', rk, MM(13, 37, { t: 'rkcb', trump: t, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[t]}: asks for key cards (4 aces and the trump king)` })));
  if (r !== '4' + t) T.push(T_('4' + t, () => true, MM(13, 15, { t: 'signoff' })));
  T.push(T_('P', () => true, ANY()));
  return T;
}
function rebSplinter(ctx) {
  const t = ctx.seq[0][1], s = ctx.pLast.m.short || Object.keys(ctx.pLast.m.mx)[0];
  const useful = h => h.H - (h.sp[s] - (h.has[s].includes('A') ? 4 : 0));
  return [
    T_('4N', h => useful(h) >= 15 - SD() && openSuits(ctx, h, t) === 0 && keycards(h, t) >= 2, MM(15, 21, { t: 'rkcb', trump: t, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[t]}: asks for key cards (4 aces and the trump king)` })),
    T_('4' + t, () => true, MM(11, 17, { t: 'signoff' })),
  ];
}
function reb21(ctx) { // opener after 1x - 2y (game forcing)
  const t = ctx.seq[0][1], c1 = ctx.seq[1], r = c1[1], T = [];
  if (MAJ(r)) T.push(T_('3' + r, h => h.L[r] >= 3, MM(11, 21, { mn: { [r]: 3 }, agree: r })));
  T.push(T_('3' + t, h => MAJ(t) && h.L[t] >= 6 && hon(h, t, 'AKQJ') >= 3 && h.H >= 14, MM(14, 21, { mn: { [t]: 6 }, agree: t, a: 'Good 6+ card suit: sets trumps' })));
  for (const s of ['H', 'S', 'D']) if (s !== t && s !== r && bidValue('2' + s) > bidValue(c1)) T.push(T_('2' + s, h => h.L[s] >= 4 && !(MIN(r) && h.L[r] >= 4 && h.L[t] === 5 && !MAJ(s)), MM(11, 21, { mn: { [s]: 4 } })));
  if (MIN(r)) T.push(T_('3' + r, h => h.L[r] >= (r === 'C' ? 5 : 4) || (h.L[r] >= 4 && !h.semi), MM(11, 21, { mn: { [r]: 4 }, agree: r })));
  T.push(T_('2' + t, h => h.L[t] >= 6, MM(11, 21, { mn: { [t]: 6 } })));
  T.push(T_('2N', h => h.semi && h.H <= 14, MM(11, 14, { nt: true })));
  T.push(T_('3N', h => h.semi && h.H >= 18, MM(18, 19, { nt: true })));
  for (const s of ['C', 'D', 'H']) if (s !== t && s !== r && bidValue('3' + s) > bidValue(c1) && !(bidValue('2' + s) > bidValue(c1))) T.push(T_('3' + s, h => h.L[s] >= 4, MM(11, 21, { mn: { [s]: 4 } })));
  if (MIN(r)) T.push(T_('3' + r, h => h.L[r] >= 3 && !h.semi, MM(11, 21, { mn: { [r]: 3 }, agree: r })));
  T.push(T_('2' + t, () => true, MM(11, 21, { mn: { [t]: 5 } })));
  return T;
}
function reb1m(ctx) { // opener after 1m - response
  const t = ctx.seq[0][1], c1 = ctx.seq[1], T = [], r = c1[1];
  if (c1 === '1N') {
    T.push(T_('3N', h => h.semi && h.H >= 19, MM(19, 19)));
    T.push(T_('2N', h => h.semi && h.H >= 18, MM(18, 18, { inv: true })));
    T.push(T_('P', h => h.semi, MM(11, 14)));
    T.push(T_('3' + t, h => h.L[t] >= 6 && h.H >= 16, MM(16, 18, { mn: { [t]: 6 }, inv: true })));
    for (const s of ['H', 'S']) T.push(T_('2' + s, h => h.L[s] >= 4 && h.H >= 16 && h.L[t] >= 5, MM(16, 21, { mn: { [s]: 4 }, f: 1, t: 'reverse' })));
    if (t === 'D') T.push(T_('2C', h => h.L.C >= 4, MM(11, 17, { mn: { C: 4 } })));
    if (t === 'C') T.push(T_('2D', h => h.L.D >= 4 && h.H >= 16, MM(16, 21, { mn: { D: 4 }, f: 1, t: 'reverse' })));
    T.push(T_('2' + t, h => h.L[t] >= 6, MM(11, 15, { mn: { [t]: 6 } })));
    T.push(T_('P', () => true, MM(11, 15)));
    return T;
  }
  if (c1 === '2' + t) {
    T.push(T_('3N', h => h.H >= 18, MM(18, 21)));
    T.push(T_('2N', h => h.H >= 16 && h.semi, MM(16, 17, { inv: true })));
    T.push(T_('3' + t, h => h.H >= 16 && h.L[t] >= 5, MM(16, 18, { inv: true })));
    T.push(T_('P', () => true, MM(11, 15)));
    return T;
  }
  if (c1 === '3' + t) {
    T.push(T_('3N', h => h.H >= 14 && h.L[t] <= 5, MM(14, 21)));
    T.push(T_('5' + t, h => h.H + h.lp >= 16, MM(15, 21)));
    T.push(T_('P', () => true, MM(11, 14)));
    return T;
  }
  if (c1 === '2N') return [...(BID_OFF('q4') ? [] : [T_('4N', h => h.H >= 19 && h.semi, MM(19, 21, { t: 'quant', a: 'Quantitative: invites 6NT' }))]), T_('3N', h => h.H >= 13 || (h.H >= 12 && h.L[t] >= 6), MM(13, 18)), T_('3' + t, h => h.L[t] >= 6, MM(11, 12, { mn: { [t]: 6 } })), T_('P', () => true, MM(11, 12))];
  if (c1 === '3N') return BID_OFF('q4') ? [T_('P', () => true, ANY())] : [ // 13-15 balanced opposite: slam on combined points
    T_('6N', h => h.H >= 19, MM(19, 21)),
    T_('4N', h => h.H >= 17 && h.semi, MM(17, 18, { t: 'quant', a: 'Quantitative: invites 6NT' })),
    T_('P', () => true, ANY())];
  if (c1 === '2C' && t === 'D') return reb21(ctx);
  if (!/^1[DHS]$/.test(c1)) return null;
  // responder bid a suit at the one level
  if (MAJ(r)) {
    T.push(T_('4' + r, h => h.L[r] >= 4 && supPts(h, r) >= 19, MM(18, 21, { mn: { [r]: 4 }, agree: r })));
    T.push(T_('3' + r, h => h.L[r] >= 4 && supPts(h, r) >= 16, MM(15, 18, { mn: { [r]: 4 }, agree: r, inv: true, a: 'Invites game' })));
    T.push(T_('2' + r, h => h.L[r] >= 4, MM(11, 15, { mn: { [r]: 4 }, agree: r })));
  }
  if (!BID_OFF('jumpshift')) for (const s of ['S', 'H', 'D', 'C']) if (s !== t && s !== r && ctx.cheap(s) + 1 <= 3 && !(s === 'S' && ctx.cheap(s) === 1 && t === 'H')) // jump shift: 19+, game forcing
    T.push(T_((ctx.cheap(s) + 1) + s, h => h.L[s] >= 4 && h.L[t] >= 4 && !h.semi && (h.H >= 19 || (h.H >= 17 && ltc(h) <= 4)) && longest(h, [t]) === s, MM(18, 21, { mn: { [s]: 4, [t]: 4 }, f: 2, a: 'Jump shift: 19+ points, game forcing', t: 'js' })));
  for (const s of ['H', 'S']) if (s !== r && ctx.ok('1' + s) && bidValue('1' + s) > bidValue(c1)) T.push(T_('1' + s, h => h.L[s] >= 4 && !(h.bal && h.H >= 18 && h.H <= 19 && !BID_OFF('2nt1819')), MM(11, 21, { mn: { [s]: 4 } })));
  if (r === 'D') T.push(T_('2D', h => h.L.D >= 4 && !h.bal && h.H <= 15, MM(11, 15, { mn: { D: 4 }, agree: 'D' })));
  T.push(T_('2N', h => h.semi && h.H >= 18 && h.H <= 19, MM(18, 19, { bal: true, nt: true })));
  T.push(T_('1N', h => h.semi && h.H <= 14, MM(11, 14, { bal: true, nt: true, mx: MAJ(r) ? { [r]: 3 } : {} })));
  for (const s of ['D', 'H', 'S']) if (s !== r && s !== t && bidValue('2' + s) > bidValue('2' + t) && bidValue('1' + s) < bidValue(c1) + 100) {
    if (ctx.ok('1' + s)) continue; // could have been bid at the one level
    T.push(T_('2' + s, h => h.L[s] >= 4 && h.L[t] > h.L[s] && h.H >= 16, MM(16, 21, { mn: { [s]: 4, [t]: 5 }, f: 1, t: 'reverse', a: 'Reverse: 16+ points, forcing one round' })));
  }
  if (MAJ(t) && !BID_OFF('j4m')) T.push(T_('4' + t, h => h.L[t] >= 6 && h.H >= (BID_K('j4m') ?? 19), MM(BID_K('j4m') ?? 19, 21, { mn: { [t]: 6 } }))); // too strong for the 3M invitation
  if (MIN(t) && !BID_OFF('j3n')) T.push(T_('3N', h => h.L[t] >= 6 && hon(h, t, 'AKQ') >= 2 && h.H >= (BID_K('j3n') ?? 19), MM(BID_K('j3n') ?? 19, 21, { mn: { [t]: 6 }, t: 'j3n' }))); // a long minor, too strong for the 3m invitation
  T.push(T_('3' + t, h => h.L[t] >= 6 && h.H >= 15, MM(15, 18, { mn: { [t]: 6 }, inv: true })));
  for (const s of ['C', 'D']) if (s !== t && s !== r && bidValue('2' + s) < bidValue('2' + t)) T.push(T_('2' + s, h => h.L[s] >= 4, MM(11, 18, { mn: { [s]: 4 } })));
  T.push(T_('3' + r, h => MIN(r) && h.L[r] >= 4 && h.H >= 15, MM(15, 18, { mn: { [r]: 4 }, agree: r, inv: true })));
  T.push(T_('2' + t, () => true, MM(11, 15, { mn: { [t]: 5 } })));
  return T;
}
function fourth(ctx) { // the unbid suit, when three suits have been bid naturally by our side
  const bid = new Set(ctx.ours.filter(x => bidValue(x.call) >= 0 && x.call[1] !== 'N').map(x => x.call[1]));
  if (bid.size !== 3) return null;
  return SUITS.find(s => !bid.has(s));
}
function resp1mReb(ctx) { // responder's second call after 1m - 1x - rebid (opponents silent)
  const t = ctx.seq[0][1], r = ctx.seq[1][1], c2 = ctx.seq[2], T = [], o = c2[1];
  if (!/^1[DHS]$/.test(ctx.seq[1])) return null;
  const om = ctx.pLast.m;
  if (c2 === '1N') {
    const nmf = t === 'C' ? '2D' : '2C';
    if (MAJ(r)) {
      if (!BID_OFF('six6')) T.push(T_('6' + r, h => h.L[r] >= 6 && h.H >= (BID_K('six6') ?? 18), MM(BID_K('six6') ?? 18, 37, { mn: { [r]: 6 } }))); // slam values opposite 12-14 (4M was the only call, with no upper limit)
      T.push(T_('4' + r, h => h.L[r] >= 6 && h.H >= 13, MM(13, 17, { mn: { [r]: 6 } })));
      T.push(T_('3' + r, h => h.L[r] >= 6 && h.H >= 11, MM(11, 12, { mn: { [r]: 6 }, inv: true })));
      T.push(T_(nmf, h => h.H >= 11 && h.H <= 17 && (h.L[r] >= 5 || (r === 'S' && h.L.H >= 4)), MM(11, 37, { art: true, f: 1, a: 'New minor forcing: asks for 3-card support or the other major; invitational or better', t: 'nmf' })));
      T.push(T_('2' + r, h => h.L[r] >= 6 && h.H <= 10, MM(6, 10, { mn: { [r]: 6 }, t: 'signoff' })));
    }
    const q1 = BID_K('q1') ?? 0;
    T.push(T_('4N', h => h.H >= 18 + q1 && h.H <= 19 + q1, MM(18 + q1, 19 + q1, { t: 'quant', a: 'Quantitative: invites 6NT' })));
    T.push(T_('6N', h => h.H >= 20 + q1, MM(20 + q1, 37)));
    T.push(T_('3N', h => h.H >= 13, MM(13, 17)));
    T.push(T_('2N', h => h.H >= 11, MM(11, 12, { inv: true })));
    T.push(T_('2' + t, h => h.L[t] >= (t === 'C' ? 5 : 4) && !h.semi && h.H <= 10, MM(6, 10, { mn: { [t]: 4 } })));
    T.push(T_('P', () => true, MM(6, 10)));
    return T;
  }
  if (c2 === '2' + r && MAJ(r)) {
    T.push(T_('4N', h => supPts(h, r) + 12 >= 33 - SD() && openSuits(ctx, h, r) === 0, MM(19, 37, { t: 'rkcb', trump: r, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[r]}: asks for key cards (4 aces and the trump king)` })));
    T.push(T_('4' + r, h => supPts(h, r) >= 12, MM(12, 18)));
    T.push(T_('3' + r, h => supPts(h, r) >= 10, MM(10, 11, { inv: true, a: 'Invites game' })));
    T.push(T_('P', () => true, MM(6, 9)));
    return T;
  }
  if (c2 === '3' + r && MAJ(r)) return [T_('4N', h => supPts(h, r) + 16 >= 33 - SD() && openSuits(ctx, h, r) === 0, MM(17, 37, { t: 'rkcb', trump: r, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[r]}: asks for key cards (4 aces and the trump king)` })), T_('4' + r, h => supPts(h, r) >= 8, MM(8, 16)), T_('P', () => true, MM(6, 7))];
  if (c2 === '4' + r) return [T_('4N', h => supPts(h, r) + 19 >= 33 - SD() && (openSuits(ctx, h, r) === 0 || (!BID_OFF('r4o') && supPts(h, r) >= (BID_K('r4o') ?? 15))), MM(14, 37, { t: 'rkcb', trump: r, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[r]}: asks for key cards (4 aces and the trump king)` })), T_('P', () => true, ANY())];
  if (c2 === '2N') { // 18-19 balanced
    if (MAJ(r) && !BID_OFF('six2n')) T.push(T_('6' + r, h => h.L[r] >= 6 && h.H >= (BID_K('six2n') ?? 13), MM(BID_K('six2n') ?? 13, 37, { mn: { [r]: 6 } }))); // slam values opposite 18-19 (4M had no upper limit)
    if (MAJ(r)) T.push(T_('4' + r, h => h.L[r] >= 6, MM(6, 12, { mn: { [r]: 6 } })), T_('3' + r, h => h.L[r] >= 5 && !h.bal, MM(6, 37, { mn: { [r]: 5 }, f: 1 })));
    if (r === 'H') T.push(T_('3S', h => h.L.S >= 4 && h.H <= 14, MM(6, 37, { mn: { S: 4 }, f: 1, a: '4 spades (opener may have 4 too)' })));
    const q2 = BID_K('q2') ?? 0;
    T.push(T_('6N', h => h.H >= 15 + q2, MM(15 + q2, 37)), T_('4N', h => h.H >= 13 + q2, MM(13 + q2, 14 + q2, { t: 'quant', a: 'Quantitative: invites 6NT' })), T_('3N', () => true, MM(6, 12)));
    return T;
  }
  if (c2 === '3' + t) { // 16-18, six cards
    T.push(T_('4N', h => h.H >= 17 - SD() && h.L[t] >= 2, MM(17, 37, { t: 'rkcb', trump: t, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[t]}: asks for key cards (4 aces and the trump king)` })));
    if (MAJ(r)) T.push(T_('4' + r, h => h.L[r] >= 6 && h.H >= 7, MM(7, 37)));
    T.push(T_('3N', h => h.H >= 8 && SUITS.filter(s => s !== t).every(s => stopper(h, s) || s === r && h.L[r] >= 4), MM(8, 37)));
    T.push(T_('5' + t, h => h.H >= 10 && h.L[t] >= 2, MM(10, 37)));
    if (MAJ(r) && !BID_OFF('j3m')) T.push(T_('3' + r, h => h.L[r] >= 5 && h.H >= 8, MM(8, 37, { mn: { [r]: 5 }, f: 1, a: 'Forcing: 5+ cards, asks for 3-card support' })));
    if (!BID_OFF('j3m')) T.push(T_('3N', h => h.H >= 10, MM(8, 37)));
    T.push(T_('P', () => true, MM(6, 9)));
    return T;
  }
  if (c2 === '3N' && om.tag === 'j3n') return [T_('6N', h => h.H >= (BID_K('j3n6') ?? 11), MM(BID_K('j3n6') ?? 11, 37)), ...(MAJ(r) ? [T_('4' + r, h => h.L[r] >= 6 && h.H >= 8, MM(8, 10, { mn: { [r]: 6 } }))] : []), T_('P', () => true, MM(6, 10))];
  if (om.tag === 'reverse' || om.f === 2 || +c2[0] >= 3 && om.lo >= 18) return null; // forcing: natural bidding (it cannot pass)
  const f4 = fourth(ctx);
  // a new suit (or 1S over 1H): raise it, show values, or fourth suit forcing
  if (o !== t && o !== r && o !== 'N') {
    if (MAJ(o)) {
      T.push(T_('4' + o, h => h.L[o] >= 4 && supPts(h, o) >= 13, MM(13, 16, { mn: { [o]: 4 }, agree: o })));
      T.push(T_('3' + o, h => h.L[o] >= 4 && supPts(h, o) >= 10, MM(10, 12, { mn: { [o]: 4 }, agree: o, inv: true })));
      T.push(T_(+c2[0] === 1 ? '2' + o : '3' + o, h => h.L[o] >= 4 && +c2[0] === 1, MM(6, 9, { mn: { [o]: 4 }, agree: o })));
    }
    if (f4) {
      const fc = ctx.cheap(f4) + f4;
      if (+fc[0] <= 3) T.push(T_(fc, h => h.H >= 13 && !(stopper(h, f4) && h.semi && h.H <= 15), MM(13, 37, { art: true, f: 2, a: 'Fourth suit forcing: artificial, game forcing', t: 'fsf' })));
      T.push(T_('3N', h => h.H >= 13 && stopper(h, f4), MM(13, 16, { nt: true, stop: [f4] })));
      if (ctx.cheap('N') === 2) T.push(T_(ctx.cheap('N') + 'N', h => h.H >= 11 && h.H <= 12 && stopper(h, f4) && ctx.cheap('N') === 2, MM(11, 12, { nt: true, inv: true, stop: [f4] })));
      if (ctx.cheap('N') === 1) T.push(T_(ctx.cheap('N') + 'N', h => h.H <= 10 && stopper(h, f4) && ctx.cheap('N') === 1, MM(6, 10, { nt: true })));
    }
  }
  // opener rebid his suit, or showed a lower suit: natural
  if (!BID_OFF('newsuitf')) for (const x of ['C', 'D', 'H', 'S']) if (x !== t && x !== r && x !== o && x !== f4 && ctx.cheap(x) <= 3 && !(+c2[0] === 1 && MAJ(x) && ctx.cheap(x) === 1)) // a new (third) suit by responder: forcing
    T.push(T_(ctx.cheap(x) + x, h => h.H >= 12 && h.L[x] >= (MAJ(x) ? 4 : 5) && !(h.semi && SUITS.filter(s => s !== t && s !== r && s !== o).every(s => stopper(h, s))) && !(MAJ(r) && h.L[r] >= 6), MM(12, 37, { mn: { [x]: MAJ(x) ? 4 : 5 }, f: 1, t: 'nsf' })));
  if (!BID_OFF('sixn')) T.push(T_('6N', h => h.H >= (BID_K('sixn') ?? 19) && h.semi && SUITS.filter(s => s !== t && s !== r && s !== o).every(s => stopper(h, s)), MM(BID_K('sixn') ?? 19, 37, { nt: true })));
  T.push(T_('3N', h => h.H >= 13 && h.semi && SUITS.filter(s => s !== t && s !== r && s !== o).every(s => stopper(h, s)), MM(13, 16, { nt: true })));
  T.push(T_('4' + r, h => MAJ(r) && h.L[r] >= 6 && h.H >= 12, MM(12, 16, { mn: { [r]: 6 } })));
  T.push(T_('3' + r, h => h.L[r] >= 6 && h.H >= 10 && h.H <= 12, MM(10, 12, { mn: { [r]: 6 }, inv: true })));
  if (ctx.cheap('N') === 2) T.push(T_(ctx.cheap('N') + 'N', h => h.H >= 11 && h.H <= 12 && h.semi && ctx.cheap('N') === 2, MM(11, 12, { nt: true, inv: true })));
  if (ctx.cheap('N') === 1 && !BID_OFF('j2n')) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && h.semi, MM(11, 12, { nt: true, inv: true, a: 'Invites 3NT: 11-12 points' })));
  T.push(T_('3' + t, h => h.L[t] >= (t === 'C' ? 4 : 4) && h.H >= 10 && h.H <= 12 && ctx.cheap(t) <= 3, MM(10, 12, { mn: { [t]: 4 }, agree: t, inv: true })));
  if (ctx.cheap(r) === 2) T.push(T_('2' + r, h => h.L[r] >= 6 && h.H <= 10, MM(6, 10, { mn: { [r]: 6 } })));
  if (ctx.cheap(t) === 2 && o !== t) T.push(T_('2' + t, h => h.L[t] >= 3 && h.L[t] >= h.L[o] && h.H <= 10, MM(6, 10, { mn: { [t]: 3 } })));
  if (ctx.cheap('N') === 1) T.push(T_('1N', h => h.H <= 10 && h.H >= 6, MM(6, 10, { nt: true })));
  T.push(T_('P', h => h.H <= 10, MM(6, 10)));
  return T.length > 1 ? T.concat([{ nat: true }]) : null;
}
function nmfAnswer(ctx) {
  const r = ctx.seq[1][1], c = ctx.seq[3];
  return [
    T_(MAJ(r) && bidValue('2' + r) > bidValue(c) ? '2' + r : '3' + r, h => h.L[r] >= 3 && h.H <= 13, MM(11, 13, { mn: { [r]: 3 }, agree: r, a: `3-card ${SNAME[r]} support, minimum` })),
    T_('3' + r, h => h.L[r] >= 3, MM(14, 14, { mn: { [r]: 3 }, agree: r, a: `3-card ${SNAME[r]} support, maximum` })),
    ...(r === 'S' ? [T_('2H', h => h.L.H >= 4, MM(11, 14, { mn: { H: 4 }, mx: { S: 2 }, a: '4 hearts, no 3-card spade support' }))] : []),
    T_('2N', h => h.H <= 13, MM(11, 13, { nt: true, mx: { [r]: 2 }, a: 'Minimum, no fit' })),
    T_('3N', () => true, MM(14, 14, { nt: true, mx: { [r]: 2 }, a: 'Maximum, no fit' })),
  ];
}
function nmfCont(ctx) {
  const r = ctx.seq[1][1], a = ctx.seq[4], T = [];
  const hfit = a === '2H' ? 'H' : null;
  const fitS = hfit || (a[1] === r ? r : null);
  if (fitS) {
    const max = ctx.pLast.m.lo >= 14;
    T.push(T_('4' + fitS, h => h.L[fitS] + ctx.P.mn[fitS] >= 8 && (h.H >= 13 || (max && h.H >= 11)), MM(12, 17, { agree: fitS })));
    T.push(T_('3' + fitS, h => h.L[fitS] + ctx.P.mn[fitS] >= 8 && ctx.cheap(fitS) <= 3, MM(11, 12, { agree: fitS, inv: true })));
  }
  T.push(T_('3N', h => h.H >= 13 || (ctx.pLast.m.lo >= 14 && h.H >= 11), MM(12, 17)));
  if (ctx.cheap('N') === 2) T.push(T_(ctx.cheap('N') + 'N', h => ctx.cheap('N') === 2, MM(11, 12, { inv: true })));
  T.push(T_('P', () => true, ANY()));
  return T;
}
function fsfAnswer(ctx) { // opener answers fourth suit forcing
  const t = ctx.seq[0][1], r = ctx.seq[1][1], o = ctx.seq[2][1], f = ctx.seq[3][1], T = [];
  if (MAJ(r)) T.push(T_(ctx.cheap(r) + r, h => h.L[r] >= 3, MM(11, 21, { mn: { [r]: 3 }, agree: r })));
  T.push(T_(ctx.cheap('N') + 'N', h => stopper(h, f), MM(11, 21, { nt: true, stop: [f] })));
  T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= 6 || (h.L[t] >= 5 && h.L[o] === 4), MM(11, 21, { mn: { [t]: 5 } })));
  T.push(T_(ctx.cheap(o) + o, h => h.L[o] >= 5, MM(11, 21, { mn: { [o]: 5 } })));
  T.push(T_(ctx.cheap(r) + r, h => h.L[r] >= 2, MM(11, 21, { mn: { [r]: 2 } })));
  T.push(T_(ctx.cheap(f) + f, () => true, MM(11, 21, { mn: { [f]: 4 } })));
  return T;
}

// ---- Notrump systems: Stayman, Jacoby and Texas transfers, Smolen, minor transfer, quantitative ----
function ntBase(ctx) { // our side's natural notrump opening/overcall/rebid that the system works from, opponents silent since
  for (let k = 0; k < ctx.ours.length; k++) {
    const x = ctx.ours[k];
    if (!(x.call === '1N' || x.call === '2N') || !x.m || x.m.art || !x.m.nt || x.m.hi > 27) continue;
    const prior = ctx.ours.slice(0, k);
    const ok = prior.length === 0 || (prior.length === 2 && prior[0].call === '2C' && prior[1].call === '2D' && x.call === '2N');
    if (!ok) continue;
    if (ctx.theirs.some(y => y.i > x.i)) return { x, k, interfered: true };
    if (x.m.hi - x.m.lo > 4) continue;
    return { x, k, interfered: false };
  }
  return null;
}
function ntSystem(ctx) {
  const b = ntBase(ctx); if (!b) return null;
  const x = b.x, lo = x.m.lo, hi = x.m.hi, one = x.call === '1N';
  const after = ctx.ours.slice(b.k);           // the NT bid and our calls since
  const k = after.length, isOpener = x.by === ctx.seat, c = i => after[i] ? after[i].call : null;
  if (b.interfered) { const lb = !BID_OFF('leb') && lebensohl(ctx, b, after); if (lb !== false) return lb; return (k === 1 && !isOpener) ? ntInterference(ctx, lo) : null; }
  const ovc2N = !one && !sameSide(ctx.first.by, x.by) && !BID_OFF('o2n'); // over their weak two the 2NT overcaller's partner raises with less
  const lv = one ? 2 : 3, gf = Math.max(0, 25 - lo - (ovc2N ? (BID_K('o2n') ?? 2) : 0)), inv = Math.max(0, 23 - lo + (one ? 0 : 0)), ntq = BID_K('ntq') ?? 31, quant = ntq - lo, six = (BID_K('ntq6') ?? ntq) + 1 - lo; // round 16: ntq 30 gained +64/16,000 on tuning but lost -98/32,000 held out
  const T = [];
  const trA = s => `Transfer: 5+ ${SNAME[s]}`;
  const rkS = (h, M) => h.H + (BID_K('ntf') ?? 0) >= quant && h.L[M] >= 6 && openSuits(ctx, h, M) === 0; // slam values in a 6+ major: Texas, then 4NT asks for key cards
  if (!isOpener && k === 1) {
    const pts = h => h.H + Math.max(0, h.sh[0] - 5) * (BID_K('ntl') ?? 1) + (h.sh[0] >= 6 && [...'CD'].some(m => h.L[m] >= 6 && hon(h, m, 'AKQ') >= 2) ? (BID_K('ntg') ?? 0) : 0);
    T.push(T_('6N', h => pts(h) >= six + 1 && h.sh[0] <= 6 && !(h.L.H >= 5 || h.L.S >= 5), MM(six + 1, 37)));
    T.push(T_('4N', h => pts(h) >= quant && h.H < six + 1 && h.semi && !(h.L.H >= 5 || h.L.S >= 5) && !(h.L.H === 4 || h.L.S === 4), MM(quant, six, { a: 'Quantitative: invites 6NT', t: 'quant' })));
    T.push(T_('4H', h => h.L.S >= 6 && h.H >= gf && (h.H < quant || rkS(h, 'S')), MM(gf, 37, { mn: { S: 6 }, art: true, a: 'Texas transfer: 6+ spades, game values', t: 'texas' })));
    T.push(T_('4D', h => h.L.H >= 6 && h.H >= gf && (h.H < quant || rkS(h, 'H')), MM(gf, 37, { mn: { H: 6 }, art: true, a: 'Texas transfer: 6+ hearts, game values', t: 'texas' })));
    T.push(T_(lv + 'C', h => h.H >= inv && ((h.L.S === 5 && h.L.H === 4) || (h.L.H === 5 && h.L.S === 4)), MM(inv, 37, { art: true, a: 'Stayman: asks for a 4-card major', t: 'stayman' })));
    T.push(T_(lv + 'H', h => h.L.S >= 5 && h.L.S >= h.L.H, MM(0, 37, { mn: { S: 5 }, art: true, a: trA('S'), t: 'trS', f: 1 })));
    T.push(T_(lv + 'D', h => h.L.H >= 5, MM(0, 37, { mn: { H: 5 }, art: true, a: trA('H'), t: 'trH', f: 1 })));
    T.push(T_(lv + 'C', h => (h.L.H === 4 || h.L.S === 4) && h.H >= inv && !(h.sh[0] === 4 && h.sh[3] === 3), MM(inv, 37, { art: true, a: 'Stayman: asks for a 4-card major', t: 'stayman' })));
    if (one) {
      T.push(T_('2C', h => h.L.H >= 4 && h.L.S >= 4 && h.L.C <= 1 && h.H < inv, MM(0, 37, { art: true, a: 'Stayman: asks for a 4-card major', t: 'stayman' })));
      T.push(T_('2S', h => (h.L.C >= 6 || h.L.D >= 6) && h.H <= 6, MM(0, 6, { art: true, a: 'Transfer to 3♣: weak with a long minor (passes 3♣ or bids 3♦)', t: 'trC', f: 1 })));
    }
    if (!BID_OFF('gerber')) T.push(T_('4C', () => false, MM(0, 37, { art: true, f: 1, a: 'Gerber: asks for aces', t: 'gerber' }))); // the robots don't ask, but a human may
    T.push(T_('P', h => h.H < inv, MM(0, inv - 1)));
    if (one) T.push(T_('2N', h => h.H < gf, MM(inv, gf - 1, { inv: true, nt: true })));
    T.push(T_('6N', h => h.H >= six + 1, MM(six + 1, 37)));
    T.push(T_('4N', h => h.H >= quant, MM(quant, six, { a: 'Quantitative: invites 6NT', t: 'quant' })));
    T.push(T_('3N', () => true, MM(gf, quant - 1)));
    return T;
  }
  const r = c(1);
  if (isOpener && k === 2) {
    if (r === lv + 'D') return [...(one ? [T_('3H', h => one && h.L.H >= 4 && h.H >= hi, MM(hi, hi, { mn: { H: 4 }, agree: 'H', a: 'Super-accept: 4 hearts and a maximum' }))] : []), T_(lv + 'H', () => true, MM(lo, hi, { mn: { H: 2 }, art: true, a: 'Completes the transfer', t: 'complete' }))];
    if (r === lv + 'H') return [...(one ? [T_('3S', h => one && h.L.S >= 4 && h.H >= hi, MM(hi, hi, { mn: { S: 4 }, agree: 'S', a: 'Super-accept: 4 spades and a maximum' }))] : []), T_(lv + 'S', () => true, MM(lo, hi, { mn: { S: 2 }, art: true, a: 'Completes the transfer', t: 'complete' }))];
    if (r === lv + 'C') return [
      T_(lv + 'H', h => h.L.H >= 4, MM(lo, hi, { mn: { H: 4 }, a: 'Shows 4 hearts (may also have 4 spades)' })),
      T_(lv + 'S', h => h.L.S >= 4, MM(lo, hi, { mn: { S: 4 }, mx: { H: 3 }, a: 'Shows 4 spades, denies 4 hearts' })),
      T_(lv + 'D', () => true, MM(lo, hi, { art: true, mx: { H: 3, S: 3 }, a: 'No 4-card major' }))];
    if (r === '2S' && one) return [T_('3C', () => true, MM(lo, hi, { art: true, a: 'Completes the transfer to clubs' }))];
    if (r === '4D') return [T_('4H', () => true, MM(lo, hi, { art: true, a: 'Completes the transfer' }))];
    if (r === '4H') return [T_('4S', () => true, MM(lo, hi, { art: true, a: 'Completes the transfer' }))];
    if (r === '2N') return [T_('3N', h => h.H >= lo + 1, MM(lo + 1, hi)), T_('P', () => true, MM(lo, lo))];
    if (r === '4N') return [T_('6N', h => h.H >= lo + 1, MM(lo + 1, hi)), T_('P', () => true, MM(lo, lo))];
    const rm = ctx.pLast.m || ANY();
    if (r === '4C' && rm.tag === 'gerber') { // aces: 4♦ 0 or 4, 4♥ 1, 4♠ 2, 4NT 3
      const ac = h => [...'SHDC'].filter(s => h.has[s].includes('A')).length;
      return [['4D', [0, 4]], ['4H', [1]], ['4S', [2]], ['4N', [3]]].map(([c, n]) => T_(c, h => n.includes(ac(h)), MM(lo, hi, { art: true, a: `${n.join(' or ')} ace${n[0] === 1 ? '' : 's'}`, t: 'gans' })));
    }
    if (/^3[CDHS]$/.test(r) && !rm.art && !BID_OFF('hum')) { // a natural three-level suit (a human's): game forcing in a major, invitational in a minor
      const s = r[1];
      if (MAJ(s) && rm.f) return [T_('4' + s, h => h.L[s] >= 3, MM(lo, hi, { mn: { [s]: 3 }, agree: s })), T_('3N', () => true, MM(lo, hi, { mx: { [s]: 2 } }))];
      if (MIN(s) && rm.inv) return [T_('3N', h => h.H >= lo + 1 || (h.L[s] >= 2 && hon(h, s) >= 1 && h.H >= lo), MM(lo, hi)), T_('P', () => true, MM(lo, hi))];
    }
    return [T_('P', () => true, ANY())];
  }
  const o2 = c(2);
  if (!isOpener && k === 3) {
    const tr = r === lv + 'D' ? 'H' : r === lv + 'H' ? 'S' : null;
    if (tr) {
      const sup = +o2[0] === 3 && one;
      if (sup) return [T_('4N', h => h.H + 3 + (BID_K('ntf') ?? 0) >= quant && h.L[tr] >= 5 && openSuits(ctx, h, tr) === 0, MM(quant - 3, 37, { t: 'rkcb', trump: tr, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[tr]}: asks for key cards (4 aces and the trump king)` })), T_('4' + tr, h => h.H >= 4 || h.L[tr] >= 6, MM(4, 37)), T_('P', () => true, MM(0, 3))];
      T.push(T_('P', h => h.H < inv, MM(0, inv - 1, { t: 'signoff' })));
      if (tr === 'S') T.push(T_(lv === 2 ? '3H' : '4H', h => h.L.H >= 5 && h.H >= gf, MM(gf, 37, { mn: { H: 5 }, f: 2 })));
      if (!BID_OFF('six5')) T.push(T_('6N', h => h.H >= six + 1 && h.H <= six + 2 && h.L[tr] === 5, MM(six + 1, six + 2, { mn: { [tr]: 5 } }))); // too strong for the 4NT invite, short of a grand: 6NT (a 5NT pick-a-slam measured no better and a partner who does not know it passes 5NT)
      T.push(T_('4N', h => h.H >= quant && h.L[tr] === 5, MM(quant, six, { mn: { [tr]: 5 }, t: 'quant5', trump: tr, a: 'Quantitative: invites 6NT (5-card suit)' })));
      if (lv === 2) T.push(T_('3' + tr, h => h.L[tr] >= 6 && h.H < gf, MM(inv, gf - 1, { mn: { [tr]: 6 }, inv: true })));
      if (lv === 2) T.push(T_('2N', h => h.H < gf, MM(inv, gf - 1, { inv: true, mx: { [tr]: 5 } })));
      T.push(T_('4' + tr, h => h.L[tr] >= 6, MM(gf, quant - 1, { mn: { [tr]: 6 } })));
      for (const m of ['C', 'D']) if (bidValue((lv + 1) + m) > bidValue(o2) || lv === 2) T.push(T_((lv === 2 ? 3 : 4) + m, h => h.L[m] >= 4 && !h.semi && h.H >= gf, MM(gf, 37, { mn: { [m]: 4 }, f: 2 })));
      T.push(T_('3N', () => true, MM(gf, quant - 1, { mx: { [tr]: 5 } })));
      return T;
    }
    if (r === lv + 'C') {
      const shown = o2[1];
      if (shown === 'H' || shown === 'S') {
        const fit = h => h.L[shown] >= 4;
        T.push(T_('4N', h => fit(h) && h.H + 1 + (BID_K('ntf') ?? 0) >= quant && openSuits(ctx, h, shown) === 0, MM(quant - 1, 37, { t: 'rkcb', trump: shown, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[shown]}: asks for key cards (4 aces and the trump king)` })));
        T.push(T_('4' + shown, h => fit(h) && h.H >= gf, MM(gf, quant - 1, { agree: shown })));
        T.push(T_('3' + shown, h => fit(h) && h.H >= inv, MM(inv, gf - 1, { agree: shown, inv: true })));
        T.push(T_('P', h => h.H < inv, MM(0, inv - 1)));
        if (shown === 'H' && one) T.push(T_('2S', h => h.L.S >= 4 && h.H < gf, MM(inv, gf - 1, { mn: { S: 4 }, inv: true, a: '4 spades, invitational' })));
        if (one) T.push(T_('2N', h => h.H < gf, MM(inv, gf - 1, { inv: true })));
        if (!BID_OFF('six4')) T.push(T_('6N', h => h.H >= six + 1, MM(six + 1, 37, { mx: { [shown]: 3 } }))); // too strong for the 4NT invite: bid the slam
        T.push(T_('4N', h => h.H >= quant, MM(quant, six, { t: 'quant', a: 'Quantitative: invites 6NT' })));
        T.push(T_('3N', () => true, MM(gf, quant - 1)));
        return T;
      }
      // no major
      T.push(T_('P', h => h.H < inv, MM(0, inv - 1)));
      T.push(T_('3H', h => h.L.H === 4 && h.L.S === 5 && h.H >= gf, MM(gf, 37, { mn: { H: 4, S: 5 }, art: true, f: 2, a: 'Smolen: 4 hearts here, 5 spades, game forcing', t: 'smolen' })));
      T.push(T_('3S', h => h.L.S === 4 && h.L.H === 5 && h.H >= gf, MM(gf, 37, { mn: { S: 4, H: 5 }, art: true, f: 2, a: 'Smolen: 4 spades here, 5 hearts, game forcing', t: 'smolen' })));
      if (one) for (const s of ['H', 'S']) T.push(T_('2' + s, h => h.L[s] >= 5 && h.H < gf, MM(inv, gf - 1, { mn: { [s]: 5 }, inv: true, a: `5 ${SNAME[s]} and 4 of the other major, invitational` })));
      if (one) T.push(T_('2N', h => h.H < gf, MM(inv, gf - 1, { inv: true })));
      if (!BID_OFF('six4')) T.push(T_('6N', h => h.H >= six + 1, MM(six + 1, 37)));
      T.push(T_('4N', h => h.H >= quant, MM(quant, six, { t: 'quant', a: 'Quantitative: invites 6NT' })));
      T.push(T_('3N', () => true, MM(gf, quant - 1)));
      return T;
    }
    if (r === '2S' && one) return [T_('P', h => h.L.C >= 6, MM(0, 6, { mn: { C: 6 } })), T_('3D', () => true, MM(0, 6, { mn: { D: 6 }, t: 'signoff' }))];
    if ((r === '4D' && o2 === '4H') || (r === '4H' && o2 === '4S')) { const M = o2[1]; return [T_('4N', h => rkS(h, M), MM(quant, 37, { t: 'rkcb', trump: M, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[M]}: asks for key cards (4 aces and the trump king)` })), T_('P', () => true, ANY())]; }
    if (r === '4C' && after[1].m && after[1].m.tag === 'gerber') return [T_('4N', () => false, MM(0, 37, { a: 'To play (after Gerber)', t: 'signoff' }))]; // then natural
    return [T_('P', () => true, ANY())];
  }
  if (isOpener && k === 4 && r === '4C' && after[1].m && after[1].m.tag === 'gerber') return c(3) === '4N' || +c(3)[0] >= 6 ? [T_('P', () => true, ANY())] : null;
  if (isOpener && k === 4) {
    const r3 = c(3), tr = r === lv + 'D' ? 'H' : r === lv + 'H' ? 'S' : null, max = h => h.H >= lo + 1;
    if (tr) {
      if (r3 === '2N') return [T_('4' + tr, h => max(h) && h.L[tr] >= 3, MM(lo + 1, hi)), T_('3N', max, MM(lo + 1, hi)), T_('3' + tr, h => h.L[tr] >= 3, MM(lo, lo)), T_('P', () => true, MM(lo, lo))];
      if (r3 === '3N') return [T_('4' + tr, h => h.L[tr] >= 3, MM(lo, hi, { mn: { [tr]: 3 } })), T_('P', () => true, ANY())];
      if (r3 === '3' + tr) return [T_('4' + tr, h => max(h) || (h.L[tr] >= 3 && hon(h, tr) >= 1), ANY()), T_('P', () => true, ANY())];
      if (r3 === '3H' && tr === 'S') return [T_('4S', h => h.L.S >= 3 && h.L.S >= h.L.H, ANY()), T_('4H', h => h.L.H >= 3, ANY()), T_('3N', () => true, ANY())];
      if (r3 === '3C' || r3 === '3D') return [T_('4' + tr, h => h.L[tr] >= 3, ANY()), T_('3N', () => true, ANY())];
      return null;
    }
    if (r === lv + 'C') {
      if (r3 === '3H' || r3 === '3S') {
        if (ctx.pLast.m.tag === 'smolen') { const long = otherM(r3[1]); return [T_('4' + long, h => h.L[long] >= 3, MM(lo, hi, { mn: { [long]: 3 } })), T_('3N', () => true, MM(lo, hi, { mx: { [long]: 2 } }))]; }
        return [T_('4' + r3[1], max, ANY()), T_('P', () => true, ANY())];
      }
      if (r3 === '2H' || r3 === '2S') {
        const s = r3[1];
        if (ctx.pLast.m.inv && o2 === '2H' && s === 'S') return [T_('4S', h => h.L.S >= 4 && max(h), ANY()), T_('3S', h => h.L.S >= 4, ANY()), T_('3N', max, ANY()), T_('2N', () => true, ANY())];
        return [T_('4' + s, h => max(h) && h.L[s] >= 3, ANY()), T_('3N', max, ANY()), T_('P', () => true, ANY())];
      }
      if (r3 === '2N') return [T_('3N', max, ANY()), T_('P', () => true, ANY())];
      if (r3 === '3N') return [T_('4S', h => o2 === lv + 'H' && h.L.S >= 4, ANY()), T_('P', () => true, ANY())];
    }
    return null;
  }
  return null;
}
function ntInterference(ctx, lo) { // partner's 1NT/2NT, they came in
  const lb = ctx.lb, st = lb.call[1], T = [], gf = 25 - lo;
  if (lb.call === 'X' || bidValue(lb.call) < 0) return null;
  if (st !== 'N' && !(lb.m && lb.m.art)) {
    T.push(T_('X', h => h.H >= 23 - lo && h.L[st] >= 4 && hon(h, st, 'AKQJT') >= 2 && +lb.call[0] <= 3, MM(23 - lo, 37, { mn: { [st]: 4 }, a: 'Penalty', t: 'xpen' })));
    T.push(T_('3N', h => h.H >= gf && stopper(h, st) && ctx.cheap('N') <= 3, MM(gf, 37)));
  }
  for (const s of ['S', 'H']) {
    T.push(T_('4' + s, h => h.L[s] >= 6 && h.H >= gf - 2, MM(gf - 2, 37, { mn: { [s]: 6 } })));
    if (ctx.cheap(s) === 3) T.push(T_('3' + s, h => h.L[s] >= 5 && h.H >= gf, MM(gf, 37, { mn: { [s]: 5 }, f: 1 })));
  }
  for (const s of ['S', 'H', 'D', 'C']) if (ctx.cheap(s) === 2) T.push(T_('2' + s, h => h.L[s] >= 5 && h.H < gf && (h.L[s] >= 6 || h.H >= 5), MM(0, gf - 1, { mn: { [s]: 5 }, t: 'signoff' })));
  T.push(T_('3N', h => h.H >= gf && ctx.cheap('N') <= 3, MM(gf, 37)));
  T.push(T_('P', () => true, ANY()));
  return T;
}

// ---- Competition: lebensohl after they overcall our 1NT opening at the two level ----
// 2NT asks opener to bid 3♣: then responder passes or signs off in a suit ranking below theirs, invites with a suit
// ranking above theirs, or shows game values WITH a stopper (cue bid = 4 cards in an unbid major, 3NT = no major).
// Directly: a 2-level suit is to play, a 3-level suit forces to game, the cue bid and 3NT deny a stopper
// ("fast denies"), double is for penalty. Returns false when it does not apply.
function lebensohl(ctx, b, after) {
  const x = b.x, k = after.length, isOpener = x.by === ctx.seat;
  if (x.call !== '1N' || b.k !== 0) return false;
  const ov = ctx.theirs.filter(y => y.i > x.i);
  if (!ov.length || bidValue(ov[0].call) < 0 || ov[0].i !== x.i + 1 || +ov[0].call[0] !== 2 || ov[0].call[1] === 'N' || (ov[0].m && ov[0].m.art)) return false;
  if (ov.length > 1 || ctx.rhoCall !== 'P' && !(k === 1 && !isOpener)) return k === 1 ? false : null;
  const os = ov[0].call[1], lo = x.m.lo, gf = 25 - lo, inv = 23 - lo, cue = '3' + os;
  const ma = ['H', 'S'].filter(s => s !== os);
  const four = h => ma.some(s => h.L[s] >= 4);
  const above = s => STRAINS.indexOf(s) > STRAINS.indexOf(os);
  const c = i => after[i] ? after[i].call : null, tg = i => after[i] && after[i].m ? after[i].m.tag : '';
  if (!isOpener && k === 1) {
    const T = [];
    T.push(T_('X', h => h.H >= inv && h.L[os] >= 4 && hon(h, os, 'AKQJT') >= 2, MM(inv, 37, { mn: { [os]: 4 }, a: 'Penalty', t: 'xpen' })));
    for (const s of ['S', 'H']) if (s !== os) T.push(T_('4' + s, h => h.L[s] >= 6 && h.H >= gf - 2, MM(gf - 2, 37, { mn: { [s]: 6 } })));
    T.push(T_(cue, h => h.H >= gf && four(h) && !stopper(h, os), MM(gf, 37, { art: true, f: 2, mx: {}, a: `Stayman: 4 cards in an unbid major, game values, no ${SNAME[os]} stopper`, t: 'lebcue' })));
    T.push(T_('2N', h => h.H >= gf && stopper(h, os) && !ma.some(s => h.L[s] >= 5), MM(0, 37, { art: true, f: 1, a: 'Lebensohl: asks for 3♣ (weak with a long suit, an invitation, or game values with a stopper)', t: 'leb' })));
    for (const s of ['S', 'H', 'D', 'C']) if (s !== os) T.push(T_('3' + s, h => h.L[s] >= 5 && h.H >= gf && (MAJ(s) || !four(h)), MM(gf, 37, { mn: { [s]: 5 }, f: 2, a: 'Game forcing' })));
    T.push(T_('3N', h => h.H >= gf && !four(h), MM(gf, 37, { nt: true, a: `To play, no ${SNAME[os]} stopper`, t: 'lebfast' })));
    for (const s of ['S', 'H', 'D', 'C']) if (ctx.cheap(s) === 2) T.push(T_('2' + s, h => h.L[s] >= 5 && h.H < gf && (h.L[s] >= 6 || h.H >= 5), MM(0, gf - 1, { mn: { [s]: 5 }, t: 'signoff' })));
    T.push(T_('2N', h => h.H < gf && SUITS.some(s => s !== os && h.L[s] >= 6 && ctx.cheap(s) === 3 && (!above(s) || h.H < inv)) || (h.H >= inv && h.H < gf && SUITS.some(s => s !== os && above(s) && ctx.cheap(s) === 3 && h.L[s] >= 5)), MM(0, 37, { art: true, f: 1, a: 'Lebensohl: asks for 3♣ (weak with a long suit, an invitation, or game values with a stopper)', t: 'leb' })));
    T.push(T_('3N', h => h.H >= gf, MM(gf, 37, { nt: true })));
    T.push(T_('P', () => true, MM(0, gf - 1)));
    return T;
  }
  if (isOpener && k === 2) {
    if (tg(1) === 'leb') return [T_('3C', () => true, MM(lo, 17, { art: true, a: 'Forced reply to lebensohl' }))];
    if (tg(1) === 'lebcue') return [...ma.map(s => T_('4' + s, h => h.L[s] >= 4, MM(lo, 17, { mn: { [s]: 4 } }))), T_('3N', h => stopper(h, os), MM(lo, 17, { nt: true })), ...['D', 'C'].filter(s => s !== os).map(s => T_('4' + s, h => h.L[s] >= 4, MM(lo, 17, { mn: { [s]: 4 } }))), T_('3N', () => true, ANY())];
    if (tg(1) === 'lebfast') return [T_('P', h => stopper(h, os), ANY()), ...['D', 'C'].filter(s => s !== os).map(s => T_('4' + s, h => h.L[s] >= 4, MM(lo, 17, { mn: { [s]: 4 }, a: `No ${SNAME[os]} stopper either` }))), T_('P', () => true, ANY())];
    return null;
  }
  if (!isOpener && k === 3 && tg(1) === 'leb' && c(2) === '3C') {
    const T = [];
    T.push(T_(cue, h => h.H >= gf && four(h), MM(gf, 37, { art: true, f: 2, a: `Stayman: 4 cards in an unbid major, game values, ${SNAME[os]} stopper`, t: 'lebcue2' })));
    T.push(T_('3N', h => h.H >= gf, MM(gf, 37, { nt: true, stop: [os], a: `To play, with a ${SNAME[os]} stopper` })));
    for (const s of ['S', 'H', 'D']) if (s !== os && above(s)) T.push(T_('3' + s, h => h.L[s] >= 5 && h.H >= inv, MM(inv, gf - 1, { mn: { [s]: 5 }, inv: true, a: 'Invitational' })));
    if (os !== 'C') T.push(T_('P', h => h.L.C >= 6, MM(0, inv - 1, { mn: { C: 6 }, t: 'signoff' })));
    for (const s of ['S', 'H', 'D']) if (s !== os && !above(s)) T.push(T_('3' + s, h => h.L[s] >= 5, MM(0, inv - 1, { mn: { [s]: 6 }, t: 'signoff', a: 'To play' })));
    for (const s of ['S', 'H', 'D']) if (s !== os && above(s)) T.push(T_('3' + s, h => h.L[s] >= 5, MM(0, inv - 1, { mn: { [s]: 6 } })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  if (isOpener && k === 4 && tg(1) === 'leb') {
    const m3 = after[3].m || ANY(), r3 = c(3);
    if (m3.tag === 'lebcue2') return [...ma.map(s => T_('4' + s, h => h.L[s] >= 4, MM(lo, 17, { mn: { [s]: 4 } }))), T_('3N', () => true, ANY())];
    if (m3.inv && r3 && r3[1] !== 'N') { const s = r3[1]; return [T_(MAJ(s) ? '4' + s : '3N', h => h.H >= lo + 1 && (h.L[s] >= 3 || !MAJ(s)), ANY()), T_('3N', h => h.H >= lo + 1 && stopper(h, os), ANY()), T_('P', () => true, ANY())]; }
    return [T_('P', () => true, ANY())];
  }
  return null;
}

// ---- Strong 2C ----
function resp2C(ctx) {
  const T = [];
  for (const s of ['H', 'S']) T.push(T_('2' + s, h => h.L[s] >= 5 && hon(h, s) >= 2 && h.H >= 8, MM(8, 37, { mn: { [s]: 5 }, f: 2, a: 'Positive: good 5+ card suit, 8+ points' })));
  for (const s of ['C', 'D']) T.push(T_('3' + s, h => h.L[s] >= 5 && hon(h, s) >= 2 && h.H >= 8, MM(8, 37, { mn: { [s]: 5 }, f: 2, a: 'Positive: good 5+ card suit, 8+ points' })));
  T.push(T_('2D', () => true, MM(0, 37, { art: true, f: 1, a: 'Waiting: artificial, says nothing about diamonds', t: 'wait' })));
  return T;
}
function reb2C(ctx) {
  if (ctx.seq[1] !== '2D') return null;
  const T = [];
  T.push(T_('2N', h => h.bal && h.H <= 24, MM(22, 24, { bal: true, nt: true, a: '22-24 points, balanced' })));
  T.push(T_('3N', h => h.bal && h.H <= 27, MM(25, 27, { bal: true, nt: true, a: '25-27 points, balanced' })));
  const best = h => { const s = longest(h); return h.L[s] >= 5 ? s : (['C', 'D', 'H', 'S'].find(x => h.L[x] === 4 && x !== s) ? s : s); };
  for (const s of ['H', 'S']) T.push(T_('2' + s, h => best(h) === s, MM(20, 37, { mn: { [s]: 5 }, f: 2 })));
  for (const s of ['C', 'D']) T.push(T_('3' + s, h => best(h) === s, MM(20, 37, { mn: { [s]: 5 }, f: 2 })));
  T.push(T_('2N', () => true, MM(22, 24, { bal: true, nt: true, a: '22-24 points, balanced' })));
  return T;
}
function resp2C2(ctx) { // responder after 2C - 2D - suit
  const r = ctx.seq[2], s = r[1], T = [];
  if (!/^[23][CDHS]$/.test(r)) return null;
  if (MAJ(s)) {
    T.push(T_('3' + s, h => h.L[s] >= 3 && h.H >= 8, MM(8, 37, { mn: { [s]: 3 }, agree: s, a: 'Support, 8+ points (slam interest)' })));
    T.push(T_('4' + s, h => h.L[s] >= 3, MM(0, 7, { mn: { [s]: 3 }, agree: s, a: 'Support, weak' })));
  } else T.push(T_('4' + s, h => h.L[s] >= 4 && h.H >= 4, MM(4, 37, { mn: { [s]: 4 }, agree: s })));
  const neg = r === '3C' ? '3D' : '3C';
  if (bidValue(neg) > bidValue(r)) T.push(T_(neg, h => h.H <= 3, MM(0, 3, { art: true, a: 'Second negative: 0-3 points', t: 'neg2' })));
  for (const x of ['S', 'H', 'D']) if (x !== s && ctx.cheap(x) <= 3) T.push(T_(ctx.cheap(x) + x, h => h.L[x] >= 5 && hon(h, x) >= 1 && h.H >= 4, MM(4, 37, { mn: { [x]: 5 } })));
  T.push(T_(ctx.cheap('N') + 'N', () => true, MM(4, 37, { nt: true })));
  return T;
}

// ---- Weak twos and preempts ----
function respWeak2(ctx) {
  const t = ctx.seq[0][1], T = [];
  const sideStops = h => SUITS.filter(s => s !== t).every(s => stopper(h, s));
  if (MAJ(t)) T.push(T_('4' + t, h => (h.L[t] >= 3 && h.H >= 15) || (h.L[t] >= 4 && h.H <= 12) || (h.L[t] >= 2 && h.H >= 17), MM(0, 37, { agree: t })));
  T.push(T_('3N', h => h.H >= 16 && (sideStops(h) || (!MAJ(t) && h.L[t] >= 2)), MM(16, 37)));
  T.push(T_('2N', h => h.H >= 15, MM(15, 37, { art: true, f: 1, a: 'Feature ask: asks for an outside ace or king with a maximum', t: 'feature' })));
  T.push(T_('3' + t, h => h.L[t] >= 3 && h.H <= 14, MM(0, 14, { agree: t, a: 'Preemptive raise, not invitational' })));
  for (const s of ['H', 'S', 'C', 'D']) if (s !== t) T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 5 && goodSuit(h, s) && h.H >= 15 && ctx.cheap(s) <= 3, MM(15, 37, { mn: { [s]: 5 }, f: 1, a: 'Forcing one round' })));
  T.push(T_('P', () => true, MM(0, 14)));
  return T;
}
function featAnswer(ctx) {
  const t = ctx.seq[0][1], T = [];
  T.push(T_('3N', h => h.H >= 9 && hon(h, t) === 3, MM(9, 10, { a: 'Solid suit (AKQ)' })));
  for (const s of SUITS) if (s !== t) T.push(T_('3' + s, h => h.H >= 9 && (h.has[s].includes('A') || h.has[s].includes('K')), MM(9, 10, { art: true, a: `Maximum with an ace or king in ${SNAME[s]}` })));
  T.push(T_('3' + t, () => true, MM(5, 10, { a: 'Minimum, or a maximum without a feature' })));
  return T;
}
function featCont(ctx) {
  const t = ctx.seq[0][1], max = ctx.pLast.m.lo >= 9;
  return [
    T_(MIN(t) ? '5' + t : '4' + t, h => h.L[t] >= 2 && (h.H >= 17 || (max && h.H >= 15)) && (MAJ(t) || !SUITS.filter(s => s !== t).every(s => stopper(h, s))), ANY()),
    T_('3N', h => h.H >= 17 || (max && h.H >= 15), ANY()),
    T_('P', h => ctx.lb.call === '3' + t, ANY()),
    T_('3' + t, () => true, ANY()),
  ];
}
function respPre(ctx) { // partner's 3-level preempt
  const t = ctx.seq[0][1], T = [];
  if (MAJ(t)) T.push(T_('4' + t, h => (h.L[t] >= 2 && h.H >= 15) || (h.L[t] >= 3 && h.H >= 13) || (h.L[t] >= 4 && h.H <= 10), MM(0, 37, { agree: t })));
  T.push(T_('3N', h => h.H >= 16 && SUITS.filter(s => s !== t).every(s => stopper(h, s)) && (h.L[t] >= 1 || MIN(t)), MM(16, 37)));
  if (MIN(t)) T.push(T_('5' + t, h => (h.L[t] >= 3 && h.H >= 15) || (h.L[t] >= 4 && h.H <= 10), MM(0, 37, { agree: t })));
  if (MIN(t)) T.push(T_('4' + t, h => h.L[t] >= 3 && h.H <= 12, MM(0, 12, { agree: t, a: 'Preemptive raise' })));
  T.push(T_('P', () => true, MM(0, 15)));
  return T;
}

// ---- Competition ----
function compDirect(ctx) { // they opened; our side has only passed so far
  const lb = ctx.lb, st = lb.call[1], lv = +lb.call[0], T = [];
  const n = ctx.prefix.length;
  const balancing = n >= 3 && ctx.rhoCall === 'P' && ctx.prefix[n - 2].call === 'P' && lb.by === ctx.lho;
  if (ctx.mine.length || ctx.pards.length) return null;
  if (lv >= 5) return [T_('X', h => h.H >= 13 && h.L[st] <= 1, dblMeaning(ctx)), { nat: true }];
  const their = ctx.oppSuits.slice();
  if (st !== 'N' && !their.includes(st) && !(lb.m && lb.m.art)) their.push(st);
  const unbid = SUITS.filter(s => !their.includes(s));
  const shortOK = h => their.every(s => h.L[s] <= 2) && unbid.every(s => h.L[s] >= 3) || (h.L[st] <= 1 && unbid.filter(s => h.L[s] >= 3).length >= unbid.length - 1 && unbid.every(s => h.L[s] >= 2));
  const xm = st !== 'N' ? dblMeaning(ctx) : null;
  if (lb.call === '2C' && lb.m && lb.m.art && ctx.theirs.length === 1 && !BID_OFF('def2c')) { // over their strong 2♣: preemptive suits, X = clubs
    const vk = vulK(ctx, 'v2c');
    T.push(T_('X', h => h.L.C >= 5 && hon(h, 'C', 'AKQJ') >= 2 && h.H >= 6, dblMeaning(ctx)));
    for (const s of ['S', 'H', 'D']) T.push(T_('3' + s, h => h.L[s] >= 7 && hon(h, s, 'AKQJT') >= 2 && h.H <= 10 && vk < 2, MM(3, 10, { mn: { [s]: 7 }, a: 'Preemptive', t: 'wjo' })));
    for (const s of ['S', 'H', 'D']) T.push(T_('2' + s, h => h.L[s] >= (vk >= 1 ? 6 : 5) && hon(h, s, 'AKQJT') >= 2 && (h.L[s] >= 6 || h.H >= 6) && h.H <= 13 && longest(h) === s, MM(3, 13, { mn: { [s]: 5 }, a: 'Natural, mainly preemptive', t: 'wjo' })));
    T.push(T_('3C', h => h.L.C >= 6 && hon(h, 'C', 'AKQJT') >= 2 && h.H <= 10, MM(3, 10, { mn: { C: 6 }, a: 'Preemptive', t: 'wjo' })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  if (st === 'N') { // over their notrump
    if (lv === 1) T.push(T_('X', h => h.H >= (balancing ? 13 : 15) && h.sh[0] <= 5 && h.sh[1] <= 4, dblMeaning(ctx)));
    for (const s of ['S', 'H', 'D', 'C']) if (ctx.cheap(s) <= 3) T.push(T_(ctx.cheap(s) + s, h => (BID_OFF('ntovs') || !ctx.oppSuits.includes(s)) && (h.L[s] >= 6 && h.H >= (ctx.cheap(s) >= 3 ? 10 : 7) || (h.L[s] >= 5 && goodSuit(h, s) && h.H >= 9 && ctx.cheap(s) === 2 && h.sh[1] >= 4 && longest(h) === s)), MM(7, 15, { mn: { [s]: 5 } })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  const lvl = s => ctx.cheap(s), vk = vulK(ctx, 'vovc'), vw = vulK(ctx, 'vwjo');
  if (balancing && lv <= 2) {
    T.push(T_('X', h => h.H >= 9 && shortOK(h) || h.H >= 16, Object.assign({}, xm, { lo: 9 })));
    if (lv === 1) T.push(T_('1N', h => h.semi && h.H >= 11 && h.H <= 15 && stopper(h, st), MM(11, 15, { nt: true, a: 'Balancing: 11-15 points' })));
    for (const s of unbid) if (lvl(s) <= 2) T.push(T_(lvl(s) + s, h => h.L[s] >= 5 && h.H >= (lvl(s) === 1 ? 7 : 9) && longest(h, their) === s, MM(7, 16, { mn: { [s]: 5 } })));
    T.push(T_('P', () => true, MM(0, 9)));
    return T;
  }
  // direct seat
  if (lv === 1 && ctx.theirs.length === 1) {
    const cue = '2' + st;
    if (MIN(st)) T.push(T_(cue, h => h.L.H >= 5 && h.L.S >= 5 && (h.H >= 7 && h.H <= 11 || h.H >= 16), MM(7, 37, { mn: { H: 5, S: 5 }, art: true, a: 'Michaels: 5+ hearts and 5+ spades', t: 'michaels' })));
    else { const om = otherM(st); T.push(T_(cue, h => h.L[om] >= 5 && (h.L.C >= 5 || h.L.D >= 5) && (h.H >= 7 && h.H <= 11 || h.H >= 16), MM(7, 37, { mn: { [om]: 5 }, art: true, a: `Michaels: 5+ ${SNAME[om]} and a 5+ card minor`, t: 'michaels' }))); }
    const low2 = unbid.filter(s => s !== 'S' || unbid.length <= 2).sort((a, b) => STRAINS.indexOf(a) - STRAINS.indexOf(b)).slice(0, 2);
    T.push(T_('2N', h => low2.every(s => h.L[s] >= 5) && (h.H >= 7 && h.H <= 11 || h.H >= 16), MM(7, 37, { mn: Object.fromEntries(low2.map(s => [s, 5])), art: true, a: `Unusual 2NT: 5+ ${SNAME[low2[0]]} and 5+ ${SNAME[low2[1]]}`, t: 'unusual' })));
    T.push(T_('1N', h => h.bal && h.H >= 15 && h.H <= 18 && stopper(h, st), MM(15, 18, { bal: true, nt: true, a: '15-18 points, balanced, stopper', t: 'nt' })));
  }
  if (lv <= 2 && ctx.theirs.length === 1 && lv === 2) T.push(T_('2N', h => h.semi && h.H >= 15 && h.H <= 18 && stopper(h, st), MM(15, 18, { nt: true, bal: true, t: 'nt' })));
  const xlo = lv >= 3 ? 13 : 12;
  T.push(T_('X', h => (h.H >= xlo && shortOK(h)) || h.H >= 17, xm));
  if (ctx.cheap('N') === 3 && lv >= 3) T.push(T_('3N', h => h.H >= 16 && stopper(h, st), MM(16, 37, { nt: true })));
  for (const s of unbid) {
    const l = lvl(s);
    if (l <= 2 && lv <= 2 && ctx.ok((l + 1) + s) && l + 1 <= 3) T.push(T_((l + 1) + s, h => h.L[s] >= (l + 1 === 3 && !(!BID_OFF('wj6') && MIN(s) && vw <= 0 && h.sp[s] >= 4) ? 7 : 6) && h.H >= (vw < 0 ? 4 : 5) && h.H <= 10 && longest(h, their) === s && hon(h, s, 'AKQJ') >= 2, MM(5, 10, { mn: { [s]: 6 }, a: 'Weak jump overcall', t: 'wjo' })));
    if (l === 1) T.push(T_('1' + s, h => h.L[s] >= 5 && h.H >= (vk >= 2 ? 9 : vk < 0 ? 7 : 8) && h.H <= 17 && longest(h, their) === s && (vk >= 1 ? h.H >= 11 || goodSuit(h, s) : h.H >= 10 || hon(h, s, 'AKQJT') >= 2), MM(8, 17, { mn: { [s]: 5 }, t: 'ovc' })));
    if (l === 2) T.push(T_('2' + s, h => h.L[s] >= 5 && h.H >= (vk >= 1 ? 11 : 10) && h.H <= 17 && longest(h, their) === s && (vk >= 1 ? goodSuit(h, s) || (h.L[s] >= 6 && hon(h, s, 'AKQJT') >= 2) : h.L[s] >= 6 || goodSuit(h, s)), MM(10, 17, { mn: { [s]: 5 }, t: 'ovc' })));
    if (l === 3) T.push(T_('3' + s, h => h.L[s] >= 6 && h.H >= 12 && goodSuit(h, s) && longest(h, their) === s, MM(12, 18, { mn: { [s]: 6 }, t: 'ovc' })));
    if (l === 3 && lv <= 2 && !MIN(s) || l === 4) { /* no 3-level preempt jumps beyond this */ }
  }
  T.push(T_('P', () => true, MM(0, 16)));
  return T;
}
function advanceX(ctx) { // partner's takeout double, my first call
  const lb = ctx.lb, st = lb.call[1], T = [];
  const their = ctx.oppSuits.slice(); if (!their.includes(st)) their.push(st);
  const unbid = SUITS.filter(s => !their.includes(s));
  const rhoBid = ctx.rhoCall !== 'P';
  const order = h => unbid.slice().sort((a, b) => (h.L[b] + (MAJ(b) ? 0.5 : 0)) - (h.L[a] + (MAJ(a) ? 0.5 : 0)));
  const best = h => order(h)[0];
  if (!rhoBid && +lb.call[0] === 1) T.push(T_('P', h => h.L[st] >= 5 && hon(h, st, 'AKQJT') >= 3, MM(6, 37, { mn: { [st]: 5 }, a: 'Converts the double to penalties' })));
  if (!rhoBid) T.push(T_(ctx.cheap(st) + st, h => h.H >= 12, MM(12, 37, { art: true, f: 1, a: 'Cue bid: 12+ points, asks partner to describe', t: 'cue' })));
  for (const s of unbid) {
    if (MAJ(s)) T.push(T_('4' + s, h => best(h) === s && h.L[s] >= 5 && h.H >= 22 - ctx.pLast.m.lo, MM(10, 37, { mn: { [s]: 5 } })));
  }
  const nt = ctx.cheap('N');
  T.push(T_('3N', h => h.H >= 13 && stopper(h, st) && nt <= 3, MM(13, 37, { nt: true })));
  if (nt <= 2) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && stopper(h, st) && nt === 2, MM(11, 12, { nt: true, inv: true })));
  for (const s of unbid) {
    const l = ctx.cheap(s);
    if (l + 1 <= 3) T.push(T_((l + 1) + s, h => best(h) === s && h.L[s] >= 4 && h.H >= 21 - ctx.pLast.m.lo && h.H <= 12 && !rhoBid, MM(9, 12, { mn: { [s]: 4 }, inv: true })));
  }
  if (nt === 1) T.push(T_('1N', h => h.H >= 6 && h.H <= 10 && stopper(h, st) && h.L[st] >= 3 && !unbid.some(s => MAJ(s) && h.L[s] >= 4), MM(6, 10, { nt: true })));
  for (const s of unbid) {
    const l = ctx.cheap(s);
    if (l <= (rhoBid ? 3 : 4)) T.push(T_(l + s, h => best(h) === s && (!rhoBid || h.H >= 6 && h.L[s] >= 4 && (l <= 2 || h.H >= 8)), MM(rhoBid ? 6 : 0, rhoBid ? 11 : 8, { mn: { [s]: rhoBid ? 4 : 3 } })));
  }
  if (rhoBid && bidValue(ctx.rhoCall) >= 0) T.push(T_('X', h => h.H >= (+lb.call[0] <= 2 ? 7 : 9) && unbid.every(s => h.L[s] >= 3), dblMeaning(ctx)));
  if (!rhoBid && ctx.cheap(unbid[0]) <= 3) T.push(T_(ctx.cheap(unbid[0]) + unbid[0], () => true, MM(0, 8)));
  T.push(T_('P', () => true, MM(0, 6)));
  return T;
}
function advanceOvc(ctx) { // partner overcalled (or made a two-suited bid); my first call
  const pm = ctx.pLast.m, pc = ctx.pLast.call, T = [];
  const lb = ctx.lb, their = ctx.oppSuits;
  if (pm.tag === 'michaels' || pm.tag === 'unusual' || pm.tag === 'unusual4') {
    const known = SUITS.filter(s => pm.mn[s] >= 5);
    const cand = known.length === 2 ? known : known.length === 1 ? [known[0]] : ['C', 'D'];
    if (known.length === 1 && ctx.rhoCall === 'P') { // Michaels over a major: other major plus an unknown minor
      const om = known[0];
      T.push(T_('4' + om, h => h.L[om] >= 3 && supPts(h, om) >= 11 || h.L[om] >= 4 && h.H <= 10 && ctx.cheap(om) <= 4, MM(0, 37, { agree: om })));
      T.push(T_(ctx.cheap(om) + om, h => h.L[om] >= 2, MM(0, 10, { agree: om })));
      T.push(T_('2N', h => ctx.cheap('N') === 2, MM(0, 37, { art: true, f: 1, a: 'Asks for the Michaels bidder\'s minor', t: 'askminor' })));
    }
    const best = h => cand.slice().sort((a, b) => h.L[b] - h.L[a] || (MAJ(b) ? 1 : 0) - (MAJ(a) ? 1 : 0))[0];
    for (const s of cand) {
      const gl = gameLevel(s);
      T.push(T_(gl + s, h => best(h) === s && h.L[s] >= 3 && (supPts(h, s) >= (MAJ(s) ? 11 : 13) || (h.L[s] >= gl + 1 && h.H <= 9)), MM(0, 37, { agree: s })));
      if (ctx.cheap(s) <= gl) T.push(T_(ctx.cheap(s) + s, h => best(h) === s && (h.L[s] >= 3 || ctx.rhoCall === 'P') && (ctx.cheap(s) <= 3 || h.L[s] + 5 >= ctx.cheap(s) + 6), MM(0, 10, { agree: s })));
    }
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  if (pm.tag === 'nt' || pm.art) return null; // e.g. partner's cue bid: natural (it is forcing)
  if (pc === 'X' || bidValue(pc) < 0) return null;
  const s = pc[1];
  if (s === 'N') return null;
  const wjo = pm.tag === 'wjo';
  const rhoBid = ctx.rhoCall !== 'P';
  const oppS = lb.call[1] !== s ? lb.call[1] : (their[0] || null);
  if (MAJ(s)) T.push(T_('4' + s, h => h.L[s] >= 3 && (supPts(h, s) >= 15 || (h.L[s] >= (wjo ? 4 : 5) && h.H <= 10)), MM(0, 37, { mn: { [s]: 3 }, agree: s })));
  const cueS = ctx.theirs.length ? ctx.theirs[0].call[1] : null;
  if (cueS && cueS !== 'N' && !wjo && ctx.ok(ctx.cheap(cueS) + cueS) && ctx.cheap(cueS) <= 3 && bidValue(ctx.cheap(cueS) + cueS) < bidValue('3' + s))
    T.push(T_(ctx.cheap(cueS) + cueS, h => h.L[s] >= 3 && supPts(h, s) >= (ctx.cheap(cueS) >= 3 ? 13 : 10), MM(10, 37, { mn: { [s]: 3 }, agree: s, art: true, f: 1, a: `Cue bid: 3+ ${SNAME[s]}, limit raise or better`, t: 'cueraise' })));
  if (ctx.cheap(s) <= 3) {
    const jl = ctx.cheap(s) + 1;
    if (jl <= 3 && !rhoBid) T.push(T_(jl + s, h => h.L[s] >= 4 && h.H <= 9, MM(0, 9, { mn: { [s]: 4 }, agree: s, a: 'Preemptive raise' })));
    T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 3 && supPts(h, s) >= 6 && (ctx.cheap(s) <= 2 || h.L[s] >= 4 || supPts(h, s) >= 10) || (wjo && h.L[s] >= 3) || (h.L[s] >= 2 && supPts(h, s) >= 8 && ctx.cheap(s) === 2 && !wjo && h.H >= 8 && false), MM(6, 10, { mn: { [s]: 3 }, agree: s })));
  }
  if (wjo) {
    T.push(T_('3N', h => h.H >= 16 && oppS && stopper(h, oppS) && h.L[s] >= 1, MM(16, 37)));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  const nt = ctx.cheap('N');
  const stopsAll = h => their.every(x => stopper(h, x));
  T.push(T_('3N', h => h.H >= 15 && stopsAll(h) && nt <= 3, MM(15, 37, { nt: true })));
  if (nt === 2) T.push(T_('2N', h => h.H >= 12 && h.H <= 14 && stopsAll(h), MM(12, 14, { nt: true, inv: true })));
  if (nt === 1) T.push(T_('1N', h => h.H >= 8 && h.H <= 11 && stopsAll(h), MM(8, 11, { nt: true })));
  for (const x of ['S', 'H', 'D', 'C']) if (x !== s && !their.includes(x) && ctx.cheap(x) <= 2)
    T.push(T_(ctx.cheap(x) + x, h => h.L[x] >= 5 && h.H >= (ctx.cheap(x) === 1 ? 8 : 10) && h.L[s] <= 2 && goodSuit(h, x), MM(8, 16, { mn: { [x]: 5 } })));
  if (rhoBid && ctx.ok('X') && bidValue(ctx.rhoCall) >= 0) { const dm = dblMeaning(ctx); T.push(T_('X', h => dm.tag === 'xresp' && h.H >= 8 && h.L[s] <= 2 && Object.keys(dm.mn).every(x => h.L[x] >= 4), dm)); }
  T.push(T_('P', () => true, MM(0, 9)));
  return T;
}
function respComp(ctx) { // partner opened one of a suit, RHO came in; my first call
  const op = ctx.first.call, t = op[1], rc = ctx.rhoCall, T = [];
  const lb = ctx.lb;
  if (ctx.theirs.length !== 1 || ctx.theirs[0].by !== ctx.rho) return null;
  if (rc === 'X') {
    if (MAJ(t)) T.push(T_('2N', h => h.L[t] >= 4 && supPts(h, t) >= 10 && h.H >= 7, MM(10, 37, { mn: { [t]: 4 }, agree: t, art: true, f: 1, a: `Jordan 2NT: 4+ ${SNAME[t]}, limit raise or better`, t: 'jordan' })));
    T.push(T_('XX', h => h.H >= 10, MM(10, 37, { a: 'Redouble: 10+ points, usually no fit', t: 'xx' })));
    T.push(T_('4' + t, h => MAJ(t) && h.L[t] >= 5 && h.H <= 9, MM(0, 9, { mn: { [t]: 5 }, agree: t })));
    T.push(T_('3' + t, h => h.L[t] >= (MAJ(t) ? 4 : 5) && h.H <= 9 && supPts(h, t) < 10 && h.H >= 3, MM(3, 9, { mn: { [t]: 4 }, agree: t, a: 'Preemptive raise' })));
    T.push(T_('2' + t, h => h.L[t] >= (MAJ(t) ? 3 : 4) && h.H >= 5, MM(5, 9, { mn: { [t]: 3 }, agree: t })));
    for (const s of ['H', 'S']) if (s !== t && ctx.ok('1' + s)) T.push(T_('1' + s, h => h.L[s] >= 4 && h.H >= 6, MM(6, 9, { mn: { [s]: 4 }, f: 1 })));
    if (t === 'C') T.push(T_('1D', h => h.L.D >= 4 && h.H >= 6, MM(6, 9, { mn: { D: 4 }, f: 1 })));
    T.push(T_('1N', h => h.H >= 6 && h.H <= 9, MM(6, 9, { nt: true })));
    for (const s of ['C', 'D', 'H']) if (s !== t && ctx.cheap(s) === 2) T.push(T_('2' + s, h => h.L[s] >= 6 && h.H >= 4 && h.H <= 9, MM(4, 9, { mn: { [s]: 6 } })));
    T.push(T_('P', () => true, MM(0, 9)));
    return T;
  }
  if (bidValue(rc) < 0) return null;
  const os = rc[1];
  const om = lb.m || ANY();
  if (os === 'N' || om.art) return null; // their notrump or a conventional call: natural
  const nt = ctx.cheap('N');
  const xm = dblMeaning(ctx);
  // raises
  if (MAJ(t)) {
    T.push(T_('4' + t, h => h.L[t] >= 4 && (supPts(h, t) >= 13 || h.H <= 9 && h.L[t] >= 5), MM(0, 37, { mn: { [t]: 4 }, agree: t })));
    // their overcall at the three level or higher (a jump, or any four-level call) left no cue bid below four of our major: game with three trumps and game values
    if (ctx.cheap(os) > 3 && !BID_OFF('r3g')) T.push(T_('4' + t, h => h.L[t] === 3 && supPts(h, t) >= 13, MM(13, 37, { mn: { [t]: 3 }, agree: t })));
    if (ctx.cheap(os) <= 3) T.push(T_(ctx.cheap(os) + os, h => h.L[t] >= 3 && supPts(h, t) >= (ctx.cheap(os) >= 3 ? 13 : 10), MM(10, 37, { mn: { [t]: 3 }, agree: t, art: true, f: 1, a: `Cue bid: 3+ ${SNAME[t]}, limit raise or better`, t: 'cueraise' })));
    if (ctx.cheap(t) <= 2 && ctx.ok('3' + t)) T.push(T_('3' + t, h => h.L[t] >= 4 && h.H <= 9, MM(0, 9, { mn: { [t]: 4 }, agree: t, a: 'Preemptive raise' })));
    if (ctx.cheap(t) <= 3) T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= 3 && supPts(h, t) >= 6, MM(6, 10, { mn: { [t]: 3 }, agree: t })));
  }
  // negative double
  const xOK = h => {
    const need = Object.keys(xm.mn);
    if (h.H < xm.lo) return false;
    if (need.length) return need.every(s => h.L[s] >= 4) || (need.length === 2 && need.some(s => h.L[s] >= 4) && h.H >= 10 && !need.some(s => h.L[s] >= 5));
    return SUITS.filter(s => s !== t && s !== os).every(s => h.L[s] >= 3) || h.H >= 11;
  };
  // new suits (forcing)
  for (const s of ['S', 'H']) if (s !== t && s !== os && ctx.cheap(s) === 1) T.push(T_('1' + s, h => h.L[s] >= (xm.mn[s] ? 5 : 4) && h.H >= 6, MM(6, 37, { mn: { [s]: 4 }, f: 1 })));
  T.push(T_('X', h => xOK(h) && !(MAJ(t) && h.L[t] >= 3), xm));
  if (nt <= 3) T.push(T_('3N', h => h.H >= 13 && stopper(h, os) && h.semi && !(MAJ(t) && h.L[t] >= 3), MM(13, 37, { nt: true, stop: [os] })));
  for (const s of ['S', 'H', 'D', 'C']) if (s !== t && s !== os && ctx.cheap(s) === 2) T.push(T_('2' + s, h => h.L[s] >= 5 && h.H >= 10 && longest(h, [os]) === s, MM(10, 37, { mn: { [s]: 5 }, f: 1 })));
  if (nt === 2) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && stopper(h, os), MM(11, 12, { nt: true, inv: true, stop: [os] })));
  if (MIN(t) && ctx.cheap(t) <= 3) {
    T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= 5 && h.H >= 6 && h.H <= 10, MM(6, 10, { mn: { [t]: 4 }, agree: t })));
    if (ctx.cheap(os) <= 3) T.push(T_(ctx.cheap(os) + os, h => h.L[t] >= 4 && h.H >= 11, MM(11, 37, { mn: { [t]: 4 }, agree: t, art: true, f: 1, a: `Cue bid: ${SNAME[t]} support, limit raise or better`, t: 'cueraise' })));
  }
  if (nt === 2) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && stopper(h, os), MM(11, 12, { nt: true, inv: true, stop: [os] })));
  if (nt === 1) T.push(T_('1N', h => h.H >= 6 && h.H <= 10 && stopper(h, os), MM(6, 10, { nt: true, stop: [os] })));
  if (nt === 1) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && stopper(h, os) && h.semi, MM(11, 12, { nt: true, inv: true, stop: [os] })));
  T.push(T_('X', h => h.H >= xm.lo + 2 && h.L[os] <= 2, xm));
  T.push(T_('P', () => true, MM(0, 37)));
  return T;
}
function afterNegX(ctx) { // opener after 1x (overcall) X (pass)
  const t = ctx.seq[0][1], os = ctx.theirs[0].call[1], xm = ctx.pLast.m, T = [];
  const shown = Object.keys(xm.mn).filter(s => xm.mn[s] >= 4);
  if (ctx.rhoCall !== 'P') return null;
  T.push(T_('P', h => h.L[os] >= (+ctx.lb.call[0] === 1 ? 5 : 4) && hon(h, os, 'AKQJT') >= 3 && +ctx.lb.call[0] <= 2, MM(11, 21, { mn: { [os]: 4 }, a: 'Converts the double to penalties' })));
  for (const s of shown) {
    const l = ctx.cheap(s);
    T.push(T_('4' + s, h => h.L[s] >= 4 && supPts(h, s) >= 18 && l <= 4, MM(18, 21, { mn: { [s]: 4 }, agree: s })));
    if (l + 1 <= 3) T.push(T_((l + 1) + s, h => h.L[s] >= 4 && supPts(h, s) >= 15, MM(15, 17, { mn: { [s]: 4 }, agree: s, inv: true })));
    T.push(T_(l + s, h => h.L[s] >= 4, MM(11, 15, { mn: { [s]: 4 }, agree: s })));
  }
  const nt = ctx.cheap('N');
  if (nt <= 2) T.push(T_(nt + 'N', h => h.semi && stopper(h, os) && (nt === 1 ? h.H <= 14 : h.H >= 15 && h.H <= 17), MM(nt === 1 ? 11 : 15, nt === 1 ? 14 : 17, { nt: true })));
  if (nt <= 3) T.push(T_('3N', h => h.semi && stopper(h, os) && h.H >= 18, MM(18, 19, { nt: true })));
  if (!BID_OFF('nxj')) { // extras with a long suit of my own: the cheap rebid had no upper limit
    const lt = ctx.cheap(t), lc = ctx.cheap(os);
    if (lc <= 3) T.push(T_(lc + os, h => h.H >= (BID_K('nxc') ?? 19) && !(h.semi && stopper(h, os)), MM(BID_K('nxc') ?? 19, 37, { art: true, f: 2 })));
    if (lt + 1 <= 3) T.push(T_((lt + 1) + t, h => h.L[t] >= 6 && h.H >= 16, MM(16, 18, { mn: { [t]: 6 }, inv: true })));
  }
  T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= 6 || h.L[t] >= 5 && shown.every(s => h.L[s] <= 2), MM(11, 15, { mn: { [t]: 5 } })));
  for (const s of SUITS) if (s !== t && s !== os && !shown.includes(s) && ctx.cheap(s) <= 2) T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 4, MM(11, 17, { mn: { [s]: 4 } })));
  T.push(T_(ctx.cheap(t) + t, () => true, MM(11, 15)));
  return T;
}
function reopen(ctx) { // I opened, LHO overcalled, partner and RHO passed
  const t = ctx.seq[0][1], os = ctx.lb.call[1];
  if (os === 'N' || +ctx.lb.call[0] > 2) return null;
  return [
    T_('X', h => h.L[os] <= 2 && (h.H >= 12) && !(h.L[t] >= 6 && h.H <= 13), dblMeaning(ctx)),
    { nat: true },
  ];
}
function afterReopen(ctx) { // partner's reopening double: pass with their suit, else bid
  const os = ctx.lb.call[1];
  const t = ctx.first.call[1], T = [T_('P', h => h.L[os] >= 4 && hon(h, os, 'AKQJT') >= 2 && h.H >= 6, MM(6, 37, { mn: { [os]: 4 }, a: 'Converts the double to penalties' }))];
  T.push(T_('3N', h => h.H >= 11 && stopper(h, os) && ctx.cheap('N') <= 3, MM(11, 37, { nt: true })));
  for (const x of ['S', 'H', 'D', 'C']) if (x !== os && x !== t && ctx.cheap(x) <= 3) T.push(T_(ctx.cheap(x) + x, h => h.L[x] >= 5 && longest(h, [os]) === x, MM(0, 10, { mn: { [x]: 5 } })));
  if (ctx.cheap('N') === 2) T.push(T_('2N', h => h.H >= 9 && stopper(h, os), MM(9, 10, { nt: true })));
  T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= 2 || true, MM(0, 9)));
  return T;
}
function afterJordan(ctx) {
  const t = ctx.seq[0][1];
  if (MIN(t)) return [T_('3N', h => h.H >= 14 && h.semi, MM(14, 21, { nt: true })), T_('5' + t, h => h.H + h.lp >= 17 && !h.semi, MM(15, 21)), T_('3' + t, () => true, MM(11, 14))];
  return [T_('4' + t, h => h.H >= 14 || h.H + h.lp >= 15, MM(14, 21)), T_('3' + t, () => true, MM(11, 13))];
}
function afterCueRaise(ctx) { // partner showed a limit raise or better by cue bid
  const s = ctx.pLast.m.agree;
  const opened = ctx.first && ctx.first.by === ctx.seat;
  const minH = opened ? 14 : 15;
  const os = ctx.theirs.length ? ctx.theirs[0].call[1] : null;
  return [...(MIN(s) && os && os !== 'N' && ctx.cheap('N') <= 3 ? [T_('3N', h => h.H >= 12 && stopper(h, os), MM(12, 21, { nt: true }))] : []), T_(gameLevel(s) + s, h => (MAJ(s) ? h.H + h.lp >= minH : h.H >= 16), MM(minH, 21)), T_(ctx.cheap(s) + s, () => true, MM(opened ? 11 : 8, minH - 1, { t: 'signoff' }))];
}
function afterCueAdvance(ctx) { // partner cue-bid after my takeout double: describe
  const their = ctx.oppSuits;
  const unbid = SUITS.filter(s => !their.includes(s));
  const T = [];
  for (const s of ['H', 'S']) if (unbid.includes(s)) T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 4, MM(12, 37, { mn: { [s]: 4 } })));
  T.push(T_(ctx.cheap('N') + 'N', h => their.every(s => stopper(h, s)), MM(12, 37, { nt: true })));
  for (const s of ['D', 'C']) if (unbid.includes(s)) T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 4, MM(12, 37, { mn: { [s]: 4 } })));
  T.push(T_(ctx.cheap(unbid[0]) + unbid[0], () => true, MM(12, 37)));
  return T;
}
function askMinorAnswer(ctx) {
  return [T_('3D', h => h.L.D >= 5 && h.L.D >= h.L.C, MM(0, 37, { mn: { D: 5 } })), T_('3C', () => true, MM(0, 37, { mn: { C: 5 } }))];
}

// ---- RKCB 1430 ----
function rkcbTable(ctx) {
  const pl = ctx.pLast, ml = ctx.myLast, lb = ctx.lb;
  if (!pl || !pl.m || ctx.rhoCall !== 'P' || lb !== pl && !(lb && lb.by === ctx.p)) return null;
  const tr = pl.m.trump || (ml && ml.m && ml.m.trump);
  if (pl.m.tag === 'rkcb' && pl.call === '4N') {
    const kc = h => keycards(h, tr), q = h => h.has[tr].includes('Q');
    return [
      T_('5C', h => kc(h) === 1 || kc(h) === 4, MM(0, 37, { art: true, a: '1 or 4 key cards', t: 'rkr', kc: [1, 4], trump: tr })),
      T_('5D', h => kc(h) === 0 || kc(h) === 3 || kc(h) === 5, MM(0, 37, { art: true, a: '0 or 3 key cards', t: 'rkr', kc: [0, 3], trump: tr })),
      T_('5H', h => !q(h), MM(0, 37, { art: true, a: `2 key cards without the ${SNAME[tr]} queen`, t: 'rkr', kc: [2], trump: tr, q: false })),
      T_('5S', () => true, MM(0, 37, { art: true, a: `2 key cards with the ${SNAME[tr]} queen`, t: 'rkr', kc: [2], trump: tr, q: true })),
    ];
  }
  if (pl.m.tag === 'quant5' && pl.call === '4N') { // quantitative after a transfer (5-card major): slam in the major with three or more of it, else 6NT on a maximum
    const mid = ctx.Me.lo + Math.min(2, (Math.min(ctx.Me.hi, ctx.Me.lo + 4) - ctx.Me.lo) / 2), M = pl.m.trump;
    return [T_('6' + M, h => h.L[M] >= 3, MM(ctx.Me.lo, ctx.Me.hi, { mn: { [M]: 3 } })), T_('6N', h => h.H >= mid, MM(mid, ctx.Me.hi, { mx: { [M]: 2 } })), T_('P', () => true, ANY())];
  }
  if (pl.m.tag === 'lrask') { const M = pl.m.trump; return [T_(pl.call === '3N' ? '4C' : '4D', h => h.H >= (BID_K('lrm') ?? 11) || (BID_K('lrs') && supPts(h, M) >= BID_K('lrs')), MM(BID_K('lrs') ? 8 : BID_K('lrm') ?? 11, 37, { art: true, t: 'lrmax', trump: M, a: 'Maximum limit raise' })), T_('4' + M, () => true, MM(0, (BID_K('lrm') ?? 11) - 1, { t: 'signoff', a: 'Minimum limit raise' }))]; }
  if (ml && ml.m && ml.m.tag === 'lrask' && pl.m.tag === 'lrmax') { const M = ml.m.trump; return [T_('4N', () => true, MM(15, 21, { t: 'rkcb', trump: M, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[M]}: asks for key cards (4 aces and the trump king)` }))]; }
  if (pl.m.tag === 'quant') {
    const mid = ctx.Me.lo + Math.min(2, (Math.min(ctx.Me.hi, ctx.Me.lo + 4) - ctx.Me.lo) / 2);
    return [T_('6N', h => h.H >= mid || (h.H >= ctx.Me.lo && h.sh[0] >= 5), ANY()), T_('P', () => true, ANY())];
  }
  if (pl.m.tag === 'qask') {
    const t2 = pl.m.trump;
    return [T_('6' + t2, h => h.has[t2].includes('Q') || h.L[t2] >= 5, MM(0, 37, { art: false, a: `Has the ${SNAME[t2]} queen`, t: 'qr' })), T_(ctx.cheap(t2) + t2, () => true, MM(0, 37, { a: `No ${SNAME[t2]} queen`, t: 'qr' }))];
  }
  if (pl.m.tag === 'place') return [T_('P', () => true, ANY())];
  if (pl.m.tag === 'kask') { // answer the grand slam try
    const t2 = pl.m.trump, sk = h => SUITS.filter(s => s !== t2 && h.has[s].includes('K')).length;
    return [T_('7' + t2, h => sk(h) >= 2 || (sk(h) >= 1 && h.L[t2] >= 5), MM(0, 37, { t: 'place' })), T_('6' + t2, () => true, MM(0, 37, { t: 'place' }))];
  }
  if (ml && ml.m && ml.m.tag === 'rkcb' && pl.m.tag === 'rkr') return rkcbPlace(ctx, pl, tr);
  if (ml && ml.m && ml.m.tag === 'qask' && pl.m.tag === 'qr') {
    const hasQ = +pl.call[0] === 6;
    return [
      T_('7' + tr, h => ctx.rk && hasQ && false, MM(0, 37, { t: 'place' })),
      T_('6' + tr, h => hasQ || (ctx.cheap(tr) === 6 && BID_OFF('qfix')), MM(0, 37, { t: 'place' })),
      T_('P', () => true, MM(0, 37, { t: 'place' }))];
  }
  return null;
}
function rkcbPlace(ctx, pl, tr) {
  const opts = pl.m.kc;
  const decide = h => {
    const mine = keycards(h, tr);
    let theirs = opts[0];
    if (opts.length > 1 && mine + opts[1] <= 5 && (mine + opts[0] <= 2 && ctx.P.lo >= (BID_OFF('rkinfer') ? 12 : 9) || mine + opts[0] < 2)) theirs = opts[1];
    const missing = 5 - mine - theirs;
    const qKnown = pl.m.q === true || h.has[tr].includes('Q') || (h.L[tr] + ctx.P.mn[tr] >= 10);
    const tot = supPts(h, tr) + ctx.P.lo;
    if (missing >= 2) return ctx.cheap(tr) === 5 ? '5' + tr : (+pl.call[0] === 5 && pl.call[1] === tr ? 'P' : '6' + tr);
    if (missing === 1) {
      if (qKnown || pl.m.q === undefined && false) return '6' + tr;
      if (pl.m.q === false) return ctx.cheap(tr) === 5 ? '5' + tr : '6' + tr;
      const ask = qaskCall(pl.call, tr);
      if (ask) return ask;
      return '6' + tr;
    }
    if (qKnown && tot >= (BID_K('g7') ?? 36)) return '7' + tr;
    if (qKnown && tot >= (BID_K('g5') ?? 32) && ctx.ok('5N') && !BID_OFF('kask')) return '5N';
    return '6' + tr;
  };
  const T = [];
  const ask = qaskCall(pl.call, tr);
  for (const c of ['P', '5' + tr, '6' + tr, '7' + tr]) if (c === 'P' || ctx.ok(c)) T.push(T_(c, h => decide(h) === c, MM(0, 37, { t: 'place' })));
  if (ctx.ok('5N')) T.push(T_('5N', h => decide(h) === '5N', MM(0, 37, { art: true, f: 1, t: 'kask', trump: tr, a: `Grand slam try: all key cards and the ${SNAME[tr]} queen are held; bid seven with a side king and extra trump length, or two side kings` })));
  if (ask) T.push(T_(ask, h => decide(h) === ask, MM(0, 37, { art: true, t: 'qask', trump: tr, a: `Asks for the ${SNAME[tr]} queen` })));
  T.push(T_('6' + tr, () => true, MM(0, 37, { t: 'place' })));
  return T;
}
function qaskCall(resp, tr) { // the cheapest bid other than the trump suit, if it is still below five of trumps
  if (resp !== '5C' && resp !== '5D') return null;
  for (let v = bidValue(resp) + 1; v < bidValue('5' + tr); v++) { const c = `${Math.floor(v / 5) + 1}${STRAINS[v % 5]}`; if (c[1] !== tr && c[1] !== 'N') return c; }
  return null;
}

// ---- Competition: lebensohl after partner doubles their weak two ----
function lebAdvX(ctx) {
  const st = ctx.lb.call[1], unbid = SUITS.filter(s => s !== st), T = [];
  const best = h => unbid.slice().sort((a, b) => (h.L[b] + (MAJ(b) ? 0.5 : 0)) - (h.L[a] + (MAJ(a) ? 0.5 : 0)))[0];
  const ums = unbid.filter(MAJ);
  T.push(T_('P', h => h.L[st] >= 5 && hon(h, st, 'AKQJT') >= 3, MM(6, 37, { mn: { [st]: 5 }, a: 'Converts the double to penalties' })));
  for (const M of ums) T.push(T_('4' + M, h => best(h) === M && (h.L[M] >= 5 && h.H >= 10 || h.L[M] >= 4 && h.H >= 12 && !stopper(h, st)), MM(10, 37, { mn: { [M]: 4 } })));
  T.push(T_('3N', h => h.H >= 12 && stopper(h, st) && !ums.some(M => h.L[M] >= 5), MM(12, 37, { nt: true, stop: [st] })));
  T.push(T_('3' + st, h => h.H >= 12 && ums.some(M => h.L[M] >= 4), MM(12, 37, { art: true, f: 1, a: 'Cue bid: game values, asks for a major', t: 'cue' })));
  for (const s of unbid) if (ctx.cheap(s) === 2) T.push(T_('3' + s, h => best(h) === s && h.L[s] >= 4 && h.H >= 9 && h.H <= 11, MM(9, 11, { mn: { [s]: 4 }, inv: true, a: 'Invitational' })));
  for (const s of unbid) if (ctx.cheap(s) === 3) T.push(T_('3' + s, h => best(h) === s && h.H >= 8 && h.H <= 11, MM(8, 11, { mn: { [s]: 4 }, a: 'Constructive: 8-11 points' })));
  for (const s of unbid) if (ctx.cheap(s) === 2) T.push(T_('2' + s, h => best(h) === s, MM(0, 8, { mn: { [s]: 4 } })));
  T.push(T_('2N', h => h.H <= 7, MM(0, 7, { art: true, f: 1, a: 'Lebensohl: weak, asks for 3♣ to sign off in a suit', t: 'lebx' })));
  T.push(T_('3N', h => h.H >= 12, MM(12, 37, { nt: true })));
  for (const s of unbid) if (ctx.cheap(s) === 3) T.push(T_('3' + s, h => best(h) === s, MM(8, 11, { mn: { [s]: 4 } })));
  T.push(T_('P', () => true, ANY()));
  return T;
}

// ---- Competition: they interfere in our constructive auction ----
// "System on" (as GIB and most partnerships play): once we have opened, a double that takes no room is ignored when
// it is for penalty or lead-directing, or when we are already game forcing or opened 2♣ or notrump; a bid by them is
// ignored too once we are game forcing (or after our 2♣ or notrump opening and partner's reply), as long as the call
// the system wants is still available. When we are forcing, a double of their bid is for penalty (trump length).
const ASKS = ['rkcb', 'qask', 'rkr', 'feature', 'stayman', 'trS', 'trH', 'trC', 'texas'];
function seeThrough(ctx) {
  if (ctx.see || !ctx.weOpened || ctx.quiet || !ctx.first.m) return null;
  const op = ctx.first.call, om = ctx.first.m;
  const strong = op === '2C' || ((op === '1N' || op === '2N') && om.nt && !om.art);
  const before = i => ctx.ours.filter(x => x.i < i);
  const gfBy = i => before(i).some(x => x.m && x.m.f === 2) || strong;
  for (const y of ctx.theirs) {
    const b = before(y.i);
    if (y.call === 'X') {
      const t = y.m && y.m.tag;
      if (t === 'xpen' || t === 'xlead') { if (b.length === 1 && /^1[CDHS]$/.test(op)) return null; continue; }
      if (gfBy(y.i) && !(b.length === 1 && /^1[CDHS]$/.test(op))) continue;
      return null;
    }
    if (bidValue(y.call) < 0) return null; // a redouble
    if (b.length < 2 || !gfBy(y.i)) return null;
    const last = b[b.length - 1];
    if (last.m && ASKS.includes(last.m.tag) && !(strong && b.length === 2 && last.m.tag !== 'rkcb')) return null;
    if (+y.call[0] >= 5) return null;
  }
  // partner (or I) doubled their bid for penalty: leave it in; if they run, bid naturally
  const ourX = ctx.ours.find(x => x.call === 'X' && ctx.theirs.some(y => y.i < x.i && bidValue(y.call) >= 0));
  if (ourX) return ourX.m && ourX.m.tag === 'xpen' && lastNonPass(ctx.prefix) === ctx.prefix[ourX.i] ? [T_('P', () => true, ANY())] : null;
  const prefix2 = ctx.prefix.map(a => !sameSide(a.by, ctx.seat) && a.call !== 'P' ? { call: 'P', by: a.by } : a);
  const c2 = mkCtx(prefix2, ctx.seat, ctx.metas, ctx.vul);
  c2.see = true; c2.legal = ctx.legal;
  let T = tablesFor(c2);
  if (!T) return null;
  const lb = ctx.lb;
  if (lb && !sameSide(lb.by, ctx.seat) && ctx.ok('X')) {
    const st = lb.call[1], lv = +lb.call[0], dm = dblMeaning(ctx);
    const ourTop = [...ctx.ours].reverse().find(x => bidValue(x.call) >= 0);
    const gameOn = c2.gf || (ourTop && +ourTop.call[0] >= gameLevel(ourTop.call[1]));
    const tot = h => h.H + c2.P.lo, fit = c2.agree;
    const stack = h => st === 'N' ? tot(h) >= 23 : (h.L[st] >= 4 && hon(h, st, 'AKQJT') >= 2) || (lv >= 3 && h.L[st] >= 3 && hon(h, st) >= 2);
    const sac = h => gameOn && lv >= 4 && tot(h) >= 24 && tot(h) < 31 && !(fit && h.L[fit] + c2.P.mn[fit] >= 10 && h.L[st] <= 1);
    if (dm.tag === 'xpen') T = [T_('X', h => (stack(h) && !(fit && h.L[fit] + c2.P.mn[fit] >= 10)) || sac(h), dm)].concat(T);
  }
  return T;
}

// ---- Competition: more situations (tablesFor asks compMore first in every contested auction) ----
function compMore(ctx) {
  const pl = ctx.pLast, n = ctx.prefix.length;
  const nonP = ctx.items.filter(x => x.call !== 'P');
  // They redoubled our takeout double: advancer bids his best suit (pass = wants to defend 1x redoubled)
  if (!ctx.weOpened && ctx.rhoCall === 'XX' && pl && pl.call === 'X' && pl.m && pl.m.tag === 'xto' && !ctx.mine.some(x => x.call !== 'P') && ctx.pards.length === 1) return runFromXX(ctx, true);
  // ... and the doubler, when it comes back to him in their contract redoubled
  if (!ctx.weOpened && ctx.rhoCall === 'P' && n >= 2 && ctx.prefix[n - 2].call === 'P' && nonP.length && nonP[nonP.length - 1].call === 'XX' && ctx.myLast && ctx.myLast.call === 'X' && ctx.myLast.m && ctx.myLast.m.tag === 'xto' && ctx.lb.call[0] === '1') return runFromXX(ctx, false);
  // Lebensohl advancing a takeout double of a weak two: 2NT = weak relay to 3♣, a direct 3-level suit = 8-11
  if (!BID_OFF('lebx') && !ctx.weOpened && ctx.rhoCall === 'P' && pl && pl.call === 'X' && pl.m && pl.m.tag === 'xto' && ctx.pards.length === 1 && !ctx.mine.some(x => x.call !== 'P')
    && ctx.lb === ctx.theirs[0] && ctx.theirs.length === 1 && /^2[DHS]$/.test(ctx.lb.call) && ctx.lb.m && ctx.lb.m.tag === 'weak2') return lebAdvX(ctx);
  if (!BID_OFF('lebx') && pl && pl.m && pl.m.tag === 'lebx' && ctx.rhoCall === 'P' && ctx.lb === pl) {
    const T = [], st = ctx.theirs[0].call[1];
    if (!BID_OFF('lebb') && st !== 'N') { // a doubler too strong to stop in partner's suit breaks the relay, naturally (lebb)
      const n3 = BID_K('lb3n') ?? 22, m3 = BID_K('lbM') ?? 22, m4 = BID_K('lb4') ?? 21;
      for (const M of ['S', 'H']) if (M !== st && ctx.ok('4' + M)) T.push(T_('4' + M, h => h.L[M] >= 6 && h.H >= m4, MM(m4, 37, { mn: { [M]: 6 } })));
      for (const M of ['S', 'H']) if (M !== st && ctx.ok('3' + M)) T.push(T_('3' + M, h => h.L[M] >= 5 && h.H >= m3 && longest(h, [st]) === M, MM(m3, 37, { mn: { [M]: 5 } })));
      T.push(T_('3N', h => h.H >= n3 && stopper(h, st), MM(n3, 37, { nt: true, stop: [st] })));
    }
    return [...T, T_('3C', () => true, MM(0, 37, { art: true, a: 'Forced reply to lebensohl' }))];
  }
  if (!BID_OFF('lebx') && ctx.myLast && ctx.myLast.m && ctx.myLast.m.tag === 'lebx' && ctx.mine.length === 1 && ctx.rhoCall === 'P' && ctx.lb.call === '3C' && ctx.lb.by === ctx.p) {
    const st = ctx.theirs[0].call[1], T = [T_('P', h => h.L.C >= 4 && h.L.C >= Math.max(...['S', 'H', 'D'].filter(s => s !== st).map(s => h.L[s])), MM(0, 7, { mn: { C: 4 } }))];
    for (const s of ['S', 'H', 'D']) if (s !== st && ctx.ok('3' + s)) T.push(T_('3' + s, h => longest(h, [st, 'C']) === s, MM(0, 7, { mn: { [s]: 4 }, t: 'signoff' })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  // partner's responsive double: bid a suit (or notrump), don't defend
  if (!BID_OFF('resp2') && pl && pl.call === 'X' && pl.m && pl.m.tag === 'xresp' && ctx.rhoCall === 'P' && ctx.lb && !sameSide(ctx.lb.by, ctx.seat) && ctx.mine.length === 1) {
    const st = ctx.lb.call[1], mine1 = ctx.myLast.call !== 'X' && bidValue(ctx.myLast.call) >= 0 ? ctx.myLast.call[1] : null, T = [];
    const cand = SUITS.filter(s => s !== st && s !== mine1 && !ctx.oppSuits.includes(s));
    const best = h => cand.slice().sort((a, b) => (h.L[b] + (MAJ(b) ? 0.5 : 0)) - (h.L[a] + (MAJ(a) ? 0.5 : 0)))[0];
    if (mine1 && ctx.cheap(mine1) <= 3) T.push(T_(ctx.cheap(mine1) + mine1, h => h.L[mine1] >= 6, MM(0, 37, { mn: { [mine1]: 6 } })));
    if (ctx.cheap('N') <= 3) T.push(T_('3N', h => h.H >= 16 && stopper(h, st), MM(16, 37, { nt: true })));
    for (const x of cand) if (ctx.cheap(x) <= 3) T.push(T_(ctx.cheap(x) + x, h => best(h) === x && h.L[x] >= 3, MM(0, 37, { mn: { [x]: 3 } })));
    if (ctx.cheap('N') <= 2) T.push(T_(ctx.cheap('N') + 'N', h => stopper(h, st), MM(0, 37, { nt: true })));
    if (mine1 && ctx.cheap(mine1) <= 3) T.push(T_(ctx.cheap(mine1) + mine1, () => true, ANY()));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  // partner doubled their contract for penalty and it came round to me: leave it in
  if (!BID_OFF('xpass') && pl && pl.call === 'X' && pl.m && pl.m.tag === 'xpen' && ctx.rhoCall === 'P' && lastNonPass(ctx.prefix) === ctx.prefix[pl.i] && +ctx.lb.call[0] >= 3) return [T_('P', () => true, ANY())];
  // ... at the two level too, unless I have a void in their suit and a long suit of my own
  if (!BID_OFF('xpass2') && !ctx.gf && pl && pl.call === 'X' && pl.m && pl.m.tag === 'xpen' && ctx.rhoCall === 'P' && lastNonPass(ctx.prefix) === ctx.prefix[pl.i] && +ctx.lb.call[0] === 2 && ctx.lb.call[1] !== 'N') {
    const st = ctx.lb.call[1];
    return [T_('P', h => !(h.L[st] === 0 && h.sh[0] >= 6) && h.H + ctx.P.lo < 25, ANY()), { nat: true }];
  }
  // they came in over our strong 2♣
  if (!BID_OFF('int2c') && ctx.weOpened && ctx.first.call === '2C' && ctx.first.m && ctx.first.m.art && ctx.ours.length === 1 && ctx.theirs.length === 1 && bidValue(ctx.theirs[0].call) >= 0 && ctx.lb === ctx.theirs[0]) {
    const st = ctx.lb.call[1], T = [];
    if (ctx.opener === ctx.p && ctx.rhoCall !== 'P' && !ctx.mine.length) { // responder, directly over the overcall
      if (st !== 'N') T.push(T_('X', h => h.L[st] >= 4 && hon(h, st, 'AKQJT') >= 2 && h.H >= 4, MM(4, 37, { mn: { [st]: 4 }, a: 'Penalty', t: 'xpen' })));
      for (const x of ['S', 'H', 'D', 'C']) if (x !== st && ctx.cheap(x) <= 3) T.push(T_(ctx.cheap(x) + x, h => h.L[x] >= 5 && hon(h, x) >= 2 && h.H >= 7, MM(7, 37, { mn: { [x]: 5 }, f: 2, a: 'Positive: good 5+ card suit' })));
      if (st !== 'N' && ctx.cheap('N') <= 3) T.push(T_(ctx.cheap('N') + 'N', h => h.H >= 7 && stopper(h, st), MM(7, 37, { nt: true, stop: [st], a: 'Positive, with a stopper' })));
      T.push(T_('P', () => true, MM(0, 37, { a: 'Waiting', t: 'wait' })));
      return T;
    }
    if (ctx.opener === ctx.seat && ctx.rhoCall === 'P' && ctx.lb.by === ctx.lho) { // opener, partner passed (waiting)
      if (st !== 'N') T.push(T_('X', h => h.L[st] >= 3 && hon(h, st, 'AKQJT') >= 2 && h.semi, MM(22, 37, { mn: { [st]: 3 }, a: 'Penalty', t: 'xpen' })));
      if (st !== 'N' && ctx.cheap('N') <= 3) T.push(T_(ctx.cheap('N') + 'N', h => h.semi && stopper(h, st), MM(22, 37, { nt: true, stop: [st] })));
      for (const x of ['S', 'H', 'D', 'C']) if (x !== st && ctx.cheap(x) <= 4) T.push(T_(ctx.cheap(x) + x, h => longest(h, [st]) === x && h.L[x] >= 5, MM(20, 37, { mn: { [x]: 5 }, f: 2 })));
      if (st !== 'N') T.push(T_('X', () => true, MM(22, 37, { mx: { [st]: 2 }, a: 'Strong hand, takeout', t: 'x2c' })));
      return T.concat([{ nat: true }]);
    }
  }
  // 1x (X) XX and they ran: doubles are for penalty, opener's pass is forcing, the redoubler doubles or bids
  if (!BID_OFF('xxrun')) { const r = afterXXRun(ctx); if (r) return r; }
  if (!BID_OFF('xreb')) { const r = doublerRebid(ctx); if (r) return r; }
  // I opened, partner passed, RHO came in: strong takeout double, else natural
  if (!BID_OFF('xstrong') && ctx.weOpened && ctx.opener === ctx.seat && /^1[CDHS]$/.test(ctx.first.call) && ctx.ours.length === 1 && ctx.pards.length === 0 && ctx.theirs.length === 1 && ctx.lb === ctx.theirs[0] && ctx.lb.by === ctx.rho && ctx.ok('X')) {
    const dm = dblMeaning(ctx), os = ctx.lb.call[1];
    if (dm.tag === 'xreopen' && os !== 'N' && !(ctx.lb.m && ctx.lb.m.art)) return [T_('X', h => h.H >= 16 && h.L[os] <= 2 && !(h.L[ctx.first.call[1]] >= 6 && h.L[os] >= 2), dm), { nat: true }];
  }
  // I opened, they overcalled at the two level, I reopened with a double and partner advanced in a major at the two level: raise with support and extras (rxr)
  if (!BID_OFF('rxr') && ctx.weOpened && ctx.opener === ctx.seat && ctx.mine.length === 2 && ctx.myLast.call === 'X' && ctx.myLast.m && ctx.myLast.m.tag === 'xreopen' && ctx.pards.length === 1
    && ctx.theirs.length === 1 && ctx.theirs[0].call[0] === '2' && ctx.lb === ctx.pLast && ctx.rhoCall === 'P' && /^2[HS]$/.test(ctx.pLast.call) && !(ctx.pLast.m && (ctx.pLast.m.art || ctx.pLast.m.f)) && ctx.pLast.call[1] !== ctx.first.call[1]) {
    const r = ctx.pLast.call[1], k3 = BID_K('rx3') ?? 17, k4 = BID_K('rx4') ?? 20, T = [];
    // (three-card support needs more: these calls are the table's, so natural bidding can't make them)
    if (ctx.ok('4' + r)) T.push(T_('4' + r, h => (h.L[r] >= 4 && supPts(h, r) >= k4) || (h.L[r] === 3 && h.H >= k4), MM(k4 - 3, 37, { mn: { [r]: 3 }, agree: r })));
    if (ctx.ok('3' + r)) T.push(T_('3' + r, h => (h.L[r] >= 4 && supPts(h, r) >= k3) || (h.L[r] === 3 && h.H >= k3 + 1), MM(k3 - 3, k4, { mn: { [r]: 3 }, agree: r, inv: true, a: 'Invites game: support and extra values' })));
    if (T.length) return T.concat([{ nat: true }]);
  }
  // Support doubles: 1x - 1M by partner, RHO doubles or bids up to 2♥; X (XX over a double) = exactly 3-card support
  if (!BID_OFF('supx') && supXSpot(ctx)) return supXTable(ctx);
  if (!BID_OFF('supx') && pl && pl.m && pl.m.tag === 'supx' && ctx.rhoCall === 'P' && ctx.mine.length === 1 && ctx.myLast.i === pl.i - 2) return afterSupX(ctx);
  return null;
}
function doublerRebid(ctx) { // I made a takeout double, partner advanced in a suit without jumping, RHO passed
  const pl = ctx.pLast, ml = ctx.myLast;
  if (ctx.weOpened || ctx.mine.length !== 1 || ctx.pards.length !== 1 || !ml || ml.call !== 'X' || !ml.m || ml.m.tag !== 'xto' || ctx.rhoCall !== 'P') return null;
  if (!pl || pl.i < ml.i || ctx.lb !== pl || bidValue(pl.call) < 0 || !pl.m || pl.m.art || pl.m.f || pl.m.inv || pl.m.hi > 11 || pl.m.lo > 6) return null;
  const s = pl.call[1], their = ctx.oppSuits, bal = (ml.m.lo <= 9 ? 3 : 0) + (pl.m.lo >= 6 ? 3 : 0); // after a balancing double partner has bid some of my values; a free bid shows some
  const stops = h => their.every(x => stopper(h, x)), nt = ctx.cheap('N'), T = [];
  if (s === 'N') {
    if (nt <= 3) T.push(T_('3N', h => h.H >= 19 - bal, MM(19 - bal, 37, { nt: true })));
    T.push(T_('P', () => true, ANY()));
    return T;
  }
  const gl = gameLevel(s), l = ctx.cheap(s), sp = h => supPts(h, s);
  const g4 = (l >= 4 ? 18 : 22) - bal, n4 = l >= 4 ? 3 : 4; // partner was forced to the three level: raise to game with less
  if (MAJ(s) && l <= 4) T.push(T_('4' + s, h => h.L[s] >= n4 && sp(h) >= g4, MM(g4, 37, { mn: { [s]: n4 }, agree: s })));
  if (nt <= 3) T.push(T_('3N', h => h.H >= (nt === 3 ? (BID_K('x3n') ?? 20) : (BID_K('x3nl') ?? 22)) - bal && stops(h) && !(MAJ(s) && h.L[s] >= 4), MM((nt === 3 ? (BID_K('x3n') ?? 20) : (BID_K('x3nl') ?? 22)) - bal, 37, { nt: true, stop: their })));
  if (l + 1 < gl && l + 1 <= 3) T.push(T_((l + 1) + s, h => h.L[s] >= 4 && sp(h) >= 19 - bal, MM(19 - bal, 21, { mn: { [s]: 4 }, agree: s, inv: true, a: 'Invites game: strong double with support' })));
  if (l < gl && l <= 3) T.push(T_(l + s, h => h.L[s] >= 4 && sp(h) >= (BID_K('xr1') ?? 18) - bal, MM((BID_K('xr1') ?? 18) - bal, 18, { mn: { [s]: 4 }, agree: s, inv: true })));
  if (nt <= 2) T.push(T_(nt + 'N', h => h.semi && h.H >= 18 - bal && stops(h), MM(18 - bal, 20, { nt: true, stop: their, a: nt === 1 ? '18-20 points, balanced' : 'Strong, balanced, invites game' })));
  if (BID_OFF('xown')) { for (const x of ['S', 'H', 'D', 'C']) if (x !== s && !their.includes(x) && ctx.cheap(x) <= 3) T.push(T_(ctx.cheap(x) + x, h => h.L[x] >= 5 && h.H >= 18 - bal && longest(h, their) === x && h.L[s] <= 3, MM(18 - bal, 37, { mn: { [x]: 5 } }))); }
  else { // my own long suit: counted with its length; a major goes to game when partner was pushed to the four level or I have game on my own
    const xp = (h, x) => h.H + Math.max(0, h.L[x] - 5);
    for (const x of ['S', 'H', 'D', 'C']) {
      if (x === s || their.includes(x)) continue;
      const cx = ctx.cheap(x), own = h => h.L[x] >= 5 && longest(h, their) === x && (h.L[s] <= 3 || h.L[x] >= 6 && !MAJ(s));
      if (MAJ(x) && cx <= 4 && ctx.ok('4' + x)) T.push(T_('4' + x, h => own(h) && (cx === 4 ? xp(h, x) >= (BID_K('x4') ?? 20) - bal : h.L[x] >= 6 && xp(h, x) >= (BID_K('xj') ?? 21)), MM(cx === 4 ? 17 - bal : 19, 37, { mn: { [x]: cx === 4 ? 5 : 6 } })));
      if (cx <= 3) T.push(T_(cx + x, h => own(h) && xp(h, x) >= (BID_K("xrb") ?? 18) - bal, MM(16 - bal, 37, { mn: { [x]: 5 } })));
    }
  }
  T.push(T_('P', () => true, MM(ml.m.lo, 17 - bal)));
  return T;
}
function afterXXRun(ctx) {
  if (!ctx.weOpened || !/^1[CDHS]$/.test(ctx.first.call) || ctx.ours.length < 2) return null;
  const xx = ctx.ours[1];
  if (xx.call !== 'XX' || !xx.m || xx.m.tag !== 'xx' || xx.by === ctx.first.by) return null;
  const run = ctx.theirs.filter(y => y.i > xx.i && bidValue(y.call) >= 0);
  if (run.length !== 1 || ctx.lb !== run[0] || run[0].call[1] === 'N' || (run[0].m && run[0].m.art) || bidValue(run[0].call) >= bidValue('2' + ctx.first.call[1])) return null;
  const y = run[0].call[1], t = ctx.first.call[1], T = [];
  const pen = (lo, n) => MM(lo, 37, { mn: { [y]: n }, a: `Penalty (after our redouble)`, t: 'xpen' });
  const pl = ctx.pLast;
  if (pl && pl.call === 'X' && pl.i > run[0].i && ctx.rhoCall === 'P' && lastNonPass(ctx.prefix) === ctx.prefix[pl.i]) return [T_('P', () => true, ANY())]; // partner doubled them: defend
  if (ctx.ours.length !== 2) return null;
  if (ctx.seat === ctx.first.by && ctx.rhoCall !== 'P' && ctx.mine.length === 1) { // opener, directly over the runout
    T.push(T_('X', h => h.L[y] >= 4 && hon(h, y, 'AKQJT') >= 2, pen(11, 4)));
    T.push(T_('P', h => !(h.L[t] >= 6 && h.L[y] <= 1) && !(h.sh[0] >= 5 && h.sh[1] >= 5 && h.L[y] <= 1), MM(11, 21, { a: 'Forcing pass: partner doubles or bids', t: 'fpass' })));
    return T.concat([{ nat: true }]);
  }
  if (ctx.seat === xx.by && ctx.mine.length === 1 && !ctx.items.some(x => x.by === ctx.p && x.i > xx.i && x.call !== 'P')) { // the redoubler, opener passed
    const nt = ctx.cheap('N');
    T.push(T_('X', h => (h.L[y] >= 3 && hon(h, y, 'AKQJ') >= 2 || h.L[y] >= 4 && hon(h, y, 'AKQJT') >= 1) && !(MAJ(t) && h.L[t] >= 3 && hon(h, y, 'AKQJ') < 2), pen(10, 3)));
    if (nt <= 3) T.push(T_('3N', h => h.H >= 14 && stopper(h, y), MM(14, 37, { nt: true, stop: [y] })));
    T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= (MAJ(t) ? 3 : 4) && ctx.cheap(t) <= 3, MM(10, 37, { mn: { [t]: MAJ(t) ? 3 : 4 }, agree: t })));
    if (nt <= 2) T.push(T_(nt + 'N', h => stopper(h, y), MM(10, 13, { nt: true, stop: [y] })));
    for (const s of ['S', 'H', 'D', 'C']) if (s !== y && s !== t && ctx.cheap(s) <= 2) T.push(T_(ctx.cheap(s) + s, h => h.L[s] >= 4 && longest(h, [y, t]) === s, MM(10, 37, { mn: { [s]: 4 }, f: 1 })));
    const lg = h => longest(h, [y]);
    for (const s of ['S', 'H', 'D', 'C']) if (s !== y && ctx.cheap(s) <= 3) T.push(T_(ctx.cheap(s) + s, h => lg(h) === s && h.L[s] >= 4, MM(10, 37, { mn: { [s]: 4 } })));
    T.push(T_('X', () => true, pen(10, 2)));
    return T;
  }
  return null;
}
function supXSpot(ctx) {
  const n = ctx.prefix.length, pl = ctx.pLast;
  if (!ctx.first || ctx.first.by !== ctx.seat || !/^1[CDH]$/.test(ctx.first.call) || ctx.mine.length !== 1 || ctx.pards.length !== 1) return false;
  if (!pl || pl.i !== n - 2 || !/^1[HS]$/.test(pl.call) || pl.call[1] === ctx.first.call[1] || !pl.m || pl.m.art) return false;
  const rc = ctx.rhoCall;
  if (rc === 'X') return ctx.legal.includes('XX');
  return bidValue(rc) >= 0 && bidValue(rc) <= bidValue('2H') && rc[1] !== pl.call[1] && ctx.legal.includes('X');
}
function supXTable(ctx) {
  const y = ctx.pLast.call[1], c = ctx.rhoCall === 'X' ? 'XX' : 'X';
  return [T_(c, h => h.L[y] === 3, MM(11, 21, { mn: { [y]: 3 }, mx: { [y]: 3 }, a: `Support ${c === 'X' ? 'double' : 'redouble'}: exactly 3 ${SNAME[y]}`, t: 'supx' })), { nat: true }];
}
function afterSupX(ctx) { // partner showed exactly 3 cards in my major
  const y = ctx.myLast.call[1], lb = ctx.lb, os = lb.by !== ctx.p && lb.call[1] !== 'N' ? lb.call[1] : null, T = [];
  const t = ctx.first.call[1], cy = ctx.cheap(y);
  if (cy <= 4) T.push(T_('4' + y, h => h.L[y] >= 5 && supPts(h, y) >= 13 || h.L[y] >= 4 && h.H >= 13 && !(os && stopper(h, os) && h.L[y] === 4), MM(13, 37, { agree: y })));
  if (os && ctx.cheap('N') <= 3) T.push(T_('3N', h => h.H >= 13 && stopper(h, os), MM(13, 37, { nt: true, stop: [os] })));
  if (cy <= 2 && ctx.ok('3' + y)) T.push(T_('3' + y, h => h.L[y] >= 5 && h.H >= 10, MM(10, 12, { mn: { [y]: 5 }, agree: y, inv: true })));
  if (os && ctx.ok('P') && +lb.call[0] <= 2) T.push(T_('P', h => h.L[os] >= 4 && hon(h, os, 'AKQJT') >= 2 && h.H >= 9 && h.L[y] <= 4, MM(9, 37, { mn: { [os]: 4 }, a: 'Defends their contract doubled' })));
  if (os && ctx.cheap('N') === 2) T.push(T_('2N', h => h.H >= 11 && h.H <= 12 && stopper(h, os), MM(11, 12, { nt: true, inv: true, stop: [os] })));
  if (cy <= 3) T.push(T_(cy + y, h => h.L[y] >= 5 || (h.L[y] === 4 && h.L[t] <= 2), MM(6, 12, { mn: { [y]: 4 }, agree: y })));
  if (ctx.cheap(t) <= 3) T.push(T_(ctx.cheap(t) + t, h => h.L[t] >= (MIN(t) ? 4 : 3) && h.H <= 12, MM(6, 12, { mn: { [t]: 3 }, agree: t })));
  if (ctx.cheap('N') <= 2 && os) T.push(T_(ctx.cheap('N') + 'N', h => stopper(h, os) && h.H <= 10, MM(6, 10, { nt: true, stop: [os] })));
  if (cy <= 3) T.push(T_(cy + y, () => true, MM(6, 12)));
  T.push(T_('P', () => true, ANY()));
  return T;
}
function runFromXX(ctx, adv) {
  const st = ctx.lb.call[1], their = ctx.oppSuits.slice(); if (!their.includes(st)) their.push(st);
  const unbid = SUITS.filter(s => !their.includes(s));
  const best = h => unbid.slice().sort((a, b) => (h.L[b] + (MAJ(b) ? 0.5 : 0)) - (h.L[a] + (MAJ(a) ? 0.5 : 0)))[0];
  const T = [T_('P', h => (h.L[st] >= 5 && hon(h, st, 'AKQJT') >= 3) || (!BID_OFF('xxlong') && h.L[st] >= (BID_K('xxl') ?? 5) && h.L[best(h)] <= (BID_K('xxb') ?? 4)), MM(adv ? 3 : 12, 37, { mn: { [st]: 5 }, a: 'Wants to defend their contract redoubled' }))];
  for (const s of unbid) if (ctx.cheap(s) <= 2) T.push(T_(ctx.cheap(s) + s, h => best(h) === s, MM(0, adv ? 8 : 37, { mn: { [s]: adv ? 3 : 4 }, a: adv ? null : null })));
  T.push(T_('P', () => true, ANY()));
  return T;
}

// ---- Slam judgement (constructive auctions) ----
// Partner's expected strength is a little above the bottom of what partner has shown. With a trump fit, slam
// values come from losing-trick count (24 less both hands' losers) checked against points (high cards plus
// shortness or length); in notrump from high cards alone.
function pExp(ctx) { const P = ctx.P; return P.lo + Math.min(BID_K('pec') ?? 3, (Math.min(P.hi, P.lo + 9) - P.lo) * (BID_K('pef') ?? 0.3)); }
function slamVal(ctx, h, tr) { // { pts, tricks } for a slam in tr, my hand plus what partner is expected to hold
  const pe = pExp(ctx);
  if (tr === 'N') return { pts: h.H + pe, tricks: 0 };
  // kings, queens and jacks opposite partner's singleton or void are worth little
  const waste = BID_OFF('waste') ? 0 : SUITS.filter(s => s !== tr && ctx.P.mx[s] <= 1).reduce((t, s) => t + h.sp[s] - (h.has[s].includes('A') ? 4 : 0), 0);
  const mine = (h.L[tr] >= Math.max(5, ctx.P.mn[tr]) ? ownPts(h, tr) : supPts(h, tr)) - waste;
  const pL = Math.max(3, Math.min(10, 7.5 - (pe - 12) / 3));
  return { pts: mine + pe, tricks: 24 - ltc(h) - pL };
}
// A major agreed outside a game-forcing auction, slam values but one side suit with two fast losers: a new suit
// below four of the major is a control bid (and makes the auction game forcing), so partner can show that control.
function agreedMajor(ctx) {
  let tr = null;
  for (const x of ctx.ours) if (x.m && x.m.agree) tr = x.m.agree;
  return tr && MAJ(tr) && ctx.Me.mn[tr] + ctx.P.mn[tr] >= 8 ? tr : null;
}
function ctlBidMeaning(ctx, call) {
  if (BID_OFF('ctl2') || !ctx.quiet || !ctx.weOpened || !ctx.pards.length || !ctx.mine.length || bidValue(call) < 0) return null;
  if (humanMean(ctx, call)) return null; // e.g. a help-suit game try after 1M-2M
  const tr = agreedMajor(ctx), st = call[1], lb = ctx.lb;
  if (!tr || st === tr || st === 'N' || !lb || !sameSide(lb.by, ctx.seat) || bidValue(call) >= bidValue('4' + tr) || +call[0] < 3) return null;
  if (ctx.ours.some(x => bidValue(x.call) >= 0 && x.call[1] === st && !(x.m && x.m.art))) return null;
  return Object.assign(MM(Math.max(ctx.Me.lo + 2, BID_OFF('ctl2lo') ? 0 : 29 - SD() - Math.round(pExp(ctx))), 37, { art: true, f: 2, agree: tr, a: `Control bid: ace, king, singleton or void in ${SNAME[st]}; slam interest in ${SNAME[tr]}`, t: 'ctl' }), { ctlS: st });
}
function slamCtl(ctx, h, T, call) {
  if (BID_OFF('ctl2') || !ctx.quiet || !ctx.weOpened || !ctx.pards.length || !ctx.mine.length || ctlTrump(ctx) || rkcbTable(ctx)) return null;
  if (call === '4N' || (bidValue(call) >= 0 && +call[0] >= 6) || (ctx.pLast.m && /^(signoff|csign)$/.test(ctx.pLast.m.tag))) return null;
  if (ctx.ours.some(x => x.call === '4N' || (x.m && /^(rkcb|quant|rkr|qask|place|ctl)$/.test(x.m.tag)))) return null;
  const tr = agreedMajor(ctx);
  if (!tr || h.L[tr] < 3 || !slamValues(ctx, h, tr) || openSuits(ctx, h, tr) !== 1) return null;
  const ctl = s => h.has[s].includes('A') || h.has[s].includes('K') || h.L[s] <= 1;
  const cues = SUITS.filter(s => s !== tr && ctl(s)).map(s => ctx.cheap(s) + s).filter(c => ctx.ok(c) && !(T && T.some(d => d.c === c)) && ctlBidMeaning(ctx, c)).sort((a, b) => bidValue(a) - bidValue(b));
  return cues[0] || null;
}
function slamAsk(ctx, h, T, call) { // the call chosen stops below slam, but a fit and slam values say: ask for key cards
  if (BID_OFF('slamask') || !ctx.quiet || !ctx.weOpened || !ctx.pards.length || !ctx.mine.length || !ctx.ok('4N')) return null;
  if (call === '4N' || (bidValue(call) >= 0 && +call[0] >= 6) || rkcbTable(ctx) || (ctx.pLast.m && ctx.pLast.m.tag === 'signoff')) return null;
  if (ctx.ours.some(x => x.call === '4N' || (x.m && /^(rkcb|quant|rkr|qask|place)$/.test(x.m.tag)))) return null;
  const ds = T ? T.filter(d => d.c === '4N') : [];
  if (ds.length) return null; // the table has its own slam test
  const m = natMean(ctx, '4N');
  if (!m || m.tag !== 'rkcb' || !m.trump) return null;
  const tr = m.trump;
  if (h.L[tr] + ctx.P.mn[tr] < 8 || h.L[tr] < 2) return null;
  return slamZone(ctx, h, tr) ? '4N' : null;
}
// Control bids: once a major is agreed in a game-forcing auction, a new suit below four of the major shows
// first- or second-round control (ace, king, singleton or void) and slam interest, cheapest first. With every
// side suit controlled between the two hands, ask for key cards; without interest, sign off in four of the major.
function ctlTrump(ctx) {
  if (BID_OFF('ctl') || !ctx.quiet || !ctx.weOpened || !ctx.gf || !ctx.mine.length || !ctx.pards.length) return null;
  let tr = null;
  for (const x of ctx.ours) if (x.m && x.m.agree) tr = x.m.agree;
  if (!tr || !MAJ(tr) || ctx.Me.mn[tr] + ctx.P.mn[tr] < 8) return null;
  const lb = ctx.lb;
  if (!lb || !sameSide(lb.by, ctx.seat) || bidValue(lb.call) >= bidValue('4' + tr)) return null;
  if (ctx.ours.some(x => x.call === '4N' || (x.m && /^(rkcb|quant|jacoby|splinter)$/.test(x.m.tag) && x === ctx.pLast))) return null;
  if (ctx.pLast.m && ctx.pLast.m.tag === 'jacoby') return null;
  return tr;
}
function ctlTable(ctx) {
  const tr = ctlTrump(ctx); if (!tr) return null;
  const shownBy = who => new Set(ctx.ours.filter(x => x.by === who && x.m && x.m.tag === 'ctl').map(x => x.m.ctlS));
  const pCtl = shownBy(ctx.p), myCtl = shownBy(ctx.seat);
  const ctl = (h, s) => h.has[s].includes('A') || h.has[s].includes('K') || h.L[s] <= 1;
  const side = SUITS.filter(s => s !== tr);
  const pCued = pCtl.size > 0;
  const interest = h => { const v = slamVal(ctx, h, tr); if (h.L[tr] + ctx.P.mn[tr] < 8) return false; return v.pts >= SLAM_PTS - (pCued ? 2 : 1) || (v.pts >= SLAM_PTS - (pCued ? 3 : 2) && v.tricks >= SLAM_TR); };
  const allCovered = h => side.every(s => ctl(h, s) || pCtl.has(s));
  const T = [];
  T.push(T_('4N', h => interest(h) && allCovered(h) && slamVal(ctx, h, tr).pts >= SLAM_PTS - (pCued ? 1 : 0), MM(ctx.Me.lo, 37, { t: 'rkcb', trump: tr, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[tr]}: asks for key cards (4 aces and the trump king)` })));
  const cues = side.map(s => ctx.cheap(s) + s).filter(c => bidValue(c) < bidValue('4' + tr) && ctx.ok(c)).sort((a, b) => bidValue(a) - bidValue(b));
  for (const c of cues) {
    const s = c[1];
    T.push(T_(c, h => interest(h) && ctl(h, s) && !(myCtl.has(s)), Object.assign(MM(ctx.Me.lo, 37, { art: true, f: 1, agree: tr, a: `Control bid: ace, king, singleton or void in ${SNAME[s]}; slam interest in ${SNAME[tr]}`, t: 'ctl' }), { ctlS: s })));
  }
  // over partner's slow raise (slam interest) four of the major only says "no interest": partner may still go on
  const pSlow = ctx.pLast && ctx.pLast.m && ctx.pLast.m.tag === 'slow' && !BID_OFF('csign');
  T.push(T_('4' + tr, () => true, MM(ctx.Me.lo, pSlow ? ctx.Me.lo + 4 : 37, { agree: tr, t: pSlow ? 'csign' : 'signoff' })));
  return T;
}
// 2♣-2♦-3NT (25-27 balanced): responder raises to slam on points, invites with 4NT, or transfers to a major.
function resp2C3N(ctx) {
  return [
    T_('7N', h => h.H >= 12, MM(12, 37)),
    T_('6N', h => h.H >= 8 && h.sh[0] <= 6, MM(8, 11)),
    T_('4N', h => h.H >= 6 && h.sh[0] <= 5, MM(6, 7, { t: 'quant', a: 'Quantitative: invites 6NT' })),
    T_('4H', h => h.L.S >= 6, MM(0, 37, { mn: { S: 6 }, art: true, a: 'Texas transfer: 6+ spades', t: 'texas' })),
    T_('4D', h => h.L.H >= 6, MM(0, 37, { mn: { H: 6 }, art: true, a: 'Texas transfer: 6+ hearts', t: 'texas' })),
    T_('P', () => true, MM(0, 5)),
  ];
}
function natRescue(ctx, h, T, call) { // a table with no fitting call fell back to natural bidding, which passed below game
  // only because the natural call is listed in the table with a different hand: bid it if it means nothing artificial
  if (BID_OFF('rescue') || call !== 'P' || !T || !ctx.quiet || !ctx.weOpened || !ctx.pards.length || ourGame(ctx)) return null;
  if (T.some(d => d.c === 'P' && !d.nat && d.w(h))) return null;
  const c = natural(ctx, h, new Set());
  if (c === 'P' || !ctx.ok(c)) return null;
  const ds = T.filter(d => d.c === c);
  if (ds.some(d => d.m.art || d.m.tag === 'signoff')) return null;
  return c;
}
let SLAM_PTS = 30, SLAM_TR = 11;
if (BID_K('sp') !== undefined) SLAM_PTS = BID_K('sp');
if (BID_K('st') !== undefined) SLAM_TR = BID_K('st');
function slamZone(ctx, h, tr) { // worth a slam try: values, and no side suit where we may have two fast losers
  if (BID_OFF('slamzone')) return false;
  const v = slamVal(ctx, h, tr);
  if (tr === 'N') return v.pts >= (BID_K('nts') ?? 31);
  return slamValues(ctx, h, tr) && openSuits(ctx, h, tr) === 0;
}
function slamValues(ctx, h, tr) { const v = slamVal(ctx, h, tr); return v.pts >= SLAM_PTS + 2 || (v.pts >= SLAM_PTS && v.tricks >= SLAM_TR); }

// ---- Which table applies ----
function tablesFor(ctx) {
  const see = seeThrough(ctx); if (see) return see;
  const rk = rkcbTable(ctx); if (rk) return rk;
  if (!ctx.first) return openingTable(ctx);
  const nt = ntSystem(ctx); if (nt) return nt;
  const cb = ctlTable(ctx); if (cb) return cb;
  const seq = ctx.seq, k = seq.length, pl = ctx.pLast;
  if (ctx.quiet && ctx.weOpened) {
    const c0 = seq[0];
    if (k === 1 && ctx.opener === ctx.p) {
      if (/^1[HS]$/.test(c0)) return resp1M(ctx);
      if (/^1[CD]$/.test(c0)) return resp1m(ctx);
      if (c0 === '2C') return resp2C(ctx);
      if (/^2[DHS]$/.test(c0)) return respWeak2(ctx);
      if (/^3[CDHS]$/.test(c0)) return respPre(ctx);
      return null;
    }
    if (k === 2 && ctx.opener === ctx.seat && pl) {
      const c1 = seq[1], m1 = pl.m || ANY();
      if (/^1[HS]$/.test(c0)) {
        const t = c0[1];
        if (c1 === '1N') return reb1M1N(ctx);
        if (c1 === '2' + t) return reb1M2M(ctx);
        if (c1 === '3' + t && m1.tag === 'limit') return [T_('4N', h => h.H >= 20 - SD() && openSuits(ctx, h, t) === 0, MM(20, 21, { t: 'rkcb', trump: t, art: true, f: 1, a: `Roman Key Card Blackwood (1430) for ${SNAME[t]}: asks for key cards (4 aces and the trump king)` })), ...(!BID_OFF('lrk') && ctx.ok(BID_K('lr3') ? '3N' : '4C') && !(m1.mn && m1.mn[t] < 4) ? [T_(BID_K('lr3') ? '3N' : '4C', h => h.H >= 15 && ownPts(h, t) >= (BID_K('lrk') ?? 18) && openSuits(ctx, h, t) === 0, MM(15, 21, { t: 'lrask', trump: t, art: true, f: 1, a: `Slam try: asks whether the limit raise is a maximum (${BID_K('lr3') ? '4♣' : '4♦'} yes, 4${SSYM[t]} no)` }))] : []), T_('4' + t, h => ownPts(h, t) >= 14 || (m1.lo <= 3 && false), MM(13, 21)), T_('P', () => true, MM(11, 13))];
        if (m1.tag === 'jacoby') return reb1MJ(ctx);
        if (m1.tag === 'splinter') return rebSplinter(ctx);
        if (m1.tag === '21') return reb21(ctx);
        if (c1 === '1S') return reb1m(ctx);
        if (m1.tag === 'pre' && c1 === '4' + t) return [T_('P', () => true, ANY())];
        return null;
      }
      if (/^1[CD]$/.test(c0)) return reb1m(ctx);
      if (c0 === '2C') return reb2C(ctx);
      if (/^2[DHS]$/.test(c0) && m1.tag === 'feature') return featAnswer(ctx);
      if (/^2[DHS]$/.test(c0) && m1.f >= 1 && bidValue(c1) >= 0) { const s = c1[1]; return [T_(ctx.cheap(s) + s, h => h.L[s] >= 3 || (h.L[s] >= 2 && h.H >= 9), MM(5, 10, { mn: { [s]: 2 }, agree: s })), T_(ctx.cheap(c0[1]) + c0[1], () => true, MM(5, 10))]; }
      return null;
    }
    if (k === 3 && ctx.opener === ctx.p && pl) {
      const c1 = seq[1], m0 = ctx.items[ctx.ours[1].i].m || ANY();
      if (/^1[HS]$/.test(c0) && pl.m && pl.m.tag === 'hsgt') return gameTryAnswer(ctx);
      if (/^1[HS]$/.test(c0) && c1 === '1N') return resp1M1N(ctx);
      if (/^1[HS]$/.test(c0) && m0.tag === 'jacoby') return respJ2N2(ctx);
      if (/^1[HS]$/.test(c0) && m0.tag === 'splinter') return [T_('P', () => true, ANY())];
      if (pl.m && pl.m.inv && pl.m.agree && !pl.m.art) { const s = pl.m.agree; return acceptInv(ctx, gameLevel(s) + s, ctx.Me.lo + Math.min(2, (ctx.Me.hi - ctx.Me.lo) / 2)); }
      if (/^1[CDH]$/.test(c0) && /^1[DHS]$/.test(c1)) return resp1mReb(ctx);
      if (c0 === '2C' && c1 === '2D' && seq[2] === '3N' && !BID_OFF('2c3n')) return resp2C3N(ctx);
      if (c0 === '2C' && c1 === '2D') return resp2C2(ctx);
      if (/^2[DHS]$/.test(c0) && m0.tag === 'feature') return featCont(ctx);
      return null;
    }
    if (k === 4 && ctx.opener === ctx.seat) {
      const m3 = pl.m || ANY();
      if (m3.tag === 'nmf') return nmfAnswer(ctx);
      if (m3.tag === 'texas' && seq[0] === '2C') { const s = seq[3] === '4D' ? 'H' : 'S'; return [T_('4' + s, () => true, MM(25, 27, { art: true, a: 'Completes the transfer' }))]; }
      if (m3.tag === 'fsf') return fsfAnswer(ctx);
      if (m3.inv && m3.agree && !m3.art && !ctx.gf) { const s = m3.agree; return acceptInv(ctx, gameLevel(s) + s, ctx.Me.lo + Math.min(2, (ctx.Me.hi - ctx.Me.lo) / 2)); }
      if (seq[2] === '2N' && /^1[HS]$/.test(seq[1]) && seq[3] === '3' + seq[1][1]) { const r = seq[1][1]; return [T_('4' + r, h => h.L[r] >= 3, ANY()), T_('3N', () => true, ANY())]; }
      if (m3.inv && ctx.lb.call === '2N' && ctx.lb.by === ctx.p) return [T_('3N', h => h.H >= ctx.Me.lo + Math.min(2, (ctx.Me.hi - ctx.Me.lo) / 2), ANY()), T_('P', () => true, ANY())];
    }
    if (k === 5 && ctx.opener === ctx.p) {
      const m3 = ctx.items[ctx.ours[3].i].m || ANY();
      if (m3.tag === 'nmf') return nmfCont(ctx);
    }
    if (pl && pl.m && pl.m.tag === 'signoff' && ctx.rhoCall === 'P') return [T_('P', () => true, ANY())];
    return null;
  }
  // competitive auctions
  const more = compMore(ctx); if (more) return more;
  const fresh = pl && !ctx.items.some(x => x.by === ctx.seat && x.i > pl.i);
  if (fresh && pl.m && (ctx.rhoCall === 'P' || ctx.rhoCall === 'X' && pl.m.f >= 1)) {
    if (pl.m.tag === 'askminor') return askMinorAnswer(ctx);
    if (pl.m.tag === 'jordan' && ctx.first.by === ctx.seat) return afterJordan(ctx);
    if (pl.m.tag === 'cueraise' && ctx.mine.length === 1) return afterCueRaise(ctx);
    if (pl.m.tag === 'cue' && ctx.mine.length === 1 && ctx.myLast.m && ctx.myLast.m.tag === 'xto') return afterCueAdvance(ctx);
    if (pl.m.tag === 'xneg' && ctx.mine.length === 1 && ctx.first.by === ctx.seat) return afterNegX(ctx);
    if (pl.m.tag === 'xreopen' && ctx.mine.length === 0) return afterReopen(ctx);
  }
  if (!ctx.weOpened && !ctx.mine.some(x => x.call !== 'P') && !ctx.pards.length) return compDirect(ctx);
  const passedSince = !fresh; // I already passed over partner's call
  if (!ctx.weOpened && pl && ctx.pards.length === 1 && !ctx.mine.length && !passedSince) {
    if (pl.call === 'X' && pl.m && (pl.m.tag === 'xto')) return advanceX(ctx);
    if (pl.call === 'X' && ctx.lb.call === '1N' && ctx.rhoCall === 'P') return [...['S', 'H', 'D', 'C'].map(x => T_('2' + x, h => h.H <= 5 && h.L[x] >= 5 && longest(h) === x, MM(0, 5, { mn: { [x]: 5 }, t: 'signoff' }))), T_('P', () => true, ANY())];
    return advanceOvc(ctx);
  }
  if (ctx.weOpened && ctx.opener === ctx.p && ctx.ours.length === 1 && !ctx.mine.length && !passedSince && /^1[CDHS]$/.test(ctx.first.call)) return respComp(ctx);
  if (ctx.weOpened && ctx.opener === ctx.seat && ctx.ours.length === 1 && ctx.pards.length === 0 && ctx.theirs.length === 1 && ctx.rhoCall === 'P' && ctx.lb.by === ctx.lho && /^1[CDHS]$/.test(ctx.first.call)) return reopen(ctx);
  return null;
}

// ---- Natural bidding when no table applies ----
function natural(ctx, h, reserved) {
  const P = ctx.P, lb = ctx.lb, ours = lb && sameSide(lb.by, ctx.seat);
  const ok = c => ctx.ok(c) && !reserved.has(c);
  const pBid = ctx.pards.some(x => bidValue(x.call) >= 0 || x.call === 'X');
  const pLo = pBid ? P.lo : 0, pe = pBid ? P.lo + Math.min(2, (Math.min(P.hi, P.lo + 10) - P.lo) / 3) : 3;
  // best fit
  let fit = null, fitLen = 0;
  for (const s of ['S', 'H', 'D', 'C']) {
    const tot = h.L[s] + P.mn[s];
    if (P.mn[s] >= 2 && tot >= 8 && (tot > fitLen + (MAJ(s) ? -1 : 1) || !fit)) { if (!fit || MAJ(s) && !MAJ(fit) || tot > fitLen && MAJ(s) === MAJ(fit)) { fit = s; fitLen = tot; } }
  }
  const myV = fit ? (h.L[fit] >= P.mn[fit] ? ownPts(h, fit) : supPts(h, fit)) : h.H + Math.max(0, h.sh[0] - 5);
  const total = myV + pe, totLo = myV + pLo;
  const opp = ctx.oppSuits;
  const ntOK = opp.every(s => stopper(h, s) || P.mn[s] >= 4 || P.nt) && (h.semi || P.nt || P.bal);
  let strain;
  if (fit && MAJ(fit)) strain = fit;
  else if (fit && !(ntOK && !ctx.quiet && !BID_OFF('mnt') && total >= 25 && total < 33 && !(h.L[fit] >= 6 && h.sh[3] <= 1))) strain = fit;
  else if (fit) strain = 'N'; // in competition, a minor fit, game values and their suits stopped: 3NT rather than the minor
  else if (h.L[longest(h, opp)] >= 6 && !(ntOK && h.semi && P.nt)) strain = longest(h, opp);
  else if (ntOK && (pBid || h.semi)) strain = 'N';
  else {
    const myLong = longest(h, opp);
    const pS = SUITS.filter(s => P.mn[s] >= 5).sort((a, b) => P.mn[b] - P.mn[a])[0];
    if (h.L[myLong] >= 6 || !pS || h.L[pS] < 2) strain = myLong; else strain = pS;
  }
  const gl = gameLevel(strain);
  const lvlFor = t => t >= 37 ? 7 : t >= (BID_K('n6') ?? 31) ? 6 : t >= (strain === 'N' || MAJ(strain) ? ((ctx.quiet || !BID_OFF('game24c')) && !BID_OFF('game24') ? (BID_K('g4') ?? 24) : 25) : (BID_K('g5m') ?? 27)) ? gl : t >= 23 ? Math.min(gl - 1, 3) : t >= 20 ? (strain === 'N' && !BID_OFF('nt2') ? 1 : 2) : t >= 17 ? 1 : 0;
  let target = lvlFor((total + totLo) / 2 >= (BID_K('n6') ?? 31) ? total : Math.min(total, (BID_K('n6') ?? 31) - 0.5));
  if (!pBid && !fit && !(h.L[strain] >= 6 && myV >= 12)) target = Math.min(target, 0);
  const oppNT = ctx.theirs.some(x => bidValue(x.call) >= 0 && x.call[1] === 'N' && x.m && x.m.nt);
  if (lb && !sameSide(lb.by, ctx.seat) && !fit && !ctx.forced && !(ctx.gf && !ourGame(ctx))) { // no fit and they hold the contract: bid on only with real values
    if (total < 23 || (strain === 'N' ? oppNT : h.L[strain] < 5)) target = 0;
  }
  if (!fit && strain !== 'N' && target > 2) { // no fit found: game only in notrump or with a long suit, no slam
    if (h.L[strain] + P.mn[strain] < 8 && !(h.L[strain] >= 7)) target = 3;
    if (!(h.L[strain] >= 7 && hon(h, strain) >= 2)) target = Math.min(target, gl);
  }
  const forcedGF = ctx.gf && !ourGame(ctx);
  const cheapS = ctx.cheap(strain);
  const lnp = lastNonPass(ctx.prefix);
  // slam
  if (target < 6 && pBid && ctx.quiet && (fit || strain === 'N') && (ctx.gf || ourGame(ctx) || total >= 28) && (ok('4N') || slamVal(ctx, h, strain).pts >= 34) && slamZone(ctx, h, strain)) target = 6;
  // game forcing with a major fit partner does not know about, and slam values: raise slowly (slam interest), so that
  // control bids and 4NT can follow in that suit
  if (!BID_OFF('slow') && fit && (MAJ(strain) || (cheapS >= 3 && !BID_OFF('slowm'))) && pBid && ctx.quiet && ctx.gf && !ourGame(ctx) && cheapS < gl && ok(cheapS + strain) && (target >= 6 || slamValues(ctx, h, strain))) {
    const m = natMean(ctx, cheapS + strain);
    if (m.tag === 'slow' && (openSuits(ctx, h, strain) > 0 || fourNTMeaning(ctx).trump !== strain)) return cheapS + strain;
  }
  if (target >= 6 && strain !== 'N' && openSuits(ctx, h, strain) > 0) target = gl;
  if (target >= 6 && pBid) {
    if (strain !== 'N' && fit && ok('4N') && !ctx.ours.some(x => x.call === '4N') && openSuits(ctx, h, strain) === 0) {
      const m4 = fourNTMeaning(ctx);
      if (m4.tag === 'rkcb' && m4.trump === strain) return '4N';
    }
    if (strain === 'N' && totLo >= 33 - SD() && ok('6N')) return '6N';
    if (strain === 'N' && ok('4N') && cheapS <= 4 && P.nt) return '4N';
    const c6 = (target === 7 && totLo >= 37 ? 7 : 6) + strain;
    if (ok(c6) && (totLo >= 32 - SD() || fitLen >= 9)) return c6;
    target = gl;
  }
  if (ours) {
    if (lb.by === ctx.p && +lb.call[0] >= gameLevel(lb.call[1]) && lb.call[1] !== strain && (lb.call[1] === 'N' || MAJ(lb.call[1]) && P.mn[lb.call[1]] + h.L[lb.call[1]] >= 7)) return 'P';
    if (lb.call[1] === strain && +lb.call[0] >= target) return forcedGF && +lb.call[0] < gl ? (ok(gl + strain) ? gl + strain : 'P') : (ctx.forced ? forcedBid(ctx, h, ok, fit) : 'P');
  }
  if ((forcedGF || ctx.forced) && !fit && strain !== 'N' && cheapS < gl && !(h.L[strain] >= 6 && target >= gl)) return forcedBid(ctx, h, ok, fit);
  // invitations: partner's range decides
  if (target < gl && pBid && (fit || strain === 'N') && !MIN(strain) && total >= 23 && myV + P.lo < (MIN(strain) ? 28 : 25) && P.hi - P.lo >= 3 && cheapS <= gl - 1 && !forcedGF && !ctx.mine.some(x => x.m && x.m.inv)) {
    const c = (gl - 1) + strain;
    if (ok(c) && !(lb && sameSide(lb.by, ctx.seat) && lb.call === c)) return c;
  }
  if (forcedGF && target < gl) target = gl;
  // forced without a fit: describe the hand cheaply rather than guess a contract
  if ((forcedGF || ctx.forced) && !fit && strain !== 'N' && cheapS < gl && !(h.L[strain] >= 6 && target >= gl)) return forcedBid(ctx, h, ok, fit);
  if (cheapS <= target) {
    const lvl = target >= gl ? target : cheapS;
    const c = lvl + strain;
    if (ok(c) && !(ours && lb.call === c)) {
      if (!ours || lb.call[1] !== strain || lvl > +lb.call[0]) {
        if (!(!fit && strain !== 'N' && !pBid && lvl >= 3 && h.L[strain] < 7)) return c;
      }
    }
  }
  // the opponents hold the contract
  if (!ours && lb) {
    const their = lb.call[1], lv = +lb.call[0];
    if (lnp && lnp.call !== 'X' && !sameSide(lnp.by, ctx.seat) && ok('X')) {
      const dm = dblMeaning(ctx);
      if (dm.tag === 'xpen') {
        const tricksThere = their === 'N' ? h.H >= 12 : (h.L[their] >= 4 && hon(h, their, 'AKQJT') >= 2) || (h.L[their] >= 3 && hon(h, their) >= 2);
        const theyAreSac = ctx.ours.some(x => bidValue(x.call) >= 0 && +x.call[0] >= gameLevel(x.call[1]) && !(x.m && x.m.art)) && lv >= 5;
        if (theyAreSac && totLo >= 24 && !(fit && fitLen >= 10 && total >= 30)) return 'X';
        if (totLo >= (ctx.theyVul && !BID_OFF('vpen') ? 21 : 22) && tricksThere && lv >= 2 && !(fit && fitLen >= 9 && lv <= 3)) return 'X';
      }
    }
    // sacrifice against their game with a long fit and little defence, by vulnerability (not when vulnerable against not)
    if (fit && pBid && !BID_OFF('sac') && lv >= Math.min(4, gameLevel(their)) && !ctx.ours.some(x => bidValue(x.call) >= 0 && +x.call[0] >= Math.min(4, gameLevel(x.call[1]))) && lnp && lnp.call !== 'X') {
      const vk = vulK(ctx, 'vsac'), cf = ctx.cheap(fit), need = vk <= 0 ? (cf <= 4 ? 9 : 10) : vk === 1 ? 11 : 99;
      const def = h => SUITS.filter(s => s !== fit).reduce((t, s) => t + (h.has[s].includes('A') ? 1 : 0) + (h.has[s].includes('K') && h.L[s] >= 2 && s !== their ? 0.5 : 0), 0);
      if (cf <= 5 && fitLen >= need && totLo <= 22 && def(h) <= 1 && ok(cf + fit)) return cf + fit;
    }
    // law of total tricks: compete to the level of our trumps
    if (fit && pBid) {
      // with extra values (22+ between us by my count) one level higher: an 8-card fit competes to the three level
      const lott = Math.min(fitLen - 6, 4) /* round 9 tried +1 level with 22+ combined (lott22): +0.012 held out, but worse partnering humans; not kept */;
      const c = ctx.cheap(fit) + fit;
      if (ctx.cheap(fit) <= lott && ok(c) && (ctx.cheap(fit) <= 3 || totLo >= 20)) return c;
    }
    // a long suit of my own: compete once at a low level
    const ls = longest(h, opp);
    if (!fit && h.L[ls] >= 6 && hon(h, ls, 'AKQJ') >= 2 && myV >= 11 && (ctx.cheap(ls) <= 2 || (ctx.cheap(ls) === 3 && myV >= (BID_K('ls3') ?? 13) && !BID_OFF('ls3'))) && ok(ctx.cheap(ls) + ls) && !ctx.mine.some(x => x.call[1] === ls && +x.call[0] >= 2)) return ctx.cheap(ls) + ls;
  }
  if (forcedGF || ctx.forced) return forcedBid(ctx, h, ok, fit);
  return 'P';
}
function forcedBid(ctx, h, ok, fit) { // something that keeps the auction going, as cheaply and naturally as possible
  const P = ctx.P, opp = ctx.oppSuits;
  const forcedGF = ctx.gf && !ourGame(ctx);
  const c = [];
  if (fit) c.push(ctx.cheap(fit) + fit);
  const pl = ctx.pLast && bidValue(ctx.pLast.call) >= 0 && !ctx.pLast.m.art ? ctx.pLast.call[1] : null;
  if (pl && pl !== 'N' && h.L[pl] >= 3) c.push(ctx.cheap(pl) + pl);
  if (opp.every(s => stopper(h, s)) && ctx.cheap('N') <= 3) c.push((forcedGF ? Math.max(ctx.cheap('N'), ctx.cheap('N') <= 3 ? ctx.cheap('N') : 3) : ctx.cheap('N')) + 'N');
  for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 6 && ctx.Me.mn[s] >= 4) c.push(ctx.cheap(s) + s);
  for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 4 && ctx.Me.mn[s] === 0 && P.mn[s] === 0 && !opp.includes(s) && ctx.cheap(s) <= 3) c.push(ctx.cheap(s) + s);
  for (const s of ['S', 'H', 'D', 'C']) if (h.L[s] >= 5 && ctx.Me.mn[s] >= 4) c.push(ctx.cheap(s) + s);
  const pFirst = ctx.pards.find(x => bidValue(x.call) >= 0 && !x.m.art && x.call[1] !== 'N');
  if (pFirst && h.L[pFirst.call[1]] >= 2) c.push(ctx.cheap(pFirst.call[1]) + pFirst.call[1]);
  if (ctx.cheap('N') <= 3) c.push(ctx.cheap('N') + 'N');
  const myL = longest(h); c.push(ctx.cheap(myL) + myL);
  for (const x of c) if (ok(x) && +x[0] <= 5) return x;
  return 'P';
}

// ---- Penalty doubles by judgement: is their contract going down? ----
// Used when a double of their contract is for penalty by the auction (dblMeaning 'xpen') and the tables chose to
// pass, or to compete on (then the bar is higher): the defence is estimated from my hand (trump tricks and length,
// side-suit tricks, shortness) and partner's expected share of the points nobody has shown, with weights fitted to
// the double-dummy defence; the double is made when its expected IMP gain (their tricks spread around that
// estimate, scored doubled and undoubled) is clearly positive. A contract the
// opponents' own calls don't support (a weak hand jumping to game) leaves partner more of the points, so it is
// doubled more readily.
function pointShares(ctx, h) { // expected points of [partner, LHO, RHO]: their shown ranges scaled to the points I can't see
  const rng = [ctx.P, ctx.L, ctx.R].map(a => [a.lo, Math.max(a.lo, Math.min(a.hi, 37))]);
  const left = 40 - h.H;
  let mids = rng.map(([lo, hi]) => (lo + Math.min(hi, lo + 12)) / 2);
  for (let it = 0; it < 5; it++) { const sum = mids.reduce((a, b) => a + b, 0) || 1; mids = mids.map((m, i) => Math.max(rng[i][0], Math.min(rng[i][1], m * left / sum))); }
  return mids;
}
function theirDeclarer(ctx) {
  const st = ctx.lb.call[1];
  const x = ctx.items.find(y => !sameSide(y.by, ctx.seat) && bidValue(y.call) >= 0 && y.call[1] === st);
  return x ? x.by : ctx.lb.by;
}
function defTricks(ctx, h, pPts) { // defensive tricks my side can expect against their contract
  const st = ctx.lb.call[1], over = theirDeclarer(ctx) === ctx.rho;
  const theirSuit = s => ctx.theirs.some(x => bidValue(x.call) >= 0 && x.call[1] === s && !(x.m && x.m.art)) || ctx.O.mn[s] >= 4;
  const K = (k, d) => BID_K(k) ?? d;
  let t = 0, trT = 0;
  for (const s of SUITS) {
    const L = h.L[s], x = h.has[s], A = x.includes('A'), Kg = x.includes('K'), Q = x.includes('Q'), J = x.includes('J');
    if (s === st) {
      let tt = (A ? 1 : 0) + (Kg ? (L >= 2 ? (over ? 0.9 : 0.65) : 0.15) : 0) + (Q ? (L >= 3 ? (over ? 0.75 : 0.5) : L === 2 ? 0.2 : 0) : 0) + (J && L >= 4 ? 0.35 : 0);
      if (L >= 4) tt += K('ptl', 0.45) * (L - 3);
      trT = Math.min(tt, L);
    } else if (st === 'N') {
      const hn = (A ? 1 : 0) + (Kg && L >= 2 ? 0.8 : 0) + (Q && L >= 3 ? 0.45 : 0) + (J && L >= 4 ? 0.2 : 0);
      t += hn + (L >= 5 && hn >= 1.5 ? 0.6 * (L - 4) : 0);
    } else {
      let st2 = 0;
      if (A && Kg) st2 = L <= 5 ? 2 : 1.4; else if (A) st2 = L <= 6 ? 1 : 0.5;
      else if (Kg && Q) st2 = L <= 5 ? 1 : 0.6;
      else if (Kg) st2 = L >= 2 ? (over ? 0.6 : 0.35) : 0.1;
      if (!A && !Kg && Q && L >= 2 && L <= 4) st2 += 0.2;
      if (A && Kg && Q && L <= 4) st2 += 0.3;
      t += theirSuit(s) ? st2 * 0.75 : st2;
    }
  }
  const ru = st !== 'N' && h.L[st] >= 1 && h.L[st] <= 4 && SUITS.some(s => s !== st && h.L[s] <= 1) ? 1 : 0;
  const lbI = ctx.lb.i, pAfter = ctx.items.filter(x => x.by === ctx.p && x.i > lbI);
  defTricks.f = { pPass: pAfter.length && pAfter.every(x => x.call === 'P') ? 1 : 0, pBid: ctx.pards.some(x => x.call !== 'P') ? 1 : 0, pLo: ctx.P.lo, oLo: ctx.L.lo + ctx.R.lo, oHi: Math.min(37, ctx.L.hi + ctx.R.hi), weOp: ctx.weOpened ? 1 : 0, iBid: ctx.mine.some(x => x.call !== 'P') ? 1 : 0, trT, sideT: t, pPts, H: h.H, tL: st === 'N' ? 0 : h.L[st], ru, oFit: st === 'N' ? 0 : ctx.L.mn[st] + ctx.R.mn[st], nt: st === 'N' ? 1 : 0, over: over ? 1 : 0 };
  // a linear fit to the double-dummy defence on 12,000 such decisions (tests/bidoverbid.js --penlog)
  const lv = +ctx.lb.call[0], f = defTricks.f;
  if (st === 'N') return 1.535 + 0.627 * t + 0.275 * pPts + 0.152 * h.H - 0.253 * lv - 0.54 * (lv >= 6) + 0.189 * f.pPass + 0.054 * f.pBid + 0.025 * f.pLo - 0.04 * f.oLo + 0.378 * f.weOp + 0.207 * f.iBid;
  return 1.89 + 0.705 * trT + 0.484 * t + 0.134 * pPts + 0.138 * h.H + 0.2 * f.tL + 0.291 * ru - 0.131 * f.oFit - 0.115 * lv + 0.271 * (f.tL <= 1) - 0.758 * (lv >= 6)
    + 0.067 * f.pPass - 0.397 * f.pBid + 0.073 * f.pLo - 0.033 * f.oLo + 0.066 * f.iBid;
}
// does their contract fit what their calls showed? (sound contracts are harder to beat than the estimate says)
function fitsShown(ctx, h) {
  const lb = ctx.lb, lv = +lb.call[0], st = lb.call[1], L = ctx.L, R = ctx.R, P = ctx.P;
  const [, lm, rm] = pointShares(ctx, h);
  const need = st === 'N' ? 17 + 2.7 * lv : 13 + 3 * lv;
  const oHi = Math.min(37, L.hi) + Math.min(37, R.hi);
  const ptOver = Math.max(0, h.H + L.lo + R.lo + P.lo - 40);
  const trOver = st === 'N' ? 0 : Math.max(0, h.L[st] + L.mn[st] + R.mn[st] + (P.mn[st] || 0) - 13);
  let cardOver = 0; for (const s of SUITS) cardOver += Math.max(0, h.L[s] + L.mn[s] + R.mn[s] + (P.mn[s] || 0) - 13);
  const shortHi = Math.max(0, need - oHi), shortMid = need - lm - rm;
  // was the call that set the contract one the system makes (a table call), or read by its natural meaning?
  let tbl = 1;
  try { const pre = ctx.prefix.slice(0, lb.i), c2 = mkCtx(pre, lb.by, ctx.metas.slice(0, lb.i), ctx.vul), T = tablesFor(c2); tbl = T && T.some(d => d.c === lb.call) ? 1 : 0; } catch (e) { tbl = 1; }
  const pre = ctx.items.slice(0, lb.i), prevBid = [...pre].reverse().find(x => bidValue(x.call) >= 0);
  let cheapL = 1; if (prevBid) { for (let l = 1; l <= 7; l++) if (bidValue(l + st) > bidValue(prevBid.call)) { cheapL = l; break; } }
  const jump = lv - cheapL, bm = lb.m || ANY(), bPH = pre.some(x => x.by === lb.by && x.call === 'P' && !pre.some(y => y.by === lb.by && bidValue(y.call) >= 0 && y.i < x.i));
  const bPard = pre.filter(x => x.by === partnerOf(lb.by)), pardSilent = bPard.every(x => x.call === 'P') ? 1 : 0;
  const theirBids = ctx.theirs.filter(x => bidValue(x.call) >= 0).length, weBid = ctx.ours.some(x => bidValue(x.call) >= 0) ? 1 : 0;
  return { ptOver, trOver, cardOver, shortHi, shortMid, tbl, myTr: st === 'N' ? 0 : h.L[st], jump, bHi: Math.min(37, bm.hi), bLo: bm.lo, bPH: bPH ? 1 : 0, pardSilent, theirBids, weBid, sameBid: lb.by === theirDeclarer(ctx) ? 1 : 0 };
}
// the defence estimate's correction for how the contract was reached, fitted to the residual of defTricks
// (tests/bidoverbid.js --penlog, people's overbids and the robots' own contracts together): a contract one
// player bid with partner silent, or after passing, goes down more often than the shown points say
function fitAdj(st, f) {
  if (st === 'N') return -0.474 + 0.313 * f.pardSilent + 0.096 * f.bPH + 0.176 * f.sameBid + 0.407 * f.tbl;
  return -0.005 + 0.296 * f.pardSilent + 0.164 * f.bPH - 0.266 * f.sameBid - 0.083 * f.tbl;
}
function penaltyGain(ctx, D) { // expected IMPs from doubling rather than passing, their tricks spread around 13 - D
  const lv = +ctx.lb.call[0], st = ctx.lb.call[1], decl = theirDeclarer(ctx), sd = lv >= 6 ? 1 : BID_K('psd') ?? 1.5;
  const c0 = { level: lv, strain: st, doubled: 0, declarer: decl }, c1 = Object.assign({}, c0, { doubled: 1 });
  const mean = 13 - D; let ev = 0, ws = 0;
  for (let k = 0; k <= 13; k++) {
    const z = (k - mean) / sd, w = Math.exp(-z * z / 2);
    ev += w * toImps(scoreContract(c0, k, ctx.vul) - scoreContract(c1, k, ctx.vul));
    ws += w;
  }
  return ev / ws;
}
// Round 13 (dtfit): the defence estimate refitted to the double-dummy defence of 164,000 judgeX decisions (robot
// self-play and people's overbids, tests/bidoverbid.js --penlog; people's contracts weighted 4 to 1). Against a suit
// contract, a few things of my hand and the auction the old fit missed: partner's shown length in their trump suit
// (pTr: partner bid it), a void, trump length beyond three, trump honours and side quick tricks. Against notrump,
// the whole fit is redone with side quick tricks split by suits they bid (qO) or not (qS) and my longest suit.
// (Refitting the suit terms from scratch traded people's overbids for the robots' contracts: not kept.)
function quickTricks(x, L) {
  const A = x.includes('A'), K = x.includes('K'), Q = x.includes('Q');
  return A && K ? (L <= 5 ? 2 : 1.5) : A && Q ? (L <= 5 ? 1.5 : 1) : A ? (L <= 6 ? 1 : 0.5) : K && Q ? (L <= 5 ? 1 : 0.5) : K && L >= 2 ? 0.5 : 0;
}
function defFit(ctx, h, D) {
  const st = ctx.lb.call[1], f = defTricks.f;
  let qS = 0, qO = 0, voids = 0, sideL = 0;
  for (const s of SUITS) {
    if (s === st) continue;
    const q = quickTricks(h.has[s], h.L[s]);
    if (ctx.oppSuits.includes(s)) qO += q; else qS += q;
    if (h.L[s] === 0) voids++;
    sideL = Math.max(sideL, h.L[s]);
  }
  if (st === 'N') {
    const lv = +ctx.lb.call[0];
    return 0.751 + 0.581 * f.sideT + 0.224 * f.pPts + 0.151 * h.H - 0.174 * lv - 0.823 * (lv >= 6) - 0.067 * f.pPass - 0.024 * f.pBid + 0.118 * f.pLo
      - 0.024 * f.oLo + 0.088 * f.weOp - 0.134 * f.iBid + 0.307 * qS + 0.076 * qO + 0.094 * sideL;
  }
  const trH = [...'AKQJT'].filter(r => h.has[st].includes(r)).length;
  return D - 0.14 + 0.044 * qS + 0.071 * qO + 0.336 * voids + 0.083 * Math.max(0, h.L[st] - 3) + 0.049 * trH + 0.442 * (ctx.P.mn[st] || 0);
}
function judgeX(ctx, h, extra = 0) { // true: double their contract for penalty (extra: how much more the double must gain)
  const lb = ctx.lb; if (!lb || sameSide(lb.by, ctx.seat) || !ctx.ok('X') || (lb.m && lb.m.art)) return false;
  const lnp = lastNonPass(ctx.prefix); if (!lnp || lnp.call !== lb.call || lnp.by !== lb.by) return false;
  if (dblMeaning(ctx).tag !== 'xpen') return false;
  const lv = +lb.call[0], st = lb.call[1];
  if (lv < (BID_K('pxl') ?? 2)) return false;
  const [pPts] = pointShares(ctx, h);
  let D = defTricks(ctx, h, pPts);
  if (!BID_OFF('dtfit')) D = defFit(ctx, h, D);
  D += BID_K('pxd') ?? 0;
  const fs = globalThis.BID_PENLOG || BID_K('fitx') ? fitsShown(ctx, h) : null, f0 = Object.assign({}, defTricks.f);
  if (BID_K('fitx')) D += BID_K('fitx') * fitAdj(st, fs); // measured worse (round 7): off
  const g = penaltyGain(ctx, D);
  judgeX.last = { D, lv, st };
  if (globalThis.BID_PENLOG) globalThis.BID_PENLOG.push(Object.assign({ decl: theirDeclarer(ctx), st, lv, D, g, extra, lbBy: lb.by, hand: SUITS.map(s => h.has[s]).join('.'), pHi: Math.min(37, ctx.P.hi), lLo: ctx.L.lo, rLo: ctx.R.lo, lHi: Math.min(37, ctx.L.hi), rHi: Math.min(37, ctx.R.hi), pTr: st === 'N' ? 0 : ctx.P.mn[st] || 0, lTr: st === 'N' ? 0 : ctx.L.mn[st] || 0, rTr: st === 'N' ? 0 : ctx.R.mn[st] || 0, oSuits: ctx.oppSuits.join(''), pSuits: SUITS.filter(s => (ctx.P.mn[s] || 0) >= 4).join(''), nCalls: ctx.prefix.length, lS: SUITS.map(s => (ctx.L.mn[s] || 0) + '' + (ctx.R.mn[s] || 0)).join('.') }, f0, fs));
  return g >= (BID_K('pxm') ?? 3.5) + extra; // a high bar: the estimate is rough, and they may run or redouble
}

function convertX(ctx, h) {
  const pl = ctx.pLast, lb = ctx.lb;
  if (!pl || pl.call !== 'X' || !pl.m || !['xto', 'xreopen'].includes(pl.m.tag) || ctx.rhoCall !== 'P' || !lb || sameSide(lb.by, ctx.seat) || lastNonPass(ctx.prefix) !== ctx.prefix[pl.i]) return false;
  const st = lb.call[1], lv = +lb.call[0];
  if (st === 'N' || h.L[st] < 4 || hon(h, st, 'AKQJT') < 2) return false;
  const [pPts] = pointShares(ctx, h);
  const D = defTricks(ctx, h, pPts);
  return D - (7 - lv) >= (BID_K('xcv') ?? 1.5);
}
// ---- Entry points ----
// Speed only (perf2): the metas of the last auction seen are kept, and a later auction that starts with the same
// calls (the usual case: the next robot call, shown(), the play) reuses them and explains only the new calls.
// A call's meaning depends only on the calls before it (call and seat), vul and the test knobs BID_OFF/BID_K.
let metasMemo = null;
function auctionMetas(auction, vul) { // what every call so far means, by the system
  const knobs = JSON.stringify([globalThis.BID_OFF || null, globalThis.BID_K || null]);
  const c = metasMemo && metasMemo.vul === vul && metasMemo.knobs === knobs ? metasMemo : null;
  let n = 0;
  if (c) while (n < auction.length && n < c.calls.length && c.calls[n] === auction[n].call && c.bys[n] === auction[n].by) n++;
  const metas = c ? c.metas.slice(0, n) : [];
  for (let i = n; i < auction.length; i++) metas.push(explainCall(auction.slice(0, i), auction[i].by, auction[i].call, metas, vul));
  metasMemo = { vul, knobs, calls: auction.map(a => a.call), bys: auction.map(a => a.by), metas: metas.slice() };
  return metas;
}
function metasAdd(auction, vul, metas, by, call, m) { // remember the meaning of a call about to be made after auction
  const c = metasMemo;
  if (!c || c.vul !== vul || c.calls.length !== auction.length || c.metas.length !== metas.length || c.metas.some((x, i) => x !== metas[i])) return;
  if (c.knobs !== JSON.stringify([globalThis.BID_OFF || null, globalThis.BID_K || null])) return;
  if (auction.some((a, i) => a.call !== c.calls[i] || a.by !== c.bys[i])) return;
  metasMemo = { vul, knobs: c.knobs, calls: c.calls.concat([call]), bys: c.bys.concat([by]), metas: c.metas.concat([m]) };
}
function explainCall(prefix, seat, call, metas, vul) {
  let ctx;
  try {
    ctx = mkCtx(prefix, seat, metas, vul);
    const T = tablesFor(ctx);
    if (T) { const ds = T.filter(d => d.c === call); if (ds.length) return mergeM(ds.map(d => d.m)); }
    return natMean(ctx, call);
  } catch (e) { if (globalThis.BID_DEBUG) throw e; return ANY(); }
}
let callSrc = null; // where the last robot call came from: 'table' (a system rule), 'natural' (a table with no fitting rule), 'none' (no table)
const botCallSrc = () => callSrc;
function chooseCall(hand, seat, auction, vul) {
  const metas = auctionMetas(auction, vul);
  const ctx = mkCtx(auction, seat, metas, vul), h = evalHand(hand);
  const T = tablesFor(ctx);
  let call = null;
  if (T) {
    for (const d of T) { if (d.nat) break; if (d.c && ctx.ok(d.c) && d.w(h)) { call = d.c; break; } }
  }
  callSrc = call ? 'table' : T ? 'natural' : 'none';
  if (!call) call = natural(ctx, h, new Set(T ? T.filter(d => d.c).map(d => d.c) : []));
  call = slamAsk(ctx, h, T, call) || slamCtl(ctx, h, T, call) || natRescue(ctx, h, T, call) || call;
  let why = null; // a judgement double says why: the defence it expects
  const jx = extra => { if (!judgeX(ctx, h, extra)) return false; why = penaltyWhy(judgeX.last); return true; };
  if (call === 'P' && jx(0) && !BID_OFF('pjx')) call = 'X';
  // partner's takeout double of their suit contract, RHO passed: convert it to penalties with their trumps stacked
  // behind them (a trap pass, or just a trump stack) when the defence should beat it by a trick and a half
  else if (!BID_OFF('xconv') && call !== 'P' && convertX(ctx, h)) call = 'P';
  // competing or sacrificing over their contract when it is going down anyway: double instead
  else if (!BID_OFF('pxb') && bidValue(call) >= 0 && (!ctx.gf || !BID_OFF('pxf')) && !ctx.forced && ctx.lb && !sameSide(ctx.lb.by, seat) && !ctx.mine.some(x => x.m && x.m.f) && jx((BID_K('pxb') ?? 2) + (ctx.gf ? BID_K('pxf') ?? 1.5 : 0))) call = 'X';
  if (call === 'P' && !BID_OFF('nopassf')) { // never pass partner's forcing call (a human's, read by its natural meaning) below game
    const pl = ctx.pLast;
    if (pl && pl === ctx.lb && ctx.rhoCall === 'P' && pl.m && pl.m.f >= 1 && !ourGame(ctx) && !ctx.items.some(x => x.by === ctx.seat && x.i > pl.i)) {
      let fit = null; for (const s of ['S', 'H', 'D', 'C']) if (!fit && ctx.P.mn[s] >= 3 && h.L[s] + ctx.P.mn[s] >= 8) fit = s;
      call = forcedBid(ctx, h, ctx.ok, fit);
    }
  }
  if (call !== 'X') why = null;
  if (why) return { call, alert: why };
  const m = explainCall(auction, seat, call, metas, vul);
  metasAdd(auction, vul, metas, seat, call, m); // (speed) the next auctionMetas finds this call's meaning
  return { call, alert: m.alert };
}
// "Penalty: expects to beat 4♥ (about 2 down)": the robot's own reason for a judgement double, kept with the call
// (its alert), since the auction alone can't say it
function penaltyWhy(j) {
  if (!j) return null;
  const down = Math.max(1, Math.round(j.D + j.lv - 7));
  return `Penalty: expects to beat ${j.lv}${SSYM[j.st]} (about ${down} down)`;
}
// vul ('None', 'NS', 'EW', 'Both') is optional: without it the robots bid as if nobody were vulnerable.
function botCall(hand, seat, dealer, auction, vul) {
  const legal = legalCalls(dealer, auction);
  let r = null;
  try { r = chooseCall(hand, seat, auction, vul); } catch (e) { r = null; if (globalThis.BID_DEBUG) throw e; }
  if (!r || !legal.includes(r.call)) return { call: 'P' };
  return r.alert ? { call: r.call, alert: r.alert } : { call: r.call };
}
// What a seat has shown so far (points and suit lengths), read by the system from the whole auction.
function shown(auction, seat, vul) {
  const metas = auctionMetas(auction, vul);
  const a = agg(auction.map((x, i) => x.by === seat ? metas[i] : null));
  return { pts: a.lo, ptsMax: a.hi, len: a.mn, maxLen: a.mx, bid: auction.some(x => x.by === seat && x.call !== 'P'), nt: a.nt };
}
function explainAuction(auction) { return auctionMetas(auction).map(m => m && m.alert); }

// ---- Plain-English explanation of any call (for tapping a call in the auction) ----
// describeCall(auction, i, vul) explains auction[i] by the system: the alert text when the call has one (with
// the points and suit lengths it shows added when the alert does not say them), else a summary built from its
// meaning. A pass is explained only when it means something (a forcing pass, leaving partner's double in).
// Returns null when there is nothing worth saying; never throws. describeAuction does every call at once.
function describeAuction(auction, vul) {
  if (!Array.isArray(auction)) return [];
  let metas;
  try { metas = auctionMetas(auction, vul); } catch (e) { return auction.map(() => null); }
  return auction.map((_, i) => describeCall(auction, i, vul, metas));
}
function describeCall(auction, i, vul, metas) {
  try {
    const a = auction && auction[i]; if (!a || !a.call) return null;
    metas = metas || auctionMetas(auction.slice(0, i + 1), vul);
    const m = metas[i], call = a.call;
    if (call === 'X' && typeof a.alert === 'string' && /^Penalty: expects to beat \d/.test(a.alert)) return a.alert; // a robot's judgement double
    if (call === 'P') return describePass(auction, i, vul, metas, m);
    if (!m) return null;
    const isBid = bidValue(call) >= 0, st = isBid ? call[1] : null;
    const al = m.alert || '';
    const pts = describePts(m.lo, m.hi), lens = describeLens(m), parts = [];
    if (al) {
      if (pts && !/point|values|key card/i.test(al)) parts.push(pts);
      if (m.bal && !/balanced/i.test(al)) parts.push('balanced');
      const said = su => al.includes(su) || (/both majors|major/.test(al) && (su === 'majors' || (/both majors/.test(al) && (su === 'hearts' || su === 'spades'))));
      for (const L of lens) if (!said(L.suit)) parts.push(L.text);
      if (/short/.test(al)) for (let k = parts.length - 1; k >= 0; k--) if (/^short in /.test(parts[k])) parts.splice(k, 1);
      if (!parts.length) return al;
      return al + (al.includes(':') ? ', ' : ': ') + parts.join(', ');
    }
    if (m.bal) parts.push('balanced');
    if (pts) parts.push(pts);
    for (const L of lens) parts.push(L.text);
    if (st === 'N' && m.stop && m.stop.length) parts.push(`${m.stop.map(s => SNAME[s]).join(' and ')} stopped`);
    if (m.f === 2) parts.push('game forcing'); else if (m.f === 1) parts.push('forcing one round'); else if (m.inv) parts.push('invitational');
    const TAGS = { slow: 'slam interest', raise: 'single raise', reverse: 'reverse', '1NPH': 'passed hand, not forcing', signoff: 'sign-off' };
    const body = parts.join(', '), lv = isBid ? +call[0] : 0, game = isBid && lv >= gameLevel(st);
    const natural = !m.art && isBid;
    const earlier = auction.slice(0, i).map((x, k) => ({ x, m: metas[k] })).filter(o => bidValue(o.x.call) >= 0 && o.x.call[1] === st && !(o.m && o.m.art));
    let head = null;
    if (m.tag === 'pre') head = 'Preemptive';
    else if (m.tag === 'raise' || m.tag === '1NPH') return capFirst((body ? body + ' ' : '') + `(${TAGS[m.tag]})`);
    else if (natural && st !== 'N') {
      const mine = earlier.some(o => o.x.by === a.by), pard = earlier.some(o => o.x.by === partnerOf(a.by)), opp = earlier.some(o => !sameSide(o.x.by, a.by));
      const agreed = m.agree === st || metas.slice(0, i).some((x, k) => x && x.agree === st && sameSide(auction[k].by, a.by));
      const raiseTo = lv >= 7 ? 'Raise to a grand slam' : lv === 6 ? 'Raise to slam' : 'Raise to game';
      const shows = lens.some(L => L.suit === SNAME[st]), len = (m.mn || {})[st] || 0;
      if (pard && !mine) head = len && len <= 2 ? 'Preference' : game ? raiseTo : 'Raise';
      else if (!pard && !mine && m.agree === st) head = game ? raiseTo : 'Raise';
      else if (mine) head = (pard || agreed) && game ? 'To play' : shows ? null : `Rebids ${SNAME[st]}`;
      else if (!shows) head = opp ? `Cue bid in ${SNAME[st]}` : game ? 'To play' : `Natural (${SNAME[st]})`;
    } else if (natural && st === 'N' && !m.bal) head = lv >= 3 ? 'To play' : 'Natural';
    if (!head && !body) return m.art ? null : TAGS[m.tag] ? capFirst(TAGS[m.tag]) : 'Natural';
    let s = head ? head + (body ? ': ' + body : '') : body;
    if (TAGS[m.tag]) s += ` (${TAGS[m.tag]})`;
    return capFirst(s);
  } catch (e) { return null; }
}
function capFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function describePts(lo, hi) {
  lo = Math.max(0, lo | 0); hi = Math.min(37, hi === undefined ? 37 : hi | 0);
  if (hi < lo) hi = lo;
  if (lo <= 0 && hi >= 37) return '';
  if (hi >= 37) return `${lo}+ points`;
  if (lo <= 0) return `0-${hi} points`;
  return lo === hi ? `${lo} points` : `${lo}-${hi} points`;
}
function describeLens(m) { // [{suit, text}] for what the call shows about suit lengths, longest first
  const out = [], mn = m.mn || {}, mx = m.mx || {};
  const done = new Set();
  // both majors capped: "no 4-card major" / "no 5-card major"
  if (!mn.H && !mn.S && mx.H !== undefined && mx.H === mx.S && mx.H <= 4) { out.push({ suit: 'majors', text: `no ${mx.H + 1}-card major` }); done.add('H'); done.add('S'); }
  for (const s of ['S', 'H', 'D', 'C']) {
    const a = mn[s] || 0, b = mx[s] === undefined ? 13 : mx[s];
    if (a && b <= a) out.push({ suit: SNAME[s], text: `exactly ${a} ${SNAME[s]}`, k: a });
    else if (a) out.push({ suit: SNAME[s], text: `${a}+ ${SNAME[s]}`, k: a });
  }
  for (const s of ['S', 'H', 'D', 'C']) {
    if (done.has(s) || mn[s]) continue;
    const b = mx[s] === undefined ? 13 : mx[s];
    if (b === 0) out.push({ suit: SNAME[s], text: `void in ${SNAME[s]}`, k: -1 });
    else if (b === 1) out.push({ suit: SNAME[s], text: `singleton or void in ${SNAME[s]}`, k: -1 });
    else if (b === 2) out.push({ suit: SNAME[s], text: `short in ${SNAME[s]}`, k: -1 });
    else if (b === 3) out.push({ suit: SNAME[s], text: `at most 3 ${SNAME[s]}`, k: -1 });
  }
  return out.sort((x, y) => (y.k || 0) - (x.k || 0));
}
function describePass(auction, i, vul, metas, m) {
  if (m && m.alert) return m.alert;
  const prefix = auction.slice(0, i), seat = auction[i].by;
  const ctx = mkCtx(prefix, seat, metas, vul);
  const lnpIdx = (() => { for (let k = prefix.length - 1; k >= 0; k--) if (prefix[k].call !== 'P') return k; return -1; })();
  if (lnpIdx < 0) return null;
  const lnp = prefix[lnpIdx], lm = metas[lnpIdx];
  if (lnp.call === 'X' && lnp.by === ctx.p) {
    const lb = ctx.lb;
    const their = lb ? ` ${lb.call[0]}${SSYM[lb.call[1]]}` : '';
    if (lm && lm.tag === 'xpen') return `Leaves partner's penalty double of${their} in`;
    if (lm && lm.tag === 'xlead') return `Leaves partner's lead-directing double of${their} in`;
    return `Leaves partner's double of${their} in, for penalties: length and strength in their suit`;
  }
  // their bid straight after ours in a game-forcing auction: a pass hands the decision to partner
  if (ctx.gf && lnpIdx === prefix.length - 1 && lnp.by === ctx.rho && bidValue(lnp.call) >= 0 && ctx.ours.some(x => bidValue(x.call) >= 0))
    return 'Forcing pass: we are in a game-forcing auction, so partner must bid on or double';
  return null;
}

function debugTable(hand, seat, auction, vul) { // for tests/bidwhy.js: the table that applies, with each entry's hand test
  const metas = auctionMetas(auction, vul), ctx = mkCtx(auction, seat, metas, vul), h = evalHand(hand), T = tablesFor(ctx);
  return T ? T.map(d => d.nat ? 'natural' : `${d.c}${ctx.ok(d.c) ? '' : '(illegal)'}${d.w(h) ? '+' : '-'}`).join(' ') : 'no table: natural';
}

if (typeof module !== 'undefined') module.exports = { botCall, botCallSrc, shown, explainAuction, evalHand, _metas: auctionMetas, _tableName: debugTable, _describe: describeCall };
