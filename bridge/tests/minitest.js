// MiniBridge rules (js/minibridge.js) and robot card play with no auction. Run: node tests/minitest.js [deals]
Object.assign(globalThis, require('../js/engine.js'));
const B = require('../js/bots.js');
const { Mini } = require('../js/minibridge.js');
let fails = 0;
const eq = (x, y, m) => { const a = JSON.stringify(x), b = JSON.stringify(y); if (a !== b) { console.log('FAIL', m, a, '!=', b); fails++; } };
// hands holding the given honours (points are all that matters here)
const mk = spec => { const h = {}; for (const s of SEATS) h[s] = (spec[s] || '').split(' ').filter(Boolean); return h; };
const ns = h => hcp(h.N) + hcp(h.S);

let h = mk({ S: 'SA SK HA DQ CJ CK', N: 'HK HQ DA CQ', E: 'SQ SJ DK DJ', W: 'HJ CA' });
eq([ns(h), Mini.declarer(h, 'N')], [28, 'S'], 'stronger side, stronger hand');
h = mk({ S: 'SA SK HA', N: 'HK HQ DA DK', E: 'SQ SJ DQ', W: 'CA CK CQ CJ' });
eq([Mini.declarer(h, 'E'), Mini.declarer(h, 'S')], ['N', 'N'], 'North has more');
h = mk({ S: 'SA SK HQ HJ', N: 'HA HK DQ DJ', E: 'SQ SJ DA', W: 'DK CA CK' });
eq([hcp(h.N), hcp(h.S), ns(h), Mini.declarer(h, 'E'), Mini.declarer(h, 'W'), Mini.declarer(h, 'N'), Mini.declarer(h, 'S')], [10, 10, 20, 'S', 'N', 'N', 'S'], 'partners tie: the one nearer the dealer');
h = mk({ S: 'SA SK HA DA', N: 'HK HQ', E: 'SQ SJ DQ DJ CK', W: 'CA CQ CJ HJ DK' });
eq([ns(h), Mini.declarer(h, 'E'), Mini.declarer(h, 'N')], [20, 'W', 'S'], '20-20: the dealer\'s side declares');

// the robots' double-dummy choice
eq(Mini.best({ S: { N: 9, S: 10, H: 8, D: 7, C: 7 } }, 'S', 'None').contract, { level: 4, strain: 'S', doubled: 0, declarer: 'S' }, '4S makes');
const pt = Mini.best({ S: { N: 8, S: 8, H: 7, D: 9, C: 7 } }, 'S', 'None');
eq([pt.contract.level, pt.contract.strain, pt.score], [1, 'N', 120], 'no game: 1NT+1 (120) over 1S+1 and 1D+2 (110)');
eq(Mini.best({ W: { N: 4, S: 4, H: 4, D: 11, C: 6 } }, 'W', 'EW').contract.level, 5, '5D vulnerable');
eq(Mini.best({ S: { N: 9, S: 9 } }, 'S', 'None'), null, 'incomplete table');
eq(Mini.contracts('H', 'W').map(c => c.level), [1, 4], 'hearts: 1 or 4');
eq(Mini.contracts('C', 'W').map(c => c.level), [1, 5], 'clubs: 1 or 5');

// robot card play with no auction
const N = +process.argv[2] || 300;
let errs = 0, made = 0;
for (let g = 0; g < N; g++) {
  const hands = deal(), dealer = boardDealer(g + 1), d = Mini.declarer(hands, dealer);
  const side = sideOf(d) === 'NS' ? ns(hands) : 40 - ns(hands);
  if (side < 20 || hcp(hands[d]) < hcp(hands[partnerOf(d)])) { errs++; console.log('wrong declarer'); }
  const c = Mini.guess(hands, d), t = { hands, auction: [], contract: c, play: { tricks: [] } };
  for (let i = 0; i < 52; i++) {
    const s = playTurn(t.play, c), card = B.botPlay(t, s);
    if (!legalPlays(hands, t.play, c, s).includes(card)) { errs++; console.log('illegal play'); break; }
    applyPlay(t.play, c, s, card);
  }
  const tw = tricksWon(t.play, c); if (tw.decl + tw.def !== 13) errs++; if (tw.decl >= c.level + 6) made++;
}
eq(errs, 0, 'MiniBridge play errors');
if (fails) { console.log(fails + ' MiniBridge test(s) failed'); process.exit(1); }
console.log(`MiniBridge tests passed (${N} deals, ${made} made by the robots' guessed contract)`);
