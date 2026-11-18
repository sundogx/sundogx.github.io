// Where constructive bidding loses: self-play on deals where only one side bids (the other passes throughout),
// each contract compared with the best double-dummy contract that side could have reached (hindsight).
// Needs the double-dummy cache from tests/bidddsim.js for the same seed (run that first).
// Usage: node tests/bidloss.js [boards=1000] [seed=1] [--base=basebid] [--by=cat|open|seq] [--show=k] [--cat=text]
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const flag = (k, d) => { const f = flags.find(x => x.startsWith('--' + k + '=')); return f ? f.slice(k.length + 3) : d; };
const SYS = flag('base') ? require('./fixtures/' + flag('base') + '.js') : require('../js/bidding.js');
const BY = flag('by', 'cat'), SHOW = +flag('show', 0), CAT = flag('cat', null);
const cache = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `bridge-dd-${SEED}.json`), 'utf8'));
const rand = seededRand('bidddsim-' + SEED);
const key = h => SEATS.map(s => h[s].join('')).join('|');
const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');
const gameLv = s => s === 'N' ? 3 : (s === 'S' || s === 'H') ? 4 : 5;
const lvlName = c => c.level >= 7 ? 'grand' : c.level === 6 ? 'slam' : c.level >= gameLv(c.strain) ? 'game' : 'part';
const groups = {}, shownL = [], cal = {};
let nCons = 0, tot = 0;
for (let g = 0; g < N; g++) {
  const bn = g + 1, dealer = boardDealer(bn), vul = boardVul(bn), hands = deal(rand), dd = cache[key(hands)];
  if (!dd) continue;
  const auction = [];
  while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = SYS.botCall(hands[s], s, dealer, auction); auction.push({ call: r.call, by: s }); }
  const bidders = new Set(auction.filter(a => a.call !== 'P').map(a => sideOf(a.by)));
  if (bidders.size !== 1) continue;
  nCons++;
  const side = [...bidders][0], sg = side === 'NS' ? 1 : -1;
  const ct = finalContract(auction);
  const actual = sg * scoreNS(ct, dd[ct.declarer][ct.strain], vul);
  let best = -1e9, bestC = null;
  for (const d of SEATS.filter(s => sideOf(s) === side)) for (const st of STRAINS) for (let l = 1; l <= 7; l++) {
    const c = { level: l, strain: st, declarer: d, doubled: 0 };
    const v = sg * scoreNS(c, dd[d][st], vul); if (v > best) { best = v; bestC = c; }
  }
  let bestSame = -1e9;
  for (let l = 1; l <= 7; l++) { const v = sg * scoreNS({ level: l, strain: ct.strain, declarer: ct.declarer, doubled: 0 }, dd[ct.declarer][ct.strain], vul); if (v > bestSame) bestSame = v; }
  const loss = toImps(best - actual);
  tot += loss;
  const tricks = dd[ct.declarer][ct.strain], made = tricks >= ct.level + 6;
  const a = lvlName(ct), b = lvlName(bestC);
  let cat = loss === 0 ? 'ok' : a === b ? `${a}: other ${a}` : `${a} (best ${b})${made ? '' : ' down'}`;
  if (loss && ct.strain !== bestC.strain && toImps(best - bestSame) >= 2) cat += ' [strain]';
  const seq = auction.map(x => x.call); while (seq[0] === 'P') seq.shift();
  const sq = seq.filter((x, i) => i % 2 === 0);
  const k = BY === 'cat' ? cat : BY === 'open' ? sq[0] + ' | ' + cat : sq.slice(0, +flag('n', 3)).join(' ');
  const hcG = SEATS.filter(s => sideOf(s) === side).reduce((t, s) => t + hcp(hands[s]), 0);
  if ((!CAT || cat.includes(CAT)) && hcG >= +flag("minhcp", 0)) { const gr = groups[k] || (groups[k] = { n: 0, imps: 0 }); gr.n++; gr.imps += loss; }
  { // slam calibration by combined HCP: deals, slams bid, slams bid that make, deals where a small slam makes
    const hc = SEATS.filter(s => sideOf(s) === side).reduce((t, s) => t + hcp(hands[s]), 0);
    const r = cal[hc] || (cal[hc] = { n: 0, bid: 0, made: 0, can: 0, gameMade: 0, game: 0 });
    r.n++; if (ct.level >= 6) { r.bid++; if (made) r.made++; }
    if (bestC.level >= 6) r.can++;
    if (ct.level < 6 && ct.level >= gameLv(ct.strain)) { r.game++; if (made) r.gameMade++; }
  }
  const hcS = SEATS.filter(s => sideOf(s) === side).reduce((t, s) => t + hcp(hands[s]), 0);
  if (SHOW && hcS >= +flag("minhcp", 0) && (!CAT || k.includes(CAT) || cat.includes(CAT) || sq.join(' ').startsWith(CAT)) && loss > 0) shownL.push({ loss, text: `Board ${bn} ${side} vul ${vul} loss ${loss}: ${sq.join(' ')} => ${contractText(ct)} ${tricks} tricks; best ${contractText(bestC)} (${best} vs ${actual})\n` + SEATS.filter(s => sideOf(s) === side).map(s => `   ${s} ${show(hands[s])} (${hcp(hands[s])})`).join('\n') + `\n   dd ${SEATS.filter(s => sideOf(s) === side).map(s => s + ':' + STRAINS.map(x => dd[s][x]).join('/')).join(' ')} (${STRAINS.join('')})` });
}
console.log(`${nCons} constructive deals of ${N}; mean loss to best contract ${(tot / nCons).toFixed(3)} IMPs (sum ${tot})`);
Object.entries(groups).sort((a, b) => b[1].imps - a[1].imps).slice(0, +flag('top', 40)).forEach(([k, g]) => console.log(`${String(g.imps).padStart(6)} ${String(g.n).padStart(5)}  ${k}`));
if (flags.includes('--cal')) { console.log('HCP  deals  slams bid/made  slam makes  games bid/made'); for (let c = 18; c <= 37; c++) if (cal[c]) console.log(`${c}  ${cal[c].n}  ${cal[c].bid}/${cal[c].made}  ${cal[c].can}  ${cal[c].game}/${cal[c].gameMade}`); }
shownL.sort((a, b) => b.loss - a.loss).slice(0, SHOW).forEach(x => console.log('\n' + x.text));
