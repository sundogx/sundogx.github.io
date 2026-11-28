// Deal setup (js/dealgen.js): parsing, checks, dealt hands meet every constraint, PBN. node tests/dealgentest.js [n]
const D = require('../js/dealgen.js');
const E = require('../js/engine.js');
const S = require('../js/share.js');
let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL', m); fails++; process.exitCode = 1; } };
const N = +process.argv[2] || 300;

// a seeded random source, so a failure can be repeated
const rand = E.seededRand('dealgentest');

// independent check of a deal against a spec (engine's hcp and suitLengths, not the generator's own counting)
function meets(spec, h, rotated) {
  const seatOf = s => (rotated ? { N: 'S', S: 'N', E: 'W', W: 'E' }[s] : s); // the spec seat whose hand s holds
  const all = [].concat(h.N, h.E, h.S, h.W);
  if (all.length !== 52 || new Set(all).size !== 52) return 'not 52 different cards';
  for (const s of E.SEATS) {
    const a = spec.seats[seatOf(s)], c = h[s], p = E.hcp(c), L = E.suitLengths(c), ls = Object.values(L).sort((x, y) => y - x);
    if (c.length !== 13) return s + ' has ' + c.length;
    if (p < a.hcp[0] || p > a.hcp[1]) return s + ' hcp ' + p;
    for (const su of E.SUITS) if (L[su] < a.len[su][0] || L[su] > a.len[su][1]) return s + ' len ' + su + L[su];
    if (!D.DG_SHAPE_OK[a.shape](ls)) return s + ' shape ' + ls;
    for (const x of D.dgParseCards(a.cards).cards) if (!c.includes(x)) return s + ' lacks ' + x;
  }
  const ns = E.hcp(h.N) + E.hcp(h.S);
  if (ns < spec.ns[0] || ns > spec.ns[1]) return 'ns ' + ns; // the same whichever way round
  const fit = (a, b) => Math.max(...E.SUITS.map(su => E.suitLengths(h[a])[su] + E.suitLengths(h[b])[su]));
  const [nf, ef] = [spec.nsFit, spec.ewFit]; // turning round keeps N-S as N-S
  if (nf && fit('N', 'S') < nf) return 'ns fit';
  if (ef && fit('E', 'W') < ef) return 'ew fit';
  return null;
}

// --- parsing given cards ---
const pc = s => (D.dgParseCards(s).cards || []).join(' ');
ok(pc('AK - Q -') === 'SA SK DQ', 'groups with dashes');
ok(pc('AK2.Q..') === 'SA SK S2 HQ', 'dots');
ok(pc('♠AK ♥Q10') === 'SA SK HQ HT', 'symbols and 10');
ok(pc('h q s ak') === 'SA SK HQ', 'letters, any order, lower case');
ok(pc('') === '' && !D.dgParseCards('').error, 'blank');
ok(D.dgParseCards('Sxx').error && D.dgParseCards('AK Q').error && D.dgParseCards('AA - - -').error && D.dgParseCards('AKZ - - -').error, 'bad input');

// --- checks ---
const errs = f => { const s = D.dgBlank(); f(s); return D.dgCompile(s).errors; };
ok(errs(() => {}).length === 0, 'blank is fine');
ok(errs(s => { s.seats.S.hcp = [18, 12]; }).length === 1, 'reversed hcp');
ok(errs(s => { s.seats.S.cards = 'A - - -'; s.seats.N.cards = 'A - - -'; }).some(e => /both/.test(e)), 'same card twice');
ok(errs(s => { s.seats.S.len.S = [5, 13]; s.seats.S.len.H = [5, 13]; s.seats.S.len.D = [4, 13]; }).some(e => /more than 13/.test(e)), 'mins over 13');
ok(errs(s => { for (const su of E.SUITS) s.seats.W.len[su] = [0, 3]; }).some(e => /less than 13/.test(e)), 'maxes under 13');
ok(errs(s => { s.seats.S.cards = 'AKQJ - - -'; s.seats.S.len.S = [0, 3]; }).some(e => /at most 3/.test(e)), 'given cards over a max length');
ok(errs(s => { s.seats.S.cards = 'AK AK - -'; s.seats.S.hcp = [0, 12]; }).some(e => /14 HCP/.test(e)), 'given cards over max hcp');
ok(errs(s => { s.ns = [30, 20]; }).length === 1, 'reversed ns');
ok(D.dgFind(Object.assign(D.dgBlank(), { ns: [30, 20] })).errors, 'find reports errors');
// normalize: junk in, a full spec out
const nz = D.dgNormalize({ seats: { S: { hcp: [-4, 99], shape: 'weird', len: { S: [2, 'x'] }, cards: 5 } }, ns: 'q', nsFit: 7, rotate: 1 });
ok(nz.seats.S.hcp.join() === '0,37' && nz.seats.S.shape === 'any' && nz.seats.S.len.S.join() === '2,13' && nz.seats.S.cards === '' && nz.ns.join() === '0,40' && nz.nsFit === 0 && nz.rotate === true && nz.seats.N.hcp.join() === '0,37', 'normalize');

// --- dealt deals meet the spec ---
function randomSpec() {
  const s = D.dgBlank(), ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const used = new Set();
  for (const seat of E.SEATS) {
    const a = s.seats[seat], k = rand();
    if (k < 0.5) { const lo = ri(0, 18); a.hcp = [lo, lo + ri(2, 8)]; }
    if (rand() < 0.3) a.shape = Object.keys(D.DG_SHAPE_OK)[ri(0, 7)];
    if (rand() < 0.3) { const su = E.SUITS[ri(0, 3)], lo = ri(0, 6); a.len[su] = [lo, lo + ri(0, 3)]; }
    if (rand() < 0.25) { // two or three given cards
      const g = { S: '', H: '', D: '', C: '' };
      for (let i = ri(1, 3); i > 0; i--) { const c = E.SUITS[ri(0, 3)] + E.RANKS[ri(0, 12)]; if (!used.has(c) && a.len[c[0]][1] > g[c[0]].length) { used.add(c); g[c[0]] += c[1]; } }
      a.cards = E.SUITS.map(su => g[su] || '-').join(' ');
    }
  }
  if (rand() < 0.3) { const lo = ri(14, 28); s.ns = [lo, lo + ri(2, 8)]; }
  if (rand() < 0.2) s.nsFit = [8, 9][ri(0, 1)];
  if (rand() < 0.1) s.ewFit = 8;
  s.rotate = rand() < 0.3;
  return s;
}
let found = 0, specs = 0, rot = 0, tries = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const spec = randomSpec();
  if (D.dgCompile(spec).errors.length) continue;
  specs++;
  const r = D.dgFind(spec, { ms: 100, rand });
  tries += r.tries;
  if (!r.hands) continue;
  found++;
  const bad = meets(spec, r.hands, false), badR = spec.rotate ? meets(spec, r.hands, true) : 'x';
  if (bad && !badR) rot++;
  ok(!bad || !badR, `deal ${i} breaks the spec: ${bad} / ${badR} ${JSON.stringify(spec)}`);
}
ok(found > specs * 0.5, `found ${found} of ${specs}`);
// presets: every one finds deals, and they fit
for (const [k] of D.DG_PRESETS) {
  const spec = D.dgPreset(k), r = D.dgFind(spec, { ms: 300, rand });
  ok(r.hands && !meets(spec, r.hands, false), 'preset ' + k);
}
// rotation happens about half the time
{ const spec = D.dgBlank(); spec.seats.S.hcp = [20, 37]; spec.rotate = true; let n = 0;
  for (let i = 0; i < 200; i++) if (E.hcp(D.dgFind(spec, { rand }).hands.N) >= 20) n++;
  ok(n > 60 && n < 140, 'rotate ' + n); }
// a fully given hand
{ const spec = D.dgBlank(); spec.seats.S.cards = 'AKQJ T98 765 432'; const r = D.dgFind(spec, { rand });
  ok(r.hands.S.join() === E.sortHand(['SA', 'SK', 'SQ', 'SJ', 'HT', 'H9', 'H8', 'D7', 'D6', 'D5', 'C4', 'C3', 'C2']).join(), 'whole hand given'); }
// impossible but valid spec: gives up in time
{ const spec = D.dgBlank(); spec.seats.S.hcp = [37, 37]; spec.seats.N.hcp = [1, 37]; const t = Date.now(), r = D.dgFind(spec, { ms: 60, rand });
  ok(!r.hands && Date.now() - t < 400, 'gives up'); }
// estimate
{ const e = D.dgEstimate(D.dgBlank(), 30, rand); ok(e.hits === e.tries && e.tries > 1000, 'estimate blank'); }

// --- text and PBN ---
ok(D.dgSeatText(D.dgPreset('nt').seats.S) === '15-17 HCP, balanced', 'seat text ' + D.dgSeatText(D.dgPreset('nt').seats.S));
ok(D.dgSeatText(D.dgPreset('weak2').seats.S) === '5-10 HCP, ♠0-3, ♥6', 'seat text weak two');
ok(D.dgSeatText(D.dgBlank().seats.N) === '', 'seat text blank');
const bs = D.dgBoards(D.dgPreset('slam'), 5, 200, rand);
ok(bs.boards.length === 5 && bs.boards[3].dealer === 'W' && bs.boards[3].vul === 'Both', 'boards');
const pbn = D.dgPBN(bs.boards, 'My "slams"');
ok(S.pbnBoards(pbn).join() === '1,2,3,4,5', 'pbn boards ' + S.pbnBoards(pbn).join());
for (let i = 0; i < 5; i++) {
  const p = S.parsePBN(pbn, i), b = bs.boards[i];
  ok(p.dealer === b.dealer && p.vul === b.vul && E.SEATS.every(s => p.hands[s].join() === b.hands[s].join()), 'pbn round trip ' + i);
}
ok(/\[Event "My slams"\]/.test(pbn) && /\[Vulnerable "All"\]/.test(pbn), 'pbn tags');

console.log(`dealgentest: ${specs} random setups, ${found} dealt (${rot} turned round), ${Math.round(tries / Math.max(1, Date.now() - t0))} tries/ms, ${fails ? fails + ' FAILED' : 'all ok'}`);
