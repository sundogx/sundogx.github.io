// npm test: runs the test scripts at the same time (each in its own process) and prints their output in this order,
// as if run one after another. Fails if any of them fails. tests/sim.js shows only its last line (the stats).
// Usage: node tests/all.js [jobs=cores]
const { spawn } = require('child_process');
const os = require('os'), path = require('path');
const TESTS = [
  ['test.js'], ['rubbertest.js'], ['minitest.js', '200'], ['ddtest.js', '200'], ['bidfuzz.js', '1000'], ['describe.js', '500'],
  ['rulesfuzz.js', '600'], ['sharetest.js'], ['sim.js', { last: true }],
];
const J = Math.max(1, +process.argv[2] || os.cpus().length);
const res = TESTS.map(() => null);
let next = 0, shown = 0, failed = 0;
function show() { // print finished tests in list order
  while (shown < TESTS.length && res[shown]) {
    const [args, r] = [TESTS[shown], res[shown]];
    let out = r.out;
    if (args.some(a => a && a.last)) { const lines = out.split('\n').filter(Boolean); out = lines.length ? lines[lines.length - 1] + '\n' : ''; }
    process.stdout.write(out);
    if (r.code !== 0) { failed++; console.error(`FAILED (exit ${r.code}): node tests/${args.filter(a => typeof a === 'string').join(' ')}`); }
    shown++;
  }
  if (shown === TESTS.length) process.exitCode = failed ? 1 : 0;
}
function start() {
  if (next >= TESTS.length) return;
  const i = next++, args = TESTS[i].filter(a => typeof a === 'string');
  const p = spawn(process.execPath, [path.join(__dirname, args[0]), ...args.slice(1)], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => { res[i] = { out, code: code === null ? 1 : code }; show(); start(); });
}
for (let k = 0; k < Math.min(J, TESTS.length); k++) start();
