// Daily deals results API (feature: daily). Needs a running server and src/game.js (node build.mjs):
//   npx wrangler dev --port 8796   then   BRIDGE_URL=http://localhost:8796 node tests/daily.test.mjs
// Honest boards are played here by the shared robots (src/game.js, the rules the server runs) on the day's seeded
// deals, posted the way js/daily.js posts them, and must be accepted with the server's own score. Then results
// that don't fit the deal (fake scores, impossible tricks, illegal auctions, another board's cards, overclaims,
// the old format) must be refused.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as G from '../src/game.js';
const require = createRequire(import.meta.url);
const { rotateTable } = require('../js/deals.js'); // the page's "rotate so I'm declarer"
const BASE = (process.env.BRIDGE_URL || 'http://localhost:8796').replace(/\/+$/, '');
const today = new Date().toISOString().slice(0, 10);
const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const freshIp = () => '10.' + [1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.');
const ip = freshIp(); // a fresh address each run
const post = (body, addr = ip) => fetch(BASE + '/api/daily', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': addr }, body: JSON.stringify(body) });
async function uidOf(secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return 'u' + [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
const tag = rnd().slice(0, 6);
const who = n => ({ secret: rnd(), name: n + tag });
let failed = 0, passed = 0;
async function check(label, body, status, re) {
  const r = await post(body, body.ip || ip); const txt = await r.text();
  if (r.status === status && (!re || re.test(txt))) { passed++; return JSON.parse(txt); }
  failed++; console.log('FAIL', label, '->', r.status, txt);
  return null;
}

// ---- honest boards, played as on the page (robots in every seat; their claims are honest claims) ----
const RANKS = '23456789TJQKA';
const sideIx = s => G.SEATS.indexOf(s) & 1;
function wonBy(tricks, c) { // tricks declarer's side won among the completed ones
  let n = 0;
  for (const tr of tricks) {
    if (tr.cards.length < 4) continue;
    let w = tr.cards[0];
    for (const pc of tr.cards) if (pc.card[0] === w.card[0] ? RANKS.indexOf(pc.card[1]) > RANKS.indexOf(w.card[1]) : pc.card[0] === c.strain) w = pc;
    if (sideIx(w.seat) === sideIx(c.declarer)) n++;
  }
  return n;
}
// the same record js/daily.js (Daily.record) sends
function record(h) {
  const rec = { auction: h.auction.map(a => a.call), play: (h.tricks || []).flatMap(tr => tr.cards.map(pc => pc.card)) };
  if (h.contract && rec.play.length < 52) rec.claim = h.declTricks - wonBy(h.tricks || [], h.contract);
  return rec;
}
function table(board, date = today) {
  const t = G.newTable({ name: 'daily', local: false });
  t.seed = 'daily:' + date; t.board = board - 1;
  t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'robot' }, W: { kind: 'robot' } };
  G.startBoard(t);
  return t;
}
function playOut(t, { rotate = false, stopLeft = -1, stopExtra = 0 } = {}) {
  for (let i = 0; i < 400 && t.phase !== 'done'; i++) {
    if (rotate && t.phase === 'play' && !t.play.tricks.length && !t.rotated) rotateTable(t);
    const done = G.completedTricks(t.play).length, cur = t.play.tricks.length > done ? t.play.tricks[t.play.tricks.length - 1].cards.length : 0;
    if (t.phase === 'play' && 13 - done === stopLeft && cur === stopExtra) return t;
    if (G.A.robotStep(t) === false) throw new Error('robot step failed');
  }
  return t;
}
const honest = board => playOut(table(board)).history.at(-1);
const vulOf = b => G.boardVul(b);

const A = who('A');
const boards = [1, 2, 3, 4].map(honest);
let claims = 0;
for (const h of boards) {
  const rec = record(h); if (rec.claim != null) claims++;
  await check(`honest board ${h.board} (${h.contract ? h.contract.level + h.contract.strain + ' ' + h.contract.declarer : 'passed out'}${rec.claim != null ? ', claim' : ''})`,
    { ...A, date: today, board: h.board, ...rec, scoreNS: 99999 }, 200);
}
// one result per person per board
await check('second post of a board', { ...A, date: today, board: 1, ...record(boards[0]) }, 409);

// the stored scores are the server's own, worked out from the replay (the posted scoreNS is ignored)
const lb = await (await fetch(`${BASE}/api/daily/${today}?u=${await uidOf(A.secret)}`)).json();
for (const h of boards) {
  const row = lb.boards[h.board].rows.find(x => x.name === A.name);
  assert.ok(row, 'row for board ' + h.board); assert.equal(row.you, true);
  assert.equal(row.score, h.contract ? G.scoreNS(h.contract, h.declTricks, vulOf(h.board)) : 0, 'score board ' + h.board);
  assert.equal(row.declTricks, h.declTricks);
}
assert.ok(!JSON.stringify(lb).includes(await uidOf(A.secret)), 'ids are never sent');

// "rotate so I'm declarer" (deals.js): the table turns round when the play starts; the record still replays
{
  const t = playOut(table(1), { rotate: true }); const h = t.history.at(-1);
  await check('board played turned round', { ...who('R'), date: today, board: 1, ...record(h) }, 200);
}
// a board played to the last card (no claims: robots don't claim once time is up)
{
  const t = table(3); t.timeUp = true; playOut(t); const h = t.history.at(-1), rec = record(h);
  if (h.contract) assert.equal(rec.play.length, 52);
  const F = who('F');
  await check('board played to the end', { ...F, date: today, board: 3, ...rec }, 200);
  const row = (await (await fetch(`${BASE}/api/daily/${today}?u=${await uidOf(F.secret)}`)).json()).boards[3].rows.find(r => r.you);
  assert.equal(row.score, h.contract ? G.scoreNS(h.contract, h.declTricks, vulOf(3)) : 0);
}
// a passed-out board is always legal
await check('passed out', { ...who('P'), date: today, board: 2, auction: ['P', 'P', 'P', 'P'], play: [] }, 200);

// ---- positions to claim from: a board (with a contract) stopped with 4 tricks left, one card into the trick ----
let cut = null;
for (let b = 1; b <= 4 && !cut; b++) {
  if (!boards[b - 1].contract) continue;
  const t = table(b); t.timeUp = true; // (robots don't claim when time is up)
  playOut(t, { stopLeft: 4, stopExtra: 1 });
  if (t.phase !== 'play') continue;
  const ns = G.claimSolver(G.claimPos(t), 0, 1e7).value(); // N-S tricks of the 4 left, double dummy
  cut = { b, t, ns, nsDecl: sideIx(t.contract.declarer) === 0 };
}
assert.ok(cut, 'a board to claim on');
{
  const { b, t, ns, nsDecl } = cut, left = 4;
  const base = { date: today, board: b, auction: t.auction.map(a => a.call), play: t.play.tricks.flatMap(tr => tr.cards.map(pc => pc.card)) };
  const declClaim = nsTricks => nsDecl ? nsTricks : left - nsTricks;
  await check('claim mid-trick, exactly double dummy', { ...who('M'), ...base, claim: declClaim(ns) }, 200);
  if (ns < left) await check('overclaim for N-S (one trick more than double dummy)', { ...who('O'), ...base, claim: declClaim(ns + 1) }, 400, /claim/);
  if (ns < left) await check('E-W "concession" of tricks N-S cannot take', { ...who('O'), ...base, claim: declClaim(left) }, 400, /claim/);
  if (ns > 0) await check('N-S concede a trick they could take', { ...who('Q'), ...base, claim: declClaim(ns - 1) }, 200);
  await check('claim more tricks than are left', { ...who('O'), ...base, claim: left + 1 }, 400);
  await check('unfinished play, no claim', { ...who('O'), ...base }, 400, /not finished/);
}

// ---- results that don't fit the deal ----
const X = who('X'), d = { date: today };
const h1 = boards[0], r1 = record(h1);
// the old format (contract and trick count only) gets a clear message
await check('old format', { ...X, ...d, board: 1, contract: { level: 7, strain: 'N', declarer: 'S', doubled: 2 }, declTricks: 13 }, 400, /out of date/);
// 7NT redoubled by South "claiming" all 13 at the start
await check('7NTXX claimed at trick one', { ...X, ...d, board: 1, auction: ['P', 'P', '7N', 'X', 'XX', 'P', 'P', 'P'], play: [], claim: 13 }, 400);
// illegal auctions
for (const [label, auction] of [['insufficient bid', ['1S', '1H', 'P', 'P', 'P']], ['double of partner', ['1S', 'P', 'X', 'P', 'P', 'P']],
  ['redouble without a double', ['1S', 'XX', 'P', 'P', 'P']], ['not over', ['1S', 'P', 'P']], ['calls after the end', ['P', 'P', 'P', 'P', '1S']],
  ['not a call', ['8N', 'P', 'P', 'P']], ['opening double', ['X', 'P', 'P', 'P']]])
  await check('illegal auction: ' + label, { ...X, ...d, board: 1, auction, play: [] }, 400, /auction/);
await check('auction of objects', { ...X, ...d, board: 1, auction: [{ call: 'P' }, 'P', 'P', 'P'], play: [] }, 400);
await check('passed out with play', { ...X, ...d, board: 1, auction: ['P', 'P', 'P', 'P'], play: ['SA'] }, 400);
if (h1.contract) {
  // impossible tricks: the posted declTricks is ignored, and tampered play is refused
  const p = r1.play.slice();
  const i = p.findIndex((c, k) => k > 0 && k % 4 === 1); [p[i], p[i + 4]] = [p[i + 4], p[i]];
  await check('play out of order', { ...X, ...d, board: 1, auction: r1.auction, play: p, claim: r1.claim }, 400, /card/);
  await check('a card played twice', { ...X, ...d, board: 1, auction: r1.auction, play: [r1.play[0], r1.play[0]], claim: 0 }, 400, /card/);
  if (r1.claim == null) {
    await check('claim after the last card', { ...X, ...d, board: 1, ...r1, claim: 0 }, 400);
    await check('full play cut short with no claim', { ...X, ...d, board: 1, ...r1, play: r1.play.slice(0, 48) }, 400, /not finished/);
  }
  // another board's cards (wrong deal): board 1's record posted as board 3, and as yesterday's board 1
  await check('wrong board', { ...X, ...d, board: 3, ...r1 }, 400);
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await check("another day's deal", { ...X, date: y, board: 1, ...r1 }, 400);
}
await check('non-string card', { ...X, ...d, board: 1, auction: r1.auction, play: [1, 2, 3] }, 400);
// nothing of X was stored
const lb2 = await (await fetch(`${BASE}/api/daily/${today}?u=${await uidOf(X.secret)}`)).json();
assert.ok(!Object.values(lb2.boards).some(b => b.rows.some(r => r.you)), 'no refused result was stored');

// bad inputs
for (const bad of [{}, { date: '2001-01-01', board: 1, secret: A.secret }, { date: today, board: 5, secret: A.secret },
  { date: today, board: 1, secret: 'short' }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
assert.equal((await fetch(BASE + '/api/daily/2001-01-01')).status, 400);

// rate limit per address (refused results don't count; accepted ones do)
let limited = false; const ip2 = freshIp();
for (let i = 0; i < 45 && !limited; i++) limited = (await post({ secret: rnd(), name: 'x', date: today, board: 3, auction: ['P', 'P', 'P', 'P'] }, ip2)).status === 429;
assert.ok(limited, 'an address is rate limited');

// the table-creation limit counts a whole IPv6 /64 as one address, however its addresses are written
const net = '2001:db8:' + [1, 2].map(() => Math.floor(Math.random() * 65535).toString(16)).join(':');
const mkTable = addr => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': addr }, body: JSON.stringify({ secret: rnd(), name: 'v6' }) });
let made = 0, v6limited = false;
for (let i = 1; i <= 25 && !v6limited; i++) {
  const r = await mkTable(i % 2 ? `${net}:${i.toString(16)}::1` : `${net.replace(/:0*([0-9a-f])/g, ':0$1')}:0:0:0:${i.toString(16)}`);
  if (r.status === 429) v6limited = true; else { assert.equal(r.status, 200); made++; }
}
assert.ok(v6limited && made === 20, `one /64 is limited together (${made} tables made)`);
assert.equal((await mkTable('2001:db8:ffff:' + Math.floor(Math.random() * 65535).toString(16) + '::1')).status, 200, 'another /64 is not');
console.log(`daily: ${passed} checks passed, ${failed} failed (${claims} of the 4 honest boards ended in a robot claim)`);
if (failed) process.exit(1);
console.log('daily: all passed');
