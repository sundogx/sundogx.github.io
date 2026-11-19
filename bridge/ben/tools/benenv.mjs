// Node setup for the BEN port: onnxruntime-web on ben/models, the app's DDS wasm, js/engine.js globals, ben-core.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), ben = path.join(here, '..'), root = path.join(ben, '..');
const require = createRequire(import.meta.url);
Object.assign(globalThis, require(path.join(root, 'js/engine.js')));
export const D = require(path.join(root, 'js/ddplay.js'));
Object.assign(globalThis, D);
export const B = require(path.join(ben, 'ben-core.js'));
export async function setup() {
  const ort = await import(path.join(ben, 'ort', 'ort.wasm.min.mjs'));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = path.join(ben, 'ort') + '/';
  const man = JSON.parse(readFileSync(path.join(ben, 'models', 'manifest.json'), 'utf8'));
  const sess = {};
  for (const m of man.models) sess[m.name] = await ort.InferenceSession.create(readFileSync(path.join(ben, 'models', m.file)));
  const stats = { calls: 0, rows: 0, ms: 0 };
  const nn = {
    stats,
    async run(name, feeds) {
      const f = {};
      for (const [k, v] of Object.entries(feeds)) f[k] = new ort.Tensor('float32', v.data, v.dims);
      const t = performance.now();
      const o = await sess[name].run(f);
      stats.calls++; stats.rows += feeds[Object.keys(feeds)[0]].dims[0]; stats.ms += performance.now() - t;
      const r = {}; for (const [k, v] of Object.entries(o)) { r[k] = Float32Array.from(v.data); if (v.dispose) v.dispose(); } return r;
    },
  };
  const create = require(path.join(root, 'js/wasm/compiled.js'));
  const inst = await D.ddInstance(create, await WebAssembly.compile(readFileSync(path.join(root, 'js/wasm/compiled.wasm'))));
  const dd = (trump, first, trick, pbn) => D.ddSolveRaw(inst, trump, first, trick, pbn);
  return { nn, dd, inst, ort, sess };
}
export const pbnHand = s => s.split('.').flatMap((x, i) => [...x].map(r => 'SHDC'[i] + r));
export const vcall = c => c === 'PASS' ? 'P' : c;
export const vdv = s => { const [d, v] = s.split(' '); return { dealer: d, vul: { None: 'None', 'N-S': 'NS', 'E-W': 'EW', Both: 'Both' }[v] }; };
export function dense({ shape, nz }) { const a = new Float32Array(shape.reduce((x, y) => x * y, 1)); for (const [i, v] of nz) a[i] = v; return a; }
