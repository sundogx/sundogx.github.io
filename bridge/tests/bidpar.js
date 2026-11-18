// Where self-play bidding lands away from par, by kind of auction and of mistake. Every deal is bid by the robots at all
// four seats; the IMPs between the final contract (scored double-dummy) and par are charged to the side that lost them.
// Needs the double-dummy cache from tests/bidddsim.js for the same seed (run that first).
// Usage: node tests/bidpar.js [boards=1000] [seed=1] [--base=basebid3] [--by=kind|open|contract|seq] [--show=k] [--grep=text] [--top=40]
//   kind: contested or not, declaring or defending side lost, contract class (part/game/slam, made/down, doubled) vs par
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const { parScore } = require('../js/par.js');
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const flag = (k, d) => { const f = flags.find(x => x.startsWith('--' + k + '=')); return f ? f.slice(k.length + 3) : d; };
globalThis.BID_OFF = (flag('off', '') || '').split(',').filter(Boolean);
const SYS = flag('base') ? require('./fixtures/' + flag('base') + '.js') : require('../js/bidding.js');
const BY = flag('by', 'kind'), SHOW = +flag('show', 0), GREP = flag('grep', null);
const cache = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `bridge-dd-${SEED}.json`), 'utf8'));
const rand = seededRand('bidddsim-' + SEED);
const key = h => SEATS.map(s => h[s].join('')).join('|');
const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');
const gameLv = s => s === 'N' ? 3 : (s === 'S' || s === 'H') ? 4 : 5;
const cls = c => !c ? 'passout' : c.level >= 7 ? 'grand' : c.level === 6 ? 'slam' : c.level >= gameLv(c.strain) ? 'game' : 'part';
const groups = {}, shownL = [];
let n = 0, tot = 0, totC = 0, nC = 0;
for (let g = 0; g < N; g++) {
  const bn = g + 1, dealer = boardDealer(bn), vul = boardVul(bn), hands = deal(rand), dd = cache[key(hands)];
  if (!dd) continue;
  const auction = [];
  while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction); const r = SYS.botCall(hands[s], s, dealer, auction, vul); auction.push({ call: r.call, by: s }); }
  const ct = finalContract(auction), par = parScore(dd, vul);
  const score = ct ? scoreNS(ct, dd[ct.declarer][ct.strain], vul) : 0;
  const dev = toImps(score - par.scoreNS); n++;
  const bidders = new Set(auction.filter(a => a.call !== 'P').map(a => sideOf(a.by)));
  const contested = bidders.size === 2;
  if (contested) { nC++; totC += Math.abs(dev); }
  tot += Math.abs(dev);
  if (!dev) continue;
  const loser = dev < 0 ? 'NS' : 'EW';
  const declSide = ct ? sideOf(ct.declarer) : null;
  const made = ct ? dd[ct.declarer][ct.strain] >= ct.level + 6 : false;
  const parSide = par.contract ? sideOf(par.contract.declarer) : null;
  const role = !ct ? 'passout' : declSide === loser ? 'declarers lost' : 'defenders lost';
  const ctTxt = ct ? `${cls(ct)} ${made ? 'made' : 'down'}${ct.doubled ? ' X' : ''}` : 'passed out';
  const parTxt = !par.contract ? 'par pass' : `par ${parSide === declSide ? 'same side' : 'other side'} ${cls(par.contract)}${par.contract.doubled ? ' X' : ''}${parSide === declSide && par.contract.strain !== ct.strain ? ' other strain' : ''}`;
  const seq = auction.map(x => x.call); while (seq[0] === 'P') seq.shift();
  const open = auction.find(a => a.call !== 'P');
  const k = BY === 'kind' ? `${contested ? 'contested' : 'one side'} | ${role} | ${ctTxt} | ${parTxt}`
    : BY === 'open' ? `${contested ? 'contested' : 'one side'} | ${open ? open.call : 'P'} | ${role}`
    : BY === 'contract' ? `${contested ? 'contested' : 'one side'} | ${ct ? ct.level + ct.strain + (ct.doubled ? 'X' : '') : 'P'} | ${role}`
    : seq.slice(0, +flag('n', 3)).join(' ');
  const gr = groups[k] || (groups[k] = { n: 0, imps: 0 }); gr.n++; gr.imps += Math.abs(dev);
  if (SHOW && (!GREP || k.includes(GREP) || seq.join(' ').startsWith(GREP)))
    shownL.push({ loss: Math.abs(dev), text: `Board ${bn} dealer ${dealer} vul ${vul}: ${loser} lose ${Math.abs(dev)} (${k})\n` + SEATS.map(s => `   ${s} ${show(hands[s]).padEnd(22)} ${hcp(hands[s])}`).join('\n') +
      `\n   ${auction.map(a => a.by + ':' + a.call).join(' ')} => ${ct ? contractText(ct) + ' ' + dd[ct.declarer][ct.strain] + ' tricks' : 'passed out'} ${score}; par ${par.text} ${par.scoreNS}\n   dd ${SEATS.map(s => s + ':' + STRAINS.map(x => dd[s][x]).join('/')).join(' ')} (${STRAINS.join('')})` });
}
console.log(`${n} deals (seed ${SEED}); mean IMPs away from par ${(tot / n).toFixed(3)}; contested ${nC} deals, ${(totC / n).toFixed(3)} of it`);
Object.entries(groups).sort((a, b) => b[1].imps - a[1].imps).slice(0, +flag('top', 40)).forEach(([k, g]) => console.log(`${String(g.imps).padStart(6)} ${String(g.n).padStart(5)}  ${k}`));
shownL.sort((a, b) => b.loss - a.loss).slice(0, SHOW).forEach(x => console.log('\n' + x.text));
