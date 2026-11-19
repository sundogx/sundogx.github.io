// Rubber and Chicago scoring (js/rubber.js). Run: node tests/rubbertest.js
const { Rubber } = require('../js/rubber.js');
let fails = 0;
const eq = (x, y, m) => { const a = JSON.stringify(x), b = JSON.stringify(y); if (a !== b) { console.log('FAIL', m, a, '!=', b); fails++; } };
const C = (level, strain, doubled = 0, declarer = 'S') => ({ level, strain, doubled, declarer });
const sum = (r, side) => r.above.filter(a => a.side === side).reduce((s, a) => s + a.pts, 0);

// ---- one deal ----
let r = Rubber.score(C(4, 'S'), 10, 'None'); eq([r.side, r.below, r.above.length], ['NS', 120, 0], '4S= below 120, nothing above');
r = Rubber.score(C(3, 'N'), 10, 'None'); eq([r.below, sum(r, 'NS')], [100, 30], '3NT+1');
r = Rubber.score(C(1, 'N'), 7, 'None'); eq([r.below, r.above.length], [40, 0], '1NT= no part-score bonus');
r = Rubber.score(C(2, 'C'), 9, 'None'); eq([r.below, sum(r, 'NS')], [40, 20], '2C+1');
r = Rubber.score(C(2, 'H', 1), 9, 'NS'); eq([r.below, sum(r, 'NS')], [120, 200 + 50], '2HX+1 vul: 200 overtrick + 50 insult');
r = Rubber.score(C(1, 'S', 2), 8, 'None'); eq([r.below, sum(r, 'NS')], [120, 200 + 100], '1SXX+1 nv');
r = Rubber.score(C(1, 'S', 2), 8, 'NS'); eq([r.below, sum(r, 'NS')], [120, 400 + 100], '1SXX+1 v');
r = Rubber.score(C(6, 'H'), 12, 'None'); eq([r.below, sum(r, 'NS')], [180, 500], '6H= nv small slam');
r = Rubber.score(C(7, 'N', 0, 'E'), 13, 'EW'); eq([r.side, r.below, sum(r, 'EW')], ['EW', 220, 1500], '7NT= v grand slam');
r = Rubber.score(C(4, 'S'), 8, 'None'); eq([r.below, sum(r, 'EW')], [0, 100], '4S-2 nv to the defenders');
r = Rubber.score(C(4, 'S'), 8, 'EW'); eq(sum(r, 'EW'), 100, 'declarer not vul when only E-W are');
r = Rubber.score(C(4, 'S', 1), 6, 'None'); eq(sum(r, 'EW'), 800, '4SX-4 nv');
r = Rubber.score(C(4, 'S', 1), 7, 'NS'); eq(sum(r, 'EW'), 800, '4SX-3 v');
r = Rubber.score(C(4, 'S', 2), 9, 'None'); eq(sum(r, 'EW'), 200, '4SXX-1 nv');
r = Rubber.score(C(5, 'D', 1, 'W'), 11, 'None'); eq([r.below, sum(r, 'EW')], [200, 50], '5DX= below 200');
// duplicate scoring agrees once the bonuses are put back (a check on the shared parts)
const E = require('../js/engine.js');
for (const [c, tr, v] of [[C(4, 'S'), 11, 'NS'], [C(3, 'N', 1), 9, 'None'], [C(6, 'D'), 12, 'Both'], [C(2, 'H'), 5, 'NS'], [C(3, 'C', 2), 4, 'None']]) {
  const x = Rubber.score(c, tr, v), dup = E.scoreContract(c, tr, v), made = tr >= c.level + 6;
  const bonus = !made ? 0 : x.below >= 100 ? (E.isVul(v, c.declarer) ? 500 : 300) : 50;
  eq(made ? x.below + sum(x, 'NS') + bonus : -sum(x, 'EW'), dup, 'matches duplicate ' + JSON.stringify(c) + ' ' + tr);
}

// ---- honours ----
const H = (spec) => { const h = { N: [], E: [], S: [], W: [] }; for (const [s, cs] of Object.entries(spec)) h[s] = cs.split(' '); return h; };
eq(Rubber.honours(H({ S: 'SA SK SQ SJ S2' }), C(4, 'S')), { side: 'NS', pts: 100, what: 'Four honours' }, '4 honours');
eq(Rubber.honours(H({ E: 'HA HK HQ HJ HT' }), C(4, 'H')), { side: 'EW', pts: 150, what: 'Five honours' }, 'defender holds 5 honours');
eq(Rubber.honours(H({ W: 'SA HA DA CA' }), C(3, 'N')), { side: 'EW', pts: 150, what: 'Four aces' }, '4 aces at NT');
eq(Rubber.honours(H({ W: 'SA HA DA S2', N: 'CA' }), C(3, 'N')), null, 'aces split');
eq(Rubber.honours(H({ S: 'SA SK SQ' }), C(4, 'S')), null, '3 honours: none');

// ---- a rubber ----
const L = (...es) => es.map(([c, t, hon], i) => ({ board: i + 1, contract: c, declTricks: t, hon: hon || null }));
let sh = Rubber.sheet(L([C(2, 'S'), 8], [C(2, 'H', 0, 'E'), 8], [C(2, 'S'), 8]), { mode: 'rubber' });
// 60 + 60: N-S game; E-W's 60 is cut off
eq([sh.cur.won, sh.cur.games.length, sh.cur.games[0].winner, sh.cur.deals.map(d => d.vul)], [{ NS: 1, EW: 0 }, 2, 'NS', ['None', 'None', 'None']], 'part-scores build a game');
eq(Rubber.next(L([C(2, 'S'), 8], [C(2, 'S'), 8]), { mode: 'rubber' }, 3), { dealer: 'S', vul: 'NS' }, 'game makes you vulnerable');
sh = Rubber.sheet(L([C(4, 'S'), 10], [C(3, 'N', 0, 'W'), 9], [C(4, 'H'), 9], [C(5, 'C'), 11]), { mode: 'rubber' });
eq([sh.sets.length, sh.sets[0].won, sh.sets[0].done], [1, { NS: 2, EW: 1 }, true], 'rubber 2-1');
eq(sh.sets[0].above.find(a => a.what === 'Rubber'), { side: 'NS', pts: 500, what: 'Rubber', board: 4 }, '500 rubber bonus');
eq(sh.sets[0].deals.map(d => d.vul), ['None', 'NS', 'Both', 'Both'], 'vulnerability follows the games');
eq(sh.sets[0].total, { NS: 120 + 100 + 500, EW: 100 + 100 }, 'rubber totals (4H-1 vul: 100 to E-W)');
eq([sh.cur.deals.length, Rubber.setVul(sh.cur)], [0, 'None'], 'a new rubber starts nobody vulnerable');
sh = Rubber.sheet(L([C(4, 'S'), 10], [C(4, 'S'), 10], [C(1, 'C'), 7]), { mode: 'rubber' });
eq([sh.sets[0].above[0], sh.cur.deals.length], [{ side: 'NS', pts: 700, what: 'Rubber', board: 2 }, 1], '700 for 2-0, then a new rubber');
sh = Rubber.sheet(L([C(4, 'S'), 10, { side: 'EW', pts: 100, what: 'Four honours' }]), { mode: 'rubber', honours: true });
eq(sh.cur.total, { NS: 120, EW: 100 }, 'honours counted when on');
sh = Rubber.sheet(L([C(4, 'S'), 10, { side: 'EW', pts: 100, what: 'Four honours' }]), { mode: 'rubber' });
eq(sh.cur.total, { NS: 120, EW: 0 }, 'honours off');
sh = Rubber.sheet(L([C(4, 'S'), 10], [C(2, 'D', 0, 'E'), 8]), { mode: 'rubber' });
eq(Rubber.unfinished(sh.cur), { NS: 300, EW: 100 }, 'unfinished rubber: 300 for the game, 100 for the part-score');
sh = Rubber.sheet(L([null, null], [C(1, 'N'), 7]), { mode: 'rubber' });
eq([sh.cur.deals.length, sh.cur.total.NS], [2, 40], 'passed-out deal in rubber');

// ---- Chicago ----
const ch = { mode: 'chicago' };
eq([0, 1, 2, 3].map(p => Rubber.chicagoVul(p, Rubber.chicagoDealer(p))), ['None', 'EW', 'NS', 'Both'], 'Chicago vulnerability');
sh = Rubber.sheet(L([C(4, 'S'), 10], [C(2, 'S'), 8], [C(3, 'N', 0, 'E'), 9], [C(2, 'S'), 8]), ch);
// deal 1: 120 + 300 game; deal 2 (E-W vul): N-S 60 part; deal 3 (N-S vul): E-W 3NT nv game 100+300, cuts off N-S's 60;
// deal 4 (both): N-S 60, not a game: +100
eq([sh.sets.length, sh.sets[0].total], [1, { NS: 120 + 300 + 60 + 60 + 100, EW: 100 + 300 }], 'Chicago totals');
eq(sh.sets[0].deals.map(d => d.vul), ['None', 'EW', 'NS', 'Both'], 'Chicago deals');
sh = Rubber.sheet(L([C(2, 'S'), 8], [C(2, 'S'), 8]), ch);
eq(sh.cur.above.find(a => a.what === 'Game'), { side: 'NS', pts: 300, what: 'Game', board: 2 }, 'part-scores make a game (deal 2: only E-W vulnerable)');
sh = Rubber.sheet(L([null, null], [C(1, 'S'), 7]), ch);
eq([sh.cur.pos, sh.cur.deals[1].vul, Rubber.next(L([null, null]), ch, 2)], [1, 'None', { dealer: 'N', vul: 'None', pos: 0 }], 'Chicago passed out: redealt by the same dealer');
sh = Rubber.sheet(L([C(1, 'S'), 7], [C(1, 'S'), 7], [C(1, 'S'), 7], [C(4, 'S'), 10], [C(1, 'N'), 7]), ch);
eq([sh.sets.length, sh.cur.pos, sh.cur.total.NS], [1, 1, 40], 'second Chicago starts afresh');

if (fails) { console.log(fails + ' rubber test(s) failed'); process.exit(1); }
console.log('rubber tests passed');
