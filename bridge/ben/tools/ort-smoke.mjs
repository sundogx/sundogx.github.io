// Smoke test: load every model in ../models with the vendored onnxruntime-web (wasm, 1 thread)
// and run it on the first recorded input of the test vectors; prints the max abs difference to the
// outputs BEN's TensorFlow models gave. Usage: node bridge/ben/tools/ort-smoke.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ben = path.join(here, '..');
const ort = await import(path.join(ben, 'ort', 'ort.wasm.min.mjs'));
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = path.join(ben, 'ort') + '/';

const manifest = JSON.parse(readFileSync(path.join(ben, 'models', 'manifest.json'), 'utf8'));
const vecDir = path.join(ben, 'tests', 'vectors');
const deals = readdirSync(vecDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(vecDir, f), 'utf8')));

function dense({ shape, nz }) {
  const a = new Float32Array(shape.reduce((x, y) => x * y, 1));
  for (const [i, v] of nz) a[i] = v;
  return a;
}

let worst = 0;
for (const m of manifest.models) {
  const sess = await ort.InferenceSession.create(readFileSync(path.join(ben, 'models', m.file)));
  let n = 0, maxd = 0;
  for (const d of deals) for (const dec of d.decisions) for (const c of dec.nn) {
    if (c.model !== m.name || n >= 20) continue;
    const feeds = {};
    for (const [k, rows] of Object.entries(c.inputs)) {
      const r = rows[0];
      feeds[k] = new ort.Tensor('float32', dense(r), [1, ...r.shape]);
    }
    const out = await sess.run(feeds);
    for (const [k, rows] of Object.entries(c.outputs)) {
      const ref = rows[0].flat(Infinity);
      const name = k === 'card_last' ? 'card' : k;
      let got = Array.from(out[name].data);
      if (k === 'card_last') got = got.slice(got.length - ref.length);
      for (let i = 0; i < ref.length; i++) maxd = Math.max(maxd, Math.abs(ref[i] - got[i]));
    }
    n++;
  }
  worst = Math.max(worst, maxd);
  console.log(`${m.name.padEnd(12)} ${String(n).padStart(3)} calls  max |ort-web - BEN TF| = ${maxd.toExponential(2)}`);
}
console.log('worst', worst.toExponential(2));
