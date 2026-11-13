// Checks the WebAssembly double-dummy solver (js/wasm) against a brute-force search on small endings.
// Usage: node tests/ddtest.js [games]   (default 200)
Object.assign(globalThis, require('../js/engine.js'));
const fs = require('fs'), path = require('path');
const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
const create = require(path.join(wasmDir, 'compiled.js'));
const RANKS = '23456789TJQKA';

function brute(hands, strain, leader) { // best tricks for N-S by exhaustive minimax
  function rec(h, leader, trick) {
    if (trick.length === 4) {
      const w = trickWinner({ cards: trick }, strain), r = sideOf(w) === 'NS' ? 1 : 0;
      return h[w].length === 0 ? r : r + rec(h, w, []);
    }
    const p = trick.length ? nextSeat(trick[trick.length - 1].seat) : leader;
    let cards = h[p];
    if (trick.length) { const led = trick[0].card[0], f = cards.filter(c => c[0] === led); if (f.length) cards = f; }
    let best = sideOf(p) === 'NS' ? -1 : 99;
    for (const c of cards) {
      const v = rec({ ...h, [p]: h[p].filter(x => x !== c) }, leader, [...trick, { seat: p, card: c }]);
      best = sideOf(p) === 'NS' ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  }
  return rec(hands, leader, []);
}

(async () => {
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
  const fresh = async () => { // one instance per solve: this build is wrong when an instance is reused
    const inst = await create({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(mod, imports).then(i => cb(i, mod)); return {}; } });
    inst._dds_init(); return inst;
  };
  async function dds(hands, strain, leader) { // N-S tricks
    const hs = s => ['S', 'H', 'D', 'C'].map(su => hands[s].filter(c => c[0] === su).sort((a, b) => RANKS.indexOf(b[1]) - RANKS.indexOf(a[1])).map(c => c[1]).join('') || '-').join('.');
    const inst = await fresh();
    const dp = inst.allocateUTF8('N:' + SEATS.map(hs).join(' ')), op = inst._malloc(13 * 12 + 64);
    const ix = SEATS.indexOf(leader);
    inst._dds_solve_board({ S: 0, H: 1, D: 2, C: 3, N: 4 }[strain], ix, 0, 0, 0, 0, 0, 0, dp, op);
    let best = -1;
    for (let i = 0; i < 13; i++) { if (inst.getValue(op + i * 12, 'i32') <= 0) break; best = Math.max(best, inst.getValue(op + i * 12 + 8, 'i32')); }
    return sideOf(leader) === 'NS' ? best : hands.N.length - best;
  }
  let bad = 0; const games = +process.argv[2] || 200;
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3), full = deal(), all = SEATS.flatMap(s => full[s]).sort(() => Math.random() - .5), hands = {};
    SEATS.forEach((s, i) => hands[s] = all.slice(i * n, i * n + n));
    const strain = ['N', 'S', 'H', 'D', 'C'][g % 5], leader = SEATS[g % 4];
    const b = brute(hands, strain, leader), d = await dds(hands, strain, leader);
    if (b !== d) { bad++; if (bad < 4) console.log('mismatch', JSON.stringify(hands), strain, leader, 'brute', b, 'dds', d); }
  }
  console.log('endings', games, 'mismatches', bad);
  process.exit(bad ? 1 : 0);
})();
