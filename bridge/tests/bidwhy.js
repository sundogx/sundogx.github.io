// Debug one call: node tests/bidwhy.js "K7.JT74.94.AQT87" N dealer "P P 1D 1S" [vul: None NS EW Both]
Object.assign(globalThis, require('../js/engine.js'));
globalThis.BID_DEBUG = true;
const B = require('../js/bidding.js');
const [hs, seat, dealer, auc, vul] = process.argv.slice(2);
const hand = []; hs.split('.').forEach((r, i) => { for (const c of r.replace('-', '')) hand.push('SHDC'[i] + c); });
const auction = []; let s = dealer;
for (const c of (auc || '').split(/\s+/).filter(Boolean)) { auction.push({ call: c, by: s }); s = nextSeat(s); }
const metas = B._metas(auction, vul);
auction.forEach((a, i) => console.log(a.by, a.call, JSON.stringify(metas[i])));
const r = B.botCall(hand, seat, dealer, auction, vul);
console.log('=>', r, B._tableName(hand, seat, auction, vul));
