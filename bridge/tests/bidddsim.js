// Bidding match scored double-dummy: the current robot bidding (js/bidding.js) against the old one
// (tests/fixtures/oldbid.js). Every deal is bid at two tables: new system N-S and old E-W, then swapped.
// Each final contract is scored with the double-dummy tricks from DDS (js/wasm), so card play does not
// matter. Reports IMPs per board for the new system (± standard error) and both systems against par.
//
// Usage: node tests/bidddsim.js [boards=1000] [seed=1] [--worst=10] [--self] [--cats] [--base=oldbid]
//   --off=a,b  switch off features of the new system by name (BID_OFF keys in js/bidding.js)
//   --base=name  the baseline bidding, tests/fixtures/<name>.js (oldbid: natural bidding before 2/1; basebid: 2/1 at 84c20b4;
//                basebid3: before the third round of bidding work, c0d8685; basebid4: before the fourth round, 62af5b4;
//                basebid5: before the fifth round, 24c9e08; basebid6: before the sixth round, a5bbe8a; basebid7: before the seventh round, 14aea9f; basebid8: before the eighth round, 4ee44ec; basebid9: before the ninth round, 453c984; basebid10: before the tenth round, cf26413; basebid11: before the eleventh round, 56bd996; basebid12: before the twelfth round, 6336234)
//   --k=a:1,b:2  tuning knobs of js/bidding.js (BID_K); --threads=n  solver threads
//   --worst=k  print the k boards the new system lost most on (hands and both auctions); with --best, gained most on
//   --self     also report each system in self-play against par
// Double-dummy tables are cached in the OS temp folder (bridge-dd-<seed>.json), so reruns are fast.
const { Worker, isMainThread, parentPort } = require('worker_threads');
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const RANKS_DD = '23456789TJQKA';
const wasmDir = path.join(__dirname, '..', 'js', 'wasm');

if (!isMainThread) { // solver worker: one deal at a time, on one DDS instance (js/ddplay.js ddTableRaw, DDS's table routine)
  const create = require(path.join(wasmDir, 'compiled.js')), D = require('../js/ddplay.js');
  const instP = WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm'))).then(mod => D.ddInstance(create, mod));
  parentPort.on('message', async ({ id, hands }) => {
    const table = D.ddTableRaw(await instP, D.ddPBN(hands));
    parentPort.postMessage({ id, table });
  });
  return;
}

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const WORST = +((flags.find(f => f.startsWith('--worst')) || '').split('=')[1] || 0);
const SELF = flags.includes('--self');
globalThis.BID_OFF = ((flags.find(f => f.startsWith('--off=')) || '--off=').slice(6)).split(',').filter(Boolean); // switch off named features of js/bidding.js
globalThis.BID_K = Object.fromEntries(((flags.find(f => f.startsWith('--k=')) || '--k=').slice(4)).split(',').filter(Boolean).map(x => [x.split(':')[0], +x.split(':')[1]])); // tuning knobs: --k=name:value,...
const BASE = (flags.find(f => f.startsWith('--base=')) || '--base=oldbid').split('=')[1];
const NEW = require('../js/bidding.js'), OLD = require('./fixtures/guard.js')('./' + BASE + '.js'); // knobs and penlog apply to js/bidding.js only
const { parScore } = require('../js/par.js');

const rand = seededRand('bidddsim-' + SEED);
const boards = [];
for (let g = 0; g < N; g++) { const bn = g + 1; boards.push({ bn, dealer: boardDealer(bn), vul: boardVul(bn), hands: deal(rand) }); }
const key = h => SEATS.map(s => h[s].join('')).join('|');

async function ddTables() {
  const file = path.join(os.tmpdir(), `bridge-dd-${SEED}.json`);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { }
  const save = () => { let disk = {}; try { disk = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { } fs.writeFileSync(file, JSON.stringify(Object.assign(disk, cache))); };
  const todo = boards.filter(b => !cache[key(b.hands)]);
  if (todo.length) {
    const thr = flags.find(f => f.startsWith("--threads=")), nw = Math.max(1, Math.min(todo.length, thr ? +thr.slice(10) : os.cpus().length - 1));
    process.stderr.write(`solving ${todo.length} deals double-dummy on ${nw} threads...\n`);
    let next = 0, done = 0;
    await new Promise((resolve, reject) => {
      const ws = [];
      for (let w = 0; w < nw; w++) {
        const wk = new Worker(__filename); ws.push(wk);
        const feed = () => { if (next < todo.length) { const i = next++; wk.postMessage({ id: i, hands: todo[i].hands }); } };
        wk.on('message', ({ id, table }) => {
          cache[key(todo[id].hands)] = table; done++;
          if (done % 100 === 0) { process.stderr.write(`  ${done}/${todo.length}\n`); save(); }
          if (done === todo.length) { ws.forEach(x => x.terminate()); resolve(); } else feed();
        });
        wk.on('error', reject);
        feed();
      }
    });
    save();
  }
  boards.forEach(b => { b.dd = cache[key(b.hands)]; });
}

function bid(b, sys) { // sys: { NS: module, EW: module }
  const auction = [];
  while (!auctionOver(auction)) {
    const s = auctionTurn(b.dealer, auction);
    const r = sys[sideOf(s)].botCall(b.hands[s], s, b.dealer, auction, b.vul);
    if (!isLegalCall(b.dealer, auction, r.call)) throw new Error(`illegal call ${r.call} by ${s} after ${auction.map(a => a.call).join(' ')}`);
    auction.push(r.alert ? { call: r.call, by: s, alert: r.alert } : { call: r.call, by: s });
    if (auction.length > 60) throw new Error('auction does not end: ' + auction.map(a => a.call).join(' '));
  }
  const ct = finalContract(auction);
  const score = ct ? scoreNS(ct, b.dd[ct.declarer][ct.strain], b.vul) : 0;
  return { auction, ct, score };
}
const stats = () => ({ n: 0, s: 0, q: 0, add(x) { this.n++; this.s += x; this.q += x * x; }, get mean() { return this.s / this.n; },
  get se() { const m = this.mean; return Math.sqrt(Math.max(0, this.q / this.n - m * m) / this.n); }, text() { return `${this.mean >= 0 ? '+' : ''}${this.mean.toFixed(3)} ± ${this.se.toFixed(3)}`; } });

(async () => {
  await ddTables();
  const match = stats(), newPar = stats(), oldPar = stats(), selfNew = stats(), selfOld = stats();
  let changed = 0; const swings = [];
  for (const b of boards) {
    const par = parScore(b.dd, b.vul).scoreNS;
    const t1 = bid(b, { NS: NEW, EW: OLD }), t2 = bid(b, { NS: OLD, EW: NEW });
    const imps = toImps(t1.score - t2.score);
    match.add(imps);
    newPar.add(toImps(t1.score - par)); newPar.add(toImps(par - t2.score));
    oldPar.add(toImps(t2.score - par)); oldPar.add(toImps(par - t1.score));
    if (t1.auction.map(a => a.call).join() !== t2.auction.map(a => a.call).join()) changed++;
    swings.push({ b, imps, t1, t2, par });
    if (SELF) {
      const sn = bid(b, { NS: NEW, EW: NEW }), so = bid(b, { NS: OLD, EW: OLD });
      selfNew.add(-Math.abs(toImps(sn.score - par))); selfOld.add(-Math.abs(toImps(so.score - par)));
    }
  }
  console.log(`${N} boards (seed ${SEED}), scored double-dummy; tables differ on ${changed}`);
  console.log(`New 2/1 system vs old system: ${match.text()} IMPs per board for the new system (sum ${+match.s.toFixed(1)})`);
  console.log(`Against par (each system's side of each table): new ${newPar.text()}, old ${oldPar.text()} IMPs per board`);
  if (SELF) console.log(`Self-play, IMPs away from par (0 is perfect): new ${selfNew.text()}, old ${selfOld.text()}`);
  const dist = {}; swings.forEach(x => { const k = x.imps === 0 ? '0' : x.imps > 0 ? (x.imps >= 10 ? '+10..' : x.imps >= 5 ? '+5..9' : '+1..4') : (x.imps <= -10 ? '..-10' : x.imps <= -5 ? '-9..-5' : '-4..-1'); dist[k] = (dist[k] || 0) + 1; });
  console.log('Swings:', ['..-10', '-9..-5', '-4..-1', '0', '+1..4', '+5..9', '+10..'].map(k => `${k}: ${dist[k] || 0}`).join(', '));
  if (flags.includes('--cats')) { // IMPs by who opened what (each board counted once per table, half weight)
    const cats = {};
    for (const x of swings) for (const [t, newSide] of [[x.t1, 'NS'], [x.t2, 'EW']]) {
      const o = t.auction.find(a => a.call !== 'P');
      const k = o ? `${sideOf(o.by) === newSide ? 'new' : 'old'} opens ${o.call}` : 'passed out';
      const c = cats[k] || (cats[k] = { n: 0, imps: 0 }); c.n++; c.imps += x.imps / 2;
      const both = ['NS', 'EW'].every(sd => t.auction.some(a => a.call !== 'P' && sideOf(a.by) === sd)); // did both sides bid or double?
      const k2 = both ? '[contested]' : '[one side]', c2 = cats[k2] || (cats[k2] = { n: 0, imps: 0 }); c2.n++; c2.imps += x.imps / 2;
    }
    for (const k of ['[contested]', '[one side]']) { const c = cats[k] || { n: 0, imps: 0 }; delete cats[k]; console.log(`  ${k.padEnd(16)} ${String(c.n).padStart(5)} tables  ${c.imps.toFixed(1).padStart(7)} IMPs`); }
    Object.entries(cats).sort((a, b) => a[1].imps - b[1].imps).slice(0, 25).forEach(([k, c]) => console.log(`  ${k.padEnd(16)} ${String(c.n).padStart(5)} tables  ${c.imps.toFixed(1).padStart(7)} IMPs`));
  }
  if (WORST) {
    const show = h => SUITS.map(s => h.filter(c => c[0] === s).map(c => c[1]).join('') || '-').join('.');
    const auc = t => t.auction.map(a => (a.call === 'P' ? 'P' : a.call) + (a.alert ? '*' : '')).join(' ');
    swings.sort((a, b) => flags.includes("--best") ? b.imps - a.imps : a.imps - b.imps).slice(0, WORST).forEach(({ b, imps, t1, t2, par }) => {
      console.log(`\nBoard ${b.bn} dealer ${b.dealer} vul ${b.vul}: ${imps} IMPs; par ${par}`);
      SEATS.forEach(s => console.log(`  ${s} ${show(b.hands[s])} (${hcp(b.hands[s])})`));
      console.log(`  NS ${SEATS.map(s => b.dd[s].N + '' + b.dd[s].S + b.dd[s].H + b.dd[s].D + b.dd[s].C).join(' ')} (NT S H D C tricks for N E S W)`);
      console.log(`  T1 new NS: ${auc(t1)} => ${contractText(t1.ct)} ${t1.score}`);
      console.log(`  T2 new EW: ${auc(t2)} => ${contractText(t2.ct)} ${t2.score}`);
    });
  }
})().catch(e => { console.error(e); process.exit(1); });
