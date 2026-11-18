// describeCall (js/bidding.js): every call in robot auctions gets a sensible explanation, and it never throws.
//   node tests/describe.js [boards] [auctions to print]
const path = require('path'), fs = require('fs'), vm = require('vm');
Object.assign(globalThis, require('../js/engine.js'));
const B = require('../js/bots.js');
// load bidding.js as the page does (its functions as globals): describeCall is not exported for the server
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/bidding.js'), 'utf8').replace(/^if \(typeof module[^\n]*$/m, ''));
const N = +process.argv[2] || 1000, SHOW = +process.argv[3] || 0;
let calls = 0, problems = 0;
const bad = (...a) => { problems++; if (problems <= 20) console.log('problem:', ...a); };
const shown = [], seen = new Set();
for (let g = 0; g < N; g++) {
  const n = g + 1, dealer = boardDealer(n), vul = boardVul(n), hands = deal(), auction = [];
  while (!auctionOver(auction) && auction.length < 40) { const s = auctionTurn(dealer, auction); const r = B.botCall(hands[s], s, dealer, auction, vul); auction.push({ call: r.call, by: s, alert: r.alert }); }
  const line = auction.map(x => x.call).join(' ');
  let d;
  try { d = describeAuction(auction, vul); } catch (e) { bad('throws', line, e.message); continue; }
  auction.forEach((a, i) => {
    if (describeCall(auction, i, vul) !== d[i]) bad('describeCall differs from describeAuction', line, i);
    if (a.call === 'P') return;
    calls++;
    if (!d[i]) bad('no explanation', line, i);
    else if (/undefined|NaN|null|\b0-37\b|37\+/.test(d[i])) bad('garbled', line, i, d[i]);
    if (a.alert && d[i] && !d[i].startsWith(a.alert)) bad('does not start with the alert', line, i, d[i]);
  });
  const key = auction.filter(x => x.call !== 'P').map(x => x.call).join(' ');
  if (shown.length < SHOW && !seen.has(key) && g % 5 === 0) { seen.add(key); shown.push(`#${n} dealer ${dealer}, ${vul}\n` + auction.map((a, i) => `  ${a.by} ${a.call.padEnd(3)} ${d[i] || ''}`).join('\n')); }
}
for (const x of [null, undefined, [], [{}], [{ call: '1S' }], [{ call: 'ZZ', by: 'N' }], [{ call: 'P', by: 'N' }]]) {
  try { describeCall(x, 0, 'None'); describeAuction(x || [], 'None'); } catch (e) { bad('throws on bad input', JSON.stringify(x), e.message); }
}
if (shown.length) console.log(shown.join('\n'));
console.log(`describe: ${N} auctions, ${calls} robot calls, ${problems} problems`);
if (problems) process.exit(1);
