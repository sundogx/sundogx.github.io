// Web Worker: solves one strain of one deal double-dummy and reports each declarer's result as it is found.
// The solver is DDS (Bo Haglund and Soren Hein, Apache-2.0) compiled to WebAssembly, from the npm package
// @bridge-tools/dd 0.2.2 (MIT); see wasm/NOTICE.txt. Every solve gets a fresh instance of the compiled module:
// this build gives wrong answers if an instance is reused or re-initialised for another solve.
importScripts('wasm/compiled.js'); // defines create_dds_module

let modP = null;
const compiled = () => modP || (modP = fetch('wasm/compiled.wasm').then(r => { if (!r.ok) throw new Error('solver not found'); return r.arrayBuffer(); }).then(b => WebAssembly.compile(b)).catch(err => { modP = null; throw err; }));
async function fresh() {
  const mod = await compiled();
  const inst = await create_dds_module({ instantiateWasm: (imports, cb) => { WebAssembly.instantiate(mod, imports).then(i => cb(i, mod)); return {}; } });
  inst._dds_init();
  return inst;
}
const RANKS = '23456789TJQKA';
// One strain, all four declarers: declarer's tricks per seat (13 minus what the defender on lead can take).
async function strain(hands, st, report) {
  const hand = s => ['S', 'H', 'D', 'C'].map(su => hands[s].filter(c => c[0] === su)
    .sort((a, b) => RANKS.indexOf(b[1]) - RANKS.indexOf(a[1])).map(c => c[1]).join('') || '-').join('.');
  const deal = 'N:' + ['N', 'E', 'S', 'W'].map(hand).join(' ');
  const trump = { S: 0, H: 1, D: 2, C: 3, N: 4 }[st];
  for (const [ix, decl] of ['N', 'E', 'S', 'W'].entries()) {
    const inst = await fresh();
    const dp = inst.allocateUTF8(deal), op = inst._malloc(13 * 12 + 64);
    let best = -1;
    try {
      inst._dds_solve_board(trump, (ix + 1) & 3, 0, 0, 0, 0, 0, 0, dp, op); // the defender on lead
      for (let i = 0; i < 13; i++) {
        if (inst.getValue(op + i * 12, 'i32') <= 0) break;
        best = Math.max(best, inst.getValue(op + i * 12 + 8, 'i32'));
      }
    } finally { inst._free(op); inst._free(dp); }
    if (best < 0 || best > 13) throw new Error('DDS returned no result');
    report(decl, st, 13 - best);
  }
}
self.onmessage = async e => {
  const { k, h, st } = e.data;
  try { await strain(h, st, (decl, s2, v) => self.postMessage({ k, decl, st: s2, v })); }
  catch (err) { setTimeout(() => { throw err; }); return; } // reaches the page's worker.onerror
  self.postMessage({ k, st, done: true });
};
