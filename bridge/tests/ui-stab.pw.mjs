// Round-16 stability checks in real Chrome (playwright-core, channel 'chrome'), page served from bridge/ with no service worker.
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/ui-stab.pw.mjs [--vp=phone|desktop] [--only=api,offline,cls]
// api:     a server that never answers: "Open a table" gives up after API_TIMEOUT_MS (15 s) with a toast and the button back;
//          a non-OK answer shows the server's own JSON error in the toast
// offline: first visit, no service worker, then offline: starting practice and playing (workers can't load their scripts)
//          raises no page errors / uncaught worker errors
// history: a practice table keeps its last 200 boards in memory; the open hand record still points at its board
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');
const A = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const phone = (A.vp || 'phone') === 'phone';
const ONLY = A.only ? A.only.split(',') : null, run = k => !ONLY || ONLY.includes(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
let offline = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
  // offline 'all': every request dropped (Chrome's offline emulation doesn't reach workers); 'imports': the workers' own
  // scripts load (as from the browser cache) but what they import doesn't, so importScripts throws inside them
  if (offline && !(offline === 'imports' && /(dds-worker|ben-worker)\.js$/.test(p))) { req.socket.destroy(); return; }
  if (p === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end("window.BRIDGE_API = '';"); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: !A.headed });
let fails = 0; const check = (ok, m) => { console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) fails++; };

async function newPage() {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { addEventListener('error', e => console.error('window error event: ' + (e.message || e.type) + ' @' + String(e.filename || '').slice(0, 60))); const W = window.Worker; window.__workers = 0; window.Worker = class extends W { constructor(...a) { super(...a); window.__workers++; } }; });
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(String(e.stack || e).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errs.push('console: ' + m.text()); });
  page.on('worker', w => w.on('console', m => { if (m.type() === 'error') page.errs.push('worker console: ' + m.text()); }));
  { const cdp = await ctx.newCDPSession(page); await cdp.send('Log.enable'); cdp.on('Log.entryAdded', e => { if (e.entry.source === 'worker' && e.entry.level === 'error') page.errs.push('worker: ' + e.entry.text.slice(0, 160)); }); }
  await page.goto(BASE); await sleep(600);
  page.tapIt = async (sel, opts = {}) => phone ? page.tap(sel, { timeout: 5000, ...opts }) : page.click(sel, { timeout: 5000, ...opts });
  return page;
}
const toasts = page => page.evaluate(() => [...document.querySelectorAll('.toast')].map(d => d.textContent));

if (run('api')) {
  const page = await newPage();
  await page.fill('#nameInput', 'Tester');
  // 1. never answers
  await page.route('**/api/tables', () => { /* hang */ });
  await page.tapIt('#createBtn');
  await sleep(500);
  check(await page.$eval('#createBtn', b => b.disabled), 'api hang: button disabled while waiting');
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById('createBtn').disabled, null, { timeout: 30000 }).catch(() => { });
  const waited = Date.now() - t0 + 500;
  check(!(await page.$eval('#createBtn', b => b.disabled)) && waited < 20000, `api hang: button back after ${(waited / 1000).toFixed(1)} s`);
  check((await toasts(page)).some(s => /Could not open the table/.test(s)), 'api hang: toast ' + JSON.stringify(await toasts(page)));
  // 2. a server error with a JSON message
  await page.unroute('**/api/tables');
  await sleep(3000);
  const msg = 'Could not open the table. Please try again.';
  await page.route('**/api/tables', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: msg }) }));
  await page.tapIt('#createBtn'); await sleep(400);
  check((await toasts(page)).includes(msg), 'api 503: server message shown ' + JSON.stringify(await toasts(page)));
  check(page.errs.length === 0, 'api: no page errors ' + JSON.stringify(page.errs));
  await page.context().close();
}

for (const mode of ['all', 'imports']) if (run('offline')) {
  const page = await newPage();
  offline = mode;
  await page.tapIt('#practiceBtn'); await sleep(1500);
  // pass, play the first legal card, look at the last trick and the finished board's record for 25 s
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const s = await page.evaluate(() => T && { phase: T.phase, turn: turnSeat(T), modal: !!document.querySelector('#modalRoot .modal') });
    if (s && s.phase === 'done') { await page.evaluate(() => { if (T.history.length) showRecord(T.history.length - 1); }).catch(() => { }); await sleep(800); await page.keyboard.press('Escape'); await page.evaluate(() => doAct('next')); }
    else if (s && (s.turn === 'S' || s.turn === 'N') && !s.modal) {
      if (s.phase === 'auction') { await page.tapIt('#bidArea [data-call="P"]').catch(() => { }); await sleep(100); await page.tapIt('[data-confirmcall]').catch(() => { }); }
      else { const c = await page.$('[data-play][data-seat]'); const bb = c && await c.boundingBox(); if (bb) await page.mouse.click(bb.x + 6, bb.y + 12).catch(() => { }); }
      if (s.phase === 'play' && !(await page.$eval('#lastTrickBtn', b => b.disabled))) { await page.click('#lastTrickBtn').catch(() => { }); await sleep(300); await page.keyboard.press('Escape'); }
    }
    await sleep(250);
  }
  offline = false;
  const n = await page.evaluate(() => [window.__workers, T.board, T.phase, turnSeat(T), T.auction.length, T.play.tricks.length, T.play.tricks.flatMap(t => t.cards).length]); console.log('     ' + JSON.stringify(n));
  check(page.errs.length === 0, `offline (${mode}) first visit, no service worker: ${n[0]} workers tried, ${n[1]} boards, no uncaught errors ` + JSON.stringify(page.errs.slice(0, 5)));
  await page.context().close();
}

if (run('history')) {
  const page = await newPage();
  await page.tapIt('#practiceBtn'); await sleep(1000);
  const r = await page.evaluate(() => {
    const t = T, b0 = t.history.length;
    for (let i = 0; i < 230; i++) { if (t.phase !== 'done') { t.contract = null; finishBoard(t, 0); } if (i === 150) openRecord = t.history.length - 1; startBoard(t); }
    const open = openRecord !== null ? t.history[openRecord].board : null, want = 150 + 1 + b0; openRecord = null;
    return { len: t.history.length, last: t.history[t.history.length - 1].board, board: t.board, open, want };
  });
  check(r.len === 200 && r.last === r.board - 1, `history: practice keeps the last 200 boards in memory (${r.len}, last board ${r.last}, now ${r.board})`);
  check(r.open === r.want, `history: the open hand record still shows its board after the trim (${r.open}, want ${r.want})`);
  check(page.errs.length === 0, 'history: no page errors ' + JSON.stringify(page.errs.slice(0, 3)));
  await page.context().close();
}

await browser.close(); server.close();
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
