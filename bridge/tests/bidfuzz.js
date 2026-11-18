// Robots facing unpredictable (human) bidding: two seats call at random, two are robots. Every robot call must be
// legal, nothing may throw, and every auction must end. Usage: node tests/bidfuzz.js [auctions=3000]
Object.assign(globalThis, require('../js/engine.js'));
globalThis.BID_DEBUG = true; // let errors surface instead of turning into a pass
const B = require('../js/bidding.js');
const n = +process.argv[2] || 3000, rand = seededRand('bidfuzz');
let bad = 0, calls = 0;
for (let g = 0; g < n; g++) {
  const dealer = SEATS[g % 4], hands = deal(rand), auction = [], humans = g % 2 ? ['N', 'E'] : ['E', 'W'];
  while (!auctionOver(auction)) {
    const s = auctionTurn(dealer, auction), legal = legalCalls(dealer, auction);
    let call;
    if (humans.includes(s)) { // mostly passes and cheap bids, sometimes anything
      const r = rand();
      call = r < 0.55 ? 'P' : r < 0.85 ? legal[Math.min(legal.length - 1, 1 + Math.floor(rand() * 6))] : legal[Math.floor(rand() * legal.length)];
    } else {
      try { call = B.botCall(hands[s], s, dealer, auction, boardVul(g + 1)).call; calls++; } catch (e) { bad++; if (bad < 5) console.log('throws', auction.map(a => a.call).join(' '), e.stack.split('\n').slice(0, 3).join(' | ')); call = 'P'; }
      if (!legal.includes(call)) { bad++; console.log('illegal', call, auction.map(a => a.call).join(' ')); call = 'P'; }
    }
    auction.push({ call, by: s });
    if (auction.length > 80) { bad++; console.log('endless', auction.map(a => a.call).join(' ')); break; }
  }
}
console.log(`fuzz: ${n} auctions, ${calls} robot calls, ${bad} problems`);
process.exitCode = bad ? 1 : 0;
