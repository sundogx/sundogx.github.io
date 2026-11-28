// "Your mistakes" bidding problems (js/drills.js drBidExtract). node tests/drillbidtest.js [boards=300] [--cache=file]
// Boards bid by the robots (js/bidding.js botCall) where "you" (one seat) sometimes make another call; the robots bid on
// after it, as at a practice table. Checks that a problem is made only at your calls that differ from the robots' call,
// that its loss is the IMPs between the robots' call (robots bidding on) and the contract reached, double dummy, that
// your call with the robots bidding on also loses, that boards where you bid as the robots make none, and the DD table
// packing. Double-dummy tables: a made-up table from the hands' strength, or real ones from a tests/bidddsim.js cache
// (--cache=$TMPDIR/bridge-dd-<seed>.json; the boards are then dealt with that seed so the tables are found).
Object.assign(globalThis, require('../js/engine.js'));
Object.assign(globalThis, require('../js/bidding.js'));
const D = require('../js/drills.js');
const fs = require('fs');
const args = process.argv.slice(2), N = +(args.find(a => !a.startsWith('--')) || 300);
const cacheF = (args.find(a => a.startsWith('--cache=')) || '').slice(8);
const cache = cacheF ? JSON.parse(fs.readFileSync(cacheF, 'utf8')) : null;
const seed = cacheF ? (cacheF.match(/bridge-dd-(.+)\.json$/) || [])[1] : null;
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
const dealRnd = seededRand(seed ? 'bidddsim-' + seed : 'drillbid'), rnd = seededRand('drillbid-slips'); // deals as bidddsim's
const key = h => SEATS.map(s => h[s].join('')).join('|');
// a made-up DD table: a side's tricks in a strain from its points and its trumps
function fakeDD(hands) {
  const t = {};
  for (const d of SEATS) {
    t[d] = {};
    const p = partnerOf(d), pts = hcp(hands[d]) + hcp(hands[p]);
    for (const st of ['N', 'S', 'H', 'D', 'C']) {
      const fit = st === 'N' ? 0 : hands[d].concat(hands[p]).filter(c => c[0] === st).length - 8;
      t[d][st] = Math.max(0, Math.min(13, Math.round(6.5 + (pts - 20) / 3 + (st === 'N' ? 0 : fit * 0.8))));
    }
  }
  return t;
}
const robotCall = (hands, dealer, au, vul) => { const by = auctionTurn(dealer, au), r = botCall(hands[by], by, dealer, au, vul); return r.alert ? { call: r.call, by, alert: r.alert } : { call: r.call, by }; };
let boards = 0, probs = 0, devs = 0, clean = 0, ms = 0;
const pack = 'b'.repeat(20);
for (let g = 0; g < N; g++) {
  const bn = g + 1, dealer = boardDealer(bn), vul = boardVul(bn), hands = deal(dealRnd);
  const dd = cache ? cache[key(hands)] : fakeDD(hands);
  if (!dd) continue;
  const seat = SEATS[g % 4], auction = [];
  let dev = false;
  while (!auctionOver(auction) && auction.length < 80) {
    const c = robotCall(hands, dealer, auction, vul);
    if (c.by === seat && rnd() < 0.3) {
      const legal = legalCalls(dealer, auction), v = bidValue(c.call);
      // a human-like slip: pass, or a bid near the robots' call
      const near = legal.filter(x => x === 'P' || (bidValue(x) >= 0 && (v < 0 ? bidValue(x) < 10 + Math.max(0, ...auction.map(a => bidValue(a.call))) : Math.abs(bidValue(x) - v) <= 6)));
      const pick = near[Math.floor(rnd() * near.length)] || 'P';
      if (pick !== c.call) dev = true;
      auction.push({ call: pick, by: seat });
    } else auction.push(c);
  }
  const contract = finalContract(auction);
  const h = { board: bn, dealer, vul, hands, auction, contract };
  const r = { id: 'p::' + g, date: 1e12 + g, seat, h };
  ok(D.drBidNeedsCheck(r), 'board needs a check');
  boards++; if (dev) devs++;
  const t0 = Date.now(), found = D.drBidExtract(r, dd); ms += Date.now() - t0;
  if (!dev) { ok(!found.length, 'no problems when you bid as the robots'); clean++; }
  const sg = seat === 'N' || seat === 'S' ? 1 : -1, sc = c => c ? scoreNS(c, dd[c.declarer][c.strain], vul) : 0;
  for (const it of found) {
    probs++;
    const a = auction[it.i], rb = botCall(hands[seat], seat, dealer, auction.slice(0, it.i), vul);
    ok(a.by === seat && it.card === a.call && it.kind === 'bid' && it.k === r.id + '#b' + it.i, 'problem at your call');
    ok(rb.call === it.rcall && rb.call !== a.call, 'robots\' call differs');
    // the robots bid on after their call
    const au = auction.slice(0, it.i).concat([{ call: rb.call, by: seat, alert: rb.alert }]);
    while (!auctionOver(au)) au.push(robotCall(hands, dealer, au, vul));
    const rob = sc(finalContract(au));
    ok(it.loss === toImps(sg * (rob - sc(contract))) && it.loss > 0, 'loss against the contract reached');
    const mine = D.drBidJudge(h, it.i, a.call, dd);
    ok(toImps(sg * (rob - mine.ns)) > 0, 'your call loses with the robots bidding on too');
    ok(mine.auction.length > it.i && mine.auction[it.i].call === a.call && auctionOver(mine.auction), 'judge auction');
    ok(JSON.stringify(D.drDDUnpack(it.dd)) === JSON.stringify(Object.fromEntries(SEATS.map(d => [d, Object.fromEntries(['N', 'S', 'H', 'D', 'C'].map(st => [st, dd[d][st]]))]))), 'DD table kept');
  }
}
ok(D.drDDUnpack(pack).N.N === 11 && D.drDDPack(D.drDDUnpack(pack)) === pack, 'pack round trip');
ok(!D.drBidNeedsCheck({ seat: 'S', h: { auction: [{ call: 'P', by: 'N' }], hands: { S: [] } } }), 'unfinished or no hand: not checked');
ok(boards > N * 0.5 && probs > boards * 0.05, `enough cases (${boards} boards, ${probs} problems)`);
// a bidding problem's IMPs weigh about a third of a trick in the queue
const mk = (k, kind, loss) => ({ k, rec: 'r', i: 0, kind, loss, date: 1, box: 0, due: 0, tries: 0, right: 0 });
ok(D.drQueue([mk('a', 'decl', 1), mk('b', 'bid', 6), mk('c', 'bid', 2)], 'all', 1, false).map(x => x.k).join() === 'b,a,c', 'queue weighs IMPs against tricks');
ok(D.drQueue([mk('a', 'decl', 1), mk('b', 'bid', 6)], 'bid', 1, false).map(x => x.k).join() === 'b', 'bidding kind filter');
console.log(process.exitCode ? 'drill bidding: FAILED' : `drill bidding: ${boards} boards (${devs} with a call of yours unlike the robots'), ${probs} problems, ${(ms / boards).toFixed(1)} ms a board, ok`);
