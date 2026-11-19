// Flashcards and explorer helpers (js/flashcards.js, js/explorer.js): every topic produces cards quickly, each card's
// robot call is the robot's real call there, the topic classifier agrees, and the explorer's hand parser and
// example hands work.   node tests/flashcards.js [cards per topic]
const path = require('path'), fs = require('fs'), vm = require('vm');
Object.assign(globalThis, require('../js/engine.js'));
const load = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8').replace(/^if \(typeof module[^\n]*$/m, ''));
load('bidding.js'); load('explorer.js'); load('flashcards.js');
const N = +process.argv[2] || 20;
let bad = 0; const fail = (...a) => { bad++; if (bad <= 20) console.log('problem:', ...a); };
for (const [topic] of FC_TOPICS) {
  const t0 = Date.now(), times = [], calls = {}; let none = 0;
  for (let i = 0; i < N; i++) {
    const s = Date.now(), c = fcGenerate(topic); times.push(Date.now() - s);
    if (!c) { none++; continue; }
    if (auctionTurn(c.dealer, c.prefix) !== 'S') fail(topic, 'not South to call');
    const r = botCall(c.hands.S, 'S', c.dealer, c.prefix, c.vul);
    if (r.call !== c.call) fail(topic, 'robot call differs', c.call, r.call);
    if (fcTopicOf(c.prefix, c.call, c.vul) !== topic) fail(topic, 'classifier');
    if (!fcSame(c.prefix, c.call, c.call, c.vul)) fail(topic, 'not same as itself');
    calls[c.call] = (calls[c.call] || 0) + 1;
    if (process.env.SHOW && i < 4) console.log(' ', topic, c.dealer, c.vul, c.prefix.map(a => a.call).join(' ') || '-', '->', c.call);
  }
  times.sort((a, b) => a - b);
  console.log(`${topic}: ${N - none}/${N} cards, median ${times[N >> 1]} ms, max ${times[N - 1]} ms, calls ${Object.entries(calls).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x.join(':')).join(' ')}`);
  if (none > N / 10) fail(topic, `${none} of ${N} found nothing`);
}
// only the robot's call itself counts as right
if (fcSame([], 'P', '1S', 'None')) fail('pass same as 1S');
// hand parser
const ok = (s, n) => { const r = bxParseHand(s); if (r.error || r.cards.length !== 13) fail('parse', s, r.error); else if (n && hcp(r.cards) !== n) fail('parse hcp', s, hcp(r.cards)); };
ok('AKQ2 J54 T92 832', 10); ok('AKQ2.J54.T92.832', 10); ok('S AKQ2 H J54 D 10 9 2 C 832', 10); ok('♠AKQ2 ♥J54 ♦T92 ♣832'); ok('AKQJT98765432 - - -', 10);
for (const s of ['AKQ2 J54 T9', 'AKQ2 J54 T9 83', 'AKQA J54 T9 832', 'AKQ2 J54 T9 83X']) if (!bxParseHand(s).error) fail('parse should fail', s);
const back = bxParseHand(bxHandText(deal().N)); if (back.error) fail('round trip');
// example hands fit the auction
for (const spec of [['N', '1S P 2S P'], ['N', '1N P 2C P'], ['E', '1H 2C 2H'], ['N', '1C P 1H P 1N P 2D P']]) {
  const [dealer, line] = spec, calls = line.split(' '), auction = []; let s = dealer;
  for (const c of calls) { auction.push({ by: s, call: c }); s = nextSeat(s); }
  const seat = auctionTurn(dealer, auction.slice(0, -3));
  const r = bxExample(auction, dealer, 'None', seat);
  if (!r) { fail('no example', line); continue; }
  if (r.strict) auction.forEach((a, i) => { if (a.by === seat && botCall(r.cards, seat, dealer, auction.slice(0, i), 'None').call !== a.call) fail('example does not bid', line); });
  else if (!bxFitsShown(r.cards, shown(auction, seat, 'None'))) fail('example does not fit', line);
}
console.log(bad ? `${bad} problems` : 'flashcards: ok');
process.exitCode = bad ? 1 : 0;
