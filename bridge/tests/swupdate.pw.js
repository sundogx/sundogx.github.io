// Service worker update test (real local HTTP server, persistent Chrome profile, service worker on).
// Serves version A, then B, C and D (CACHE renamed in sw.js, every JS file and index.html marked with its version,
// every response carrying an x-ver header) and checks what a page left open across an update, and the workers it
// starts, are served; that the page reloads itself only at a safe moment; and that practice survives.
// Needs playwright-core and Chrome:  NODE_PATH=<dir with playwright-core> node tests/swupdate.pw.js .
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const SRC = path.resolve(process.argv[2] || '.');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// lets the test ask a solver worker which version of each script it loaded, and of the solver binary
const PROBE = `\nself.addEventListener('message', e => { if (e.data && e.data.__probe) fetch('wasm/compiled.wasm').then(r => postMessage({ __probe: self.__V, wasm: r.headers.get('x-ver') })); });\n`;
function build(v) {
  const out = {};
  const walk = d => { for (const f of fs.readdirSync(path.join(SRC, d))) { const rel = d ? d + '/' + f : f; if (['ben', 'node_modules', 'tests', 'src', '.wrangler'].includes(rel)) continue; const st = fs.statSync(path.join(SRC, rel)); if (st.isDirectory()) walk(rel); else out[rel] = fs.readFileSync(path.join(SRC, rel)); } };
  walk('');
  for (const rel of Object.keys(out)) if (rel.endsWith('.js')) {
    let s = out[rel].toString();
    if (rel === 'sw.js') s = s.replace(/const CACHE = '[^']*'/, `const CACHE = 'bridge-v${v}'`);
    else s += `\n;(self.__V = self.__V || {})[${JSON.stringify(rel)}] = '${v}';\n` + (rel === 'js/dds-worker.js' ? PROBE : '');
    out[rel] = Buffer.from(s);
  }
  out['index.html'] = Buffer.from(out['index.html'].toString().replace('<title>Bridge</title>', `<title>Bridge</title><meta name="ver" content="${v}">`));
  return out;
}
const files = { A: build('A'), B: build('B'), C: build('C'), D: build('D') };
let ver = 'A', up = true;
const srv = http.createServer((req, res) => {
  if (!up) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/bridge\//, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const f = files[ver][p];
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'max-age=600', 'x-ver': ver }); res.end(f);
});
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// which version the page, a solver worker started now, a blob worker started now, the solver binary and the CSS are
async function probe(page) {
  return page.evaluate(async base => {
    const one = o => [...new Set(Object.values(o || {}))].join('') || '-';
    const w = new Worker('js/dds-worker.js');
    const wr = await new Promise(res => { w.onmessage = e => { if (e.data && e.data.__probe) res(e.data); }; w.postMessage({ __probe: 1 }); setTimeout(() => res({}), 8000); });
    w.terminate();
    const bsrc = `importScripts('${base}js/engine.js', '${base}js/ddplay.js'); fetch('${base}js/wasm/compiled.wasm').then(r => postMessage({ v: self.__V, wasm: r.headers.get('x-ver') }));`;
    const b = new Worker(URL.createObjectURL(new Blob([bsrc], { type: 'text/javascript' })));
    const br = await new Promise(res => { b.onmessage = e => res(e.data); setTimeout(() => res({}), 8000); });
    b.terminate();
    const css = (await fetch('style.css')).headers.get('x-ver');
    return { html: document.querySelector('meta[name=ver]').content, page: one(self.__V), worker: one(wr.__probe) + '/' + wr.wasm, blob: one(br.v) + '/' + br.wasm, css, caches: (await caches.keys()).filter(k => k.startsWith('bridge-v')).sort().join(',') };
  }, new URL('.', page.url()).href);
}
const allV = (r, v) => r.html === v && r.page === v && r.worker === v + '/' + v && r.blob === v + '/' + v && r.css === v;
async function playUntil(page, stop, ms = 120000) { // plays South (and dummy): Pass, then the first legal card
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(stopDone => {
      if (!T) return 'none';
      if (T.phase === 'done' && !stopDone) { doAct('next'); return 'next'; } // passed out before the play we want
      if (T.phase === 'done') return 'done';
      if (T.claim && T.claim.need && T.claim.need.includes(mySeat(T)) && !(T.claim.acc || {})[mySeat(T)]) doAct('respond', true); // a robot's claim
      else if (isMyTurn(T)) {
        const ts = turnSeat(T);
        if (T.phase === 'auction') doAct('call', 'P');
        else doAct('card', ts, legalPlays(T.hands, T.play, T.contract, ts)[0]);
      }
      return T.phase + ':' + T.play.tricks.reduce((n, t) => n + t.cards.length, 0);
    }, stop('done'));
    if (stop(s)) return s;
    if (process.env.DBG) console.log(s);
    await sleep(150);
  }
  return 'timeout';
}
const deploy = async (page, v) => { ver = v; await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update())); };
(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}/bridge/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'swu')), { channel: 'chrome', headless: true });
  await ctx.addInitScript(() => { if (!localStorage.getItem('bt:me')) { localStorage.setItem('bridge-prefs', JSON.stringify({ speed: 'fast' })); localStorage.setItem('bt:me', JSON.stringify({ name: 'Tester', secret: 'sekret-123456' })); } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errs = [];
  const watch = p => { p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|api\//.test(m.text())) errs.push(m.text()); }); };
  watch(page);

  // ---- first visit: the page comes from the network, the service worker installs and takes over
  await page.goto(base); await page.evaluate(() => navigator.serviceWorker.ready); await sleep(500);
  let r = await probe(page);
  console.log('first visit       ', JSON.stringify(r));
  check(allV(r, 'A') && await page.evaluate(() => !!navigator.serviceWorker.controller), 'first visit: all A, controlled');

  // ---- practice, mid-board, when version B is deployed
  await page.click('#practiceBtn');
  let s = await playUntil(page, s => s.startsWith('play:') && +s.split(':')[1] >= 5);
  const board0 = await page.evaluate(() => T.board);
  check(s.startsWith('play:'), `practice mid-board (${s}, board ${board0})`);
  await page.evaluate(() => { window.__same = 1; });
  await deploy(page, 'B'); await sleep(2500);
  check(await page.evaluate(() => swUpdate === true), 'page knows the update is ready');
  check(await page.evaluate(() => window.__same === 1), 'no reload mid-board');
  r = await probe(page);
  console.log('B deployed, A open', JSON.stringify(r));
  check(allV(r, 'A'), 'page open across the update: page, new solver worker, blob worker, wasm, css all A');
  check(r.caches === 'bridge-vA,bridge-vB', 'old copy kept while the A page is open');
  check(!(await page.$('.toast.update')), 'no toast');

  // ---- the board finishes: the result stays up, no reload; a window open blocks the reload at Next
  s = await playUntil(page, s => s === 'done');
  check(s === 'done', 'board finished');
  await sleep(2500);
  check(await page.evaluate(() => window.__same === 1 && T.phase === 'done'), 'no reload while the finished board is shown');
  r = await probe(page);
  check(allV(r, 'A'), 'still all A after the board');
  await page.evaluate(() => { showSettings(); doAct('next'); });
  await sleep(1500);
  check(await page.evaluate(() => window.__same === 1), 'Next with a window open: no reload (the next board is dealt on this version)');
  await page.evaluate(() => { closeModal(); if (T.phase !== 'done') { window.__dealt = 1; } });
  if (await page.evaluate(() => window.__dealt === 1)) { // it dealt in place: finish that board too
    s = await playUntil(page, s => s === 'done');
  }
  const before = await page.evaluate(() => ({ board: T.board, hist: T.history.length, phase: T.phase, next: !!document.querySelector('#tableView [data-next]'), modal: !!document.getElementById('modalRoot').firstChild }));
  console.log('before Next       ', JSON.stringify(before));
  // Next: the page saves, reloads (all B) and deals the next board
  await page.click('#tableView [data-next]');
  await page.waitForFunction(() => !window.__same && typeof T !== 'undefined' && T && T.local, null, { timeout: 15000 });
  await sleep(800);
  const after = await page.evaluate(() => ({ board: T.board, phase: T.phase, hist: T.history.length, view: !document.getElementById('tableView').classList.contains('hidden') }));
  console.log('after Next        ', JSON.stringify(before), '->', JSON.stringify(after));
  check(after.view && after.board === before.board + 1 && after.hist === before.hist && (after.phase === 'auction' || after.phase === 'play'), 'reloaded into the practice table, next board dealt, history kept');
  r = await probe(page);
  console.log('after reload      ', JSON.stringify(r));
  check(allV(r, 'B'), 'after the safe-moment reload: all B');
  await sleep(10500); // workers started by the old page are given a few seconds' grace (they are listed once loaded)
  await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'hello' })); await sleep(500);
  check((await probe(page)).caches === 'bridge-vB', 'old copy deleted once no page uses it');

  // ---- home screen: C deployed while a window is open, then while text is typed: waits, then reloads
  await page.evaluate(() => leaveTable()); await sleep(500);
  await page.evaluate(() => { window.__same = 2; showOptions(); });
  await deploy(page, 'C'); await sleep(3000);
  check(await page.evaluate(() => window.__same === 2 && swUpdate), 'home + window open: no reload yet');
  r = await probe(page);
  check(allV(r, 'B'), 'still all B before the reload');
  await page.evaluate(() => closeModal());
  await page.fill('#tableName', 'half typed'); await page.evaluate(() => document.activeElement.blur()); await sleep(2500);
  check(await page.evaluate(() => window.__same === 2), 'home + unsent text in a box: no reload');
  await page.fill('#tableName', ''); await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !window.__same, null, { timeout: 8000 }).catch(() => { });
  await sleep(800);
  r = await probe(page);
  console.log('home, after reload', JSON.stringify(r));
  check(allV(r, 'C') && await page.evaluate(() => !document.getElementById('home').classList.contains('hidden')), 'home: reloaded by itself, all C, on the home screen');
  check(await page.evaluate(() => /Continue practice/.test(document.getElementById('practiceBtn').textContent)), 'practice still saved');

  // ---- offline: the app opens from the saved copy, one version
  up = false;
  await page.reload(); await sleep(1000);
  r = await probe(page);
  console.log('offline           ', JSON.stringify(r));
  check(allV(r, 'C'), 'offline: opens, all C');
  await page.click('#practiceBtn'); await sleep(800);
  check(await page.evaluate(() => !!(T && T.local && T.hands)), 'offline: practice continues');
  up = true;

  // ---- two tabs: one mid-board, the other on home; D deployed. The home tab reloads; the board tab stays on C
  await page.evaluate(() => goHome());
  const p2 = await ctx.newPage(); watch(p2);
  await p2.goto(base); await sleep(800);
  await p2.click('#practiceBtn');
  await playUntil(p2, s => s.startsWith('play:') && +s.split(':')[1] >= 2);
  await p2.evaluate(() => { window.__same = 3; });
  await page.evaluate(() => { window.__same = 4; });
  await deploy(page, 'D');
  await page.waitForFunction(() => !window.__same, null, { timeout: 10000 }).catch(() => { });
  await sleep(800);
  const r1 = await probe(page), r2 = await probe(p2);
  console.log('tab 1 (home)      ', JSON.stringify(r1));
  console.log('tab 2 (mid-board) ', JSON.stringify(r2));
  check(allV(r1, 'D'), 'tab 1: reloaded, all D');
  check(await p2.evaluate(() => window.__same === 3), 'tab 2: not reloaded mid-board');
  check(r2.html === 'C' && r2.page === 'C' && r2.worker === 'C/C' && r2.css === 'C', 'tab 2: page and solver worker still C');
  console.log('     tab 2 blob worker (with a D page open too its page cannot be told, so it gets D):', r2.blob);
  check(r2.caches === 'bridge-vC,bridge-vD', 'both copies kept');
  await p2.close(); await sleep(10500);
  await page.reload(); await sleep(800);
  check((await probe(page)).caches === 'bridge-vD', 'C copy deleted after tab 2 closed');

  check(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 5)));
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await ctx.close(); srv.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
