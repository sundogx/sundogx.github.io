// The Worker must bundle: tests that load js/*.js never build src/worker.js, so a syntax error there would pass them.
// Bundles src/worker.js with wrangler's esbuild (no output kept) and fails on any error.
const { execFileSync } = require('child_process');
const path = require('path'), os = require('os'), fs = require('fs');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wbuild-'));
try {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'deploy', '--dry-run', '--outdir', out],
    { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('worker: builds ok');
} catch (e) {
  console.error(String(e.stdout || '') + String(e.stderr || '') + (e.stdout ? '' : String(e)));
  process.exitCode = 1;
} finally { fs.rmSync(out, { recursive: true, force: true }); }
