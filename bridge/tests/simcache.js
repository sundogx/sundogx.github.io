// A disk cache for the slow, deterministic parts of the solver harnesses (tests/playsim.js, tests/ddacc.js): a robot
// playout or decision is a pure function of the code, the deal, the options and the random seed (the harnesses give
// the sampler no time budget), so it is saved and reused by later runs. The file is named by a hash of every file in
// js/ (and js/wasm/compiled.wasm) plus the harness itself, so any change to the code starts a new, empty cache.
// Typical gains: a run testing a new option (NEW=...) reuses the current settings' results of earlier runs (about half
// the solving), and a rerun with more boards reuses the boards already done.
// NOCACHE=1 switches it off. Files: <os.tmpdir()>/bridge-simcache-<harness>-<hash>.jsonl (safe to delete).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

function codeHash(files) {
  const h = crypto.createHash('md5'), js = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(js).filter(f => f.endsWith('.js')).sort()) h.update(f + '\0').update(fs.readFileSync(path.join(js, f)));
  h.update(fs.readFileSync(path.join(js, 'wasm', 'compiled.wasm')));
  for (const f of files) h.update(fs.readFileSync(f));
  return h.digest('hex').slice(0, 16);
}
// name: the harness ('playsim'); files: extra files whose content the results depend on (the harness's own file)
function openCache(name, files = []) {
  const off = { get: () => undefined, set: () => { }, hits: 0, file: null };
  if (process.env.NOCACHE) return off;
  let file;
  try { file = path.join(os.tmpdir(), `bridge-simcache-${name}-${codeHash(files)}.jsonl`); } catch (e) { return off; }
  const map = new Map();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { const [k, v] = JSON.parse(line); map.set(k, v); } catch (e) { /* a torn line: ignore it */ }
    }
  } catch (e) { /* no file yet */ }
  const c = {
    file, hits: 0,
    get: k => { const v = map.get(k); if (v !== undefined) c.hits++; return v; },
    set: (k, v) => { map.set(k, v); try { fs.appendFileSync(file, JSON.stringify([k, v]) + '\n'); } catch (e) { } },
  };
  return c;
}
// Exact double-dummy solves (a real deal's position, not sampled layouts), cached by the position alone: the file is
// named by a hash of compiled.wasm, js/ddplay.js and js/engine.js only (ddRun, ddPBN), so it stays valid while
// the robots' code changes. For tests/heurstim.js, tests/heurfit.js and the real-deal solves of tests/ddacc.js, whose
// positions mostly recur from run to run with the same seed. Returns solve wrapped: job -> Promise<{card: tricks}>.
function cachedSolve(solve) {
  if (process.env.NOCACHE) return solve;
  let file;
  try {
    const js = path.join(__dirname, '..', 'js'), h = crypto.createHash('md5');
    h.update(fs.readFileSync(path.join(js, 'wasm', 'compiled.wasm'))).update(fs.readFileSync(path.join(js, 'ddplay.js'))).update(fs.readFileSync(path.join(js, 'engine.js')));
    file = path.join(os.tmpdir(), `bridge-simcache-dd-${h.digest('hex').slice(0, 16)}.jsonl`);
  } catch (e) { return solve; }
  const map = new Map();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { const [k, v] = JSON.parse(line); map.set(k, v); } catch (e) { }
    }
  } catch (e) { }
  const f = async job => {
    const k = JSON.stringify([job.trump, job.first, job.trick, job.pbn, job.mover]);
    const v = map.get(k);
    if (v !== undefined) { f.hits++; return { ...v }; }
    const r = await solve(job);
    map.set(k, { ...r });
    try { fs.appendFileSync(file, JSON.stringify([k, r]) + '\n'); } catch (e) { }
    return r;
  };
  f.hits = 0;
  return f;
}
module.exports = { openCache, codeHash, cachedSolve };
