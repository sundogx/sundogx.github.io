// Prints robot auctions with all four hands, for reading the bidding by eye.
// Usage: node tests/bidshow.js [deals=10] [seed=1] [filter regexp on the auction, e.g. "^1S P 1N"]
Object.assign(globalThis, require('../js/engine.js'));
globalThis.BID_DEBUG = true;
const B = require('../js/bidding.js');
const n = +process.argv[2] || 10, seed = process.argv[3] || '1', re = process.argv[4] ? new RegExp(process.argv[4]) : null;
const rand = seededRand('bidshow-' + seed);
const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');
let shownN = 0;
for (let g = 0; g < 20000 && shownN < n; g++) {
  const bn = g + 1, dealer = boardDealer(bn), hands = deal(rand), auction = [];
  while (!auctionOver(auction) && auction.length < 60) {
    const s = auctionTurn(dealer, auction), r = B.botCall(hands[s], s, dealer, auction);
    auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s });
  }
  // the auction from the dealer, with passes before the opening dropped
  const text = auction.map(a => a.call).join(' ');
  if (re && !re.test(text)) continue;
  shownN++;
  console.log(`Board ${bn}, dealer ${dealer}`);
  SEATS.forEach(s => console.log(`  ${s} ${show(hands[s]).padEnd(22)} ${hcp(hands[s])}`));
  console.log('  ' + auction.map(a => `${a.by}:${a.call}${a.alert ? ` (${a.alert})` : ''}`).join(' '));
  const ct = finalContract(auction); console.log('  => ' + contractText(ct) + '\n');
}
