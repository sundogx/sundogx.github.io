// Play from here / Just declare helpers (js/playfrom.js). node tests/playfromtest.js
Object.assign(globalThis, require('../js/engine.js'));
globalThis.botCall = require('../js/bidding.js').botCall;
const P = require('../js/playfrom.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
for (let n = 0; n < 200; n++) {
  const hands = deal(), dealer = SEATS[n % 4], vul = ['None', 'NS', 'EW', 'Both'][(n >> 2) % 4];
  const auction = P.pfAuction(hands, dealer, vul), contract = finalContract(auction);
  ok(auctionOver(auction), 'auction ends');
  const h = { board: 1, hands, dealer, vul, auction, contract, tricks: [] };
  for (let r = 0; r < 4; r++) {
    const g = P.pfRotate(h, r);
    ok(JSON.stringify(P.pfRotate(g, (4 - r) % 4)) === JSON.stringify(h), 'rotate back');
    if (!contract) continue;
    // a turned board scores the same for the same players: declarer's vulnerability goes with them
    ok(isVul(g.vul, g.contract.declarer) === isVul(vul, contract.declarer), 'vul follows the seats');
    const mine = (c, v) => scoreNS(c, 9, v) * (sideOf(c.declarer) === 'NS' ? 1 : -1);
    ok(mine(g.contract, g.vul) === mine(contract, vul), 'score follows');
    ok(g.hands[g.contract.declarer].join() === hands[contract.declarer].join(), 'declarer keeps the hand');
  }
  if (contract) {
    ok(P.PF_TURN(contract.declarer, P.pfTurnsTo(contract.declarer, 'S')) === 'S', 'declarer to South');
    ok(P.pfSeat(h, partnerOf(contract.declarer)) === contract.declarer && P.pfSeat(h, nextSeat(contract.declarer)) === nextSeat(contract.declarer) && P.pfSeat(h, null) === contract.declarer, 'seat taken');
  }
}
console.log(process.exitCode ? 'playfrom: FAILED' : 'playfrom: rotation and robots\' auctions ok');
