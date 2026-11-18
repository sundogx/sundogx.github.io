// Bidding match scored double-dummy: the current robot bidding (js/bidding.js) against the old one
// (tests/fixtures/oldbid.js). Every deal is bid at two tables: new system N-S and old E-W, then swapped.
// Each final contract is scored with the double-dummy tricks from DDS (js/wasm), so card play does not
// matter. Reports IMPs per board for the new system (± standard error) and both systems against par.
//
// Usage: node tests/bidddsim.js [boards=1000] [seed=1] [--worst=10] [--self] [--cats] [--vs=basebid]
//   --off=a,b  switch off features of the new system by name (BID_OFF keys in js/bidding.js)
//   --vs=name  the baseline system: tests/fixtures/<name>.js (default oldbid)
//   --worst=k  print the k boards the new system lost most on (hands and both auctions)
//   --self     also report each system in self-play against par
// Double-dummy tables are cached in the OS temp folder (bridge-dd-<seed>.json), so reruns are fast.
const { Worker, isMainThread, parentPort } = require('worker_threads');
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const RANKS_DD = '23456789TJQKA';
const wasmDir = path.join(__dirname, '..', 'js', 'wasm');

if (!isMainThread) { // solver worker: one deal at a time, a fresh DDS instance for every solve
  const create = require(path.join(wasmDir, 'compiled.js'));
  const modP = WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
  parentPort.on('message', async ({ id, hands }) => {
    const mod = await modP;
    const hs = s => ['S', 'H', 'D', 'C'].map(su => hands[s].filter(c => c[0] === su)
      .sort((a, b) => RANKS_DD.indexOf(b[1]) - RANKS_DD.indexOf(a[1])).map(c => c[1]).join('') || '-').join('.');
    const dealStr = 'N:' + SEATS.map(hs).join(' ');
    const table = { N: {}, E: {}, S: {}, W: {} };
    for (const st of ['N', 'S', 'H', 'D', 'C']) for (const [ix, decl] of SEATS.entries()) {
      const inst = await create({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(mod, imports).then(i => cb(i, mod)); return {}; } });
      inst._dds_init();
      const dp = inst.allocateUTF8(dealStr), op = inst._malloc(13 * 12 + 64);
      inst._dds_solve_board({ S: 0, H: 1, D: 2, C: 3, N: 4 }[st], (ix + 1) & 3, 0, 0, 0, 0, 0, 0, dp, op);
      let best = -1;
      for (let i = 0; i < 13; i++) { if (inst.getValue(op + i * 12, 'i32') <= 0) break; best = Math.max(best, inst.getValue(op + i * 12 + 8, 'i32')); }
      if (best < 0 || best > 13) throw new Error('DDS returned no result');
      table[decl][st] = 13 - best;
    }
    parentPort.postMessage({ id, table });
  });
  return;
}

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const N = +pos[0] || 1000, SEED = pos[1] || '1';
const WORST = +((flags.find(f => f.startsWith('--worst')) || '').split('=')[1] || 0);
const SELF = flags.includes('--self');
globalThis.BID_OFF = ((flags.find(f => f.startsWith('--off=')) || '--off=').slice(6)).split(',').filter(Boolean); // switch off named features of js/bidding.js
const VS = (flags.find(f => f.startsWith('--vs=')) || '--vs=oldbid').slice(5);
const NEW = require('../js/bidding.js'), OLD = require(`./fixtures/${VS}.js`);
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
    const nw = Math.max(1, Math.min(todo.length, os.cpus().length - 1));
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
  console.log(`New 2/1 system vs old system: ${match.text()} IMPs per board for the new system`);
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
    swings.sort((a, b) => a.imps - b.imps).slice(0, WORST).forEach(({ b, imps, t1, t2, par }) => {
      console.log(`\nBoard ${b.bn} dealer ${b.dealer} vul ${b.vul}: ${imps} IMPs; par ${par}`);
      SEATS.forEach(s => console.log(`  ${s} ${show(b.hands[s])} (${hcp(b.hands[s])})`));
      console.log(`  NS ${SEATS.map(s => b.dd[s].N + '' + b.dd[s].S + b.dd[s].H + b.dd[s].D + b.dd[s].C).join(' ')} (NT S H D C tricks for N E S W)`);
      console.log(`  T1 new NS: ${auc(t1)} => ${contractText(t1.ct)} ${t1.score}`);
      console.log(`  T2 new EW: ${auc(t2)} => ${contractText(t2.ct)} ${t2.score}`);
    });
  }
})().catch(e => { console.error(e); process.exit(1); });
