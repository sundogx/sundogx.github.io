// Double-dummy cache shared by the bidding harnesses: the tables of the first N deals of seededRand('bidddsim-' + seed),
// in the OS temp folder (bridge-dd-<seed>.json), the same file and format tests/bidddsim.js writes.
// ensure(N, seed) returns the cache, solving any missing deals first (synchronously, in a child process with solver threads).
// CLI: node tests/fixtures/ddcache.js N seed [threads]
const { Worker, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const E = require('../../js/engine.js');
const wasmDir = path.join(__dirname, '..', '..', 'js', 'wasm');
const fileOf = seed => path.join(os.tmpdir(), `bridge-dd-${seed}.json`);
const key = h => E.SEATS.map(s => h[s].join('')).join('|');
const deals = (N, seed) => { const rand = E.seededRand('bidddsim-' + seed), out = []; for (let g = 0; g < N; g++) out.push(E.deal(rand)); return out; };
const load = seed => { try { return JSON.parse(fs.readFileSync(fileOf(seed), 'utf8')); } catch (e) { return {}; } };

function ensure(N, seed, threads) {
  let cache = load(seed);
  if (deals(N, seed).some(h => !cache[key(h)])) {
    cp.execFileSync(process.execPath, [__filename, String(N), String(seed), String(threads || '')], { stdio: ['ignore', 'inherit', 'inherit'] });
    cache = load(seed);
  }
  return cache;
}
module.exports = { ensure, key };

if (workerData === 'ddcache') { // solver worker: one deal at a time (js/ddplay.js ddTableRaw)
  const create = require(path.join(wasmDir, 'compiled.js')), D = require('../../js/ddplay.js');
  const instP = WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm'))).then(mod => D.ddInstance(create, mod));
  parentPort.on('message', async ({ id, hands }) => parentPort.postMessage({ id, table: D.ddTableRaw(await instP, D.ddPBN(hands)) }));
} else if (require.main === module) { // CLI
  const [N, seed, thr] = [+process.argv[2] || 1000, process.argv[3] || '1', +process.argv[4] || 0];
  const file = fileOf(seed), cache = load(seed);
  const save = () => fs.writeFileSync(file, JSON.stringify(Object.assign(load(seed), cache)));
  const todo = deals(N, seed).filter(h => !cache[key(h)]);
  if (todo.length) {
    const nw = Math.max(1, Math.min(todo.length, thr || os.cpus().length - 1));
    process.stderr.write(`solving ${todo.length} deals double-dummy on ${nw} threads...\n`);
    let next = 0, done = 0;
    new Promise((resolve, reject) => {
      const ws = [];
      for (let w = 0; w < nw; w++) {
        const wk = new Worker(__filename, { workerData: 'ddcache' }); ws.push(wk);
        const feed = () => { if (next < todo.length) { const i = next++; wk.postMessage({ id: i, hands: todo[i] }); } };
        wk.on('message', ({ id, table }) => {
          cache[key(todo[id])] = table; done++;
          if (done % 100 === 0) { process.stderr.write(`  ${done}/${todo.length}\n`); save(); }
          if (done === todo.length) { ws.forEach(x => x.terminate()); resolve(); } else feed();
        });
        wk.on('error', reject);
        feed();
      }
    }).then(save, e => { console.error(e); process.exit(1); });
  }
}
