// Targeted stability checks (each one was a soak finding or a risk the soak points at), in real Chrome.
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/stab.pw.mjs [--vp=phone|desktop] [--cpu=4]
// 1. reload mid-board (inside the 400 ms save debounce) brings back the same board, auction and cards
// 2. a double tap on a card plays one card
// 3. rapid double tap on Next / Practice buttons opens one table, one board
// 4. storage blocked or full: practice, daily, explorer, flash cards (incl. Reset), lead and bidding practice run without errors
// 5. hidden tab / pagehide mid-board then reload restores
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');
const A = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const phone = (A.vp || 'phone') === 'phone', CPU = +(A.cpu || 4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
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

async function newPage(storage = 'ok') {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block' });
  await ctx.addInitScript(storage => {
    if (storage === 'off') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    if (storage === 'full') Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  }, storage);
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(String(e.stack || e).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errs.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(BASE); await sleep(600);
  page.tapIt = async (sel, opts = {}) => phone ? page.tap(sel, { timeout: 5000, ...opts }) : page.click(sel, { timeout: 5000, ...opts });
  return page;
}
const state = page => page.evaluate(() => T && { board: T.board, phase: T.phase, calls: T.auction.map(a => a.call).join(' '), cards: T.play.tricks.flatMap(t => t.cards.map(c => c.seat + c.card)).join(' '), turn: turnSeat(T), daily: T.daily || null });
const myTurn = page => page.evaluate(() => !!T && turnSeat(T) === 'S' && !document.querySelector('#modalRoot .modal'));
// cards overlap in the fan: tap the visible left edge of the first legal one
async function tapCard(page, n = 1) {
  const c = await page.$('[data-play][data-seat]'); if (!c) return false;
  const bb = await c.boundingBox(); if (!bb) return false;
  for (let i = 0; i < n; i++) { if (phone) await page.touchscreen.tap(bb.x + 6, bb.y + 12); else await page.mouse.click(bb.x + 6, bb.y + 12); if (n > 1) await sleep(60); }
  return true;
}
// bid Pass (or play a legal card) until the condition holds
async function playUntil(page, cond, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return true;
    const s = await state(page);
    if (s && s.phase === 'done') { await page.evaluate(() => doAct('next')); await sleep(300); continue; }
    if (await myTurn(page)) {
      if (s.phase === 'auction') { await page.tapIt('#bidArea [data-call="P"]').catch(() => { }); await sleep(120); await page.tapIt('[data-confirmcall]').catch(() => { }); }
      else await tapCard(page);
    }
    await sleep(150);
  }
  return !!(await cond());
}

// --- 1 + 5: reload mid-board restores the board exactly
{
  const page = await newPage();
  await page.tapIt('#practiceBtn'); await sleep(800);
  // get into the play with some cards played: pass out boards until a robot opens and the auction ends in a contract
  const ok = await playUntil(page, async () => { const s = await state(page); return s && s.phase === 'play' && s.cards.split(' ').length >= 3 && s.turn === 'S'; }, 90000);
  check(ok, 'practice: reached the play with South to play');
  for (const how of ['reload', 'hidden+reload']) {
    if (!(await myTurn(page))) await playUntil(page, () => myTurn(page), 20000);
    await tapCard(page);
    await sleep(30);
    const before = await state(page);
    if (how === 'hidden+reload') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.reload(); await sleep(600);
    const onHome = await page.evaluate(() => !document.getElementById('home').classList.contains('hidden'));
    if (onHome) { await page.tapIt('#practiceBtn'); await sleep(500); }
    const after = await state(page);
    check(after && before && after.board === before.board && after.calls === before.calls && after.cards.startsWith(before.cards), `practice: ${how} right after a card keeps board ${before && before.board}, auction and cards (${before && before.cards.split(' ').length} -> ${after && after.cards.split(' ').length})`);
  }
  check(!page.errs.length, 'practice reloads: no page errors ' + page.errs.join(' / '));
  // --- 2: double tap on one legal card plays one card for South
  await playUntil(page, async () => { const s = await state(page); return s.phase === 'play' && await myTurn(page); }, 40000);
  const b2 = await state(page);
  await tapCard(page, 2);
  await sleep(200);
  const a2 = await state(page);
  const nS = s => s.cards.split(' ').filter(x => x[0] === 'S' || x.startsWith('N') && false).length;
  const added = a2.cards.slice(b2.cards.length).trim().split(' ').filter(Boolean);
  check(added.filter(x => x[0] === b2.turn).length <= 1, `double tap on a card plays at most one card for ${b2.turn} (added: ${added.join(' ')})`);
  check(!page.errs.length, 'double tap: no page errors ' + page.errs.join(' / '));
  await page.context().close();
}

// --- 3: double tap on home buttons
for (const btn of ['#practiceBtn', '#dailyBtn', '#bidPracticeBtn', '#leadTrainerBtn', '#explorerBtn', '#flashBtn']) {
  const page = await newPage();
  const bb = await (await page.$(btn)).boundingBox();
  for (let i = 0; i < 2; i++) { if (phone) await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(50); }
  await sleep(1200);
  const r = await page.evaluate(() => ({ screens: [...document.querySelectorAll('main > section, main > div')].filter(e => !e.classList.contains('hidden') && e.offsetHeight > 0).map(e => e.id), modals: document.querySelectorAll('#modalRoot .modal').length }));
  check(r.screens.length === 1 && r.modals <= 1 && !page.errs.length, `double tap ${btn}: one screen (${r.screens}), ${r.modals} modal(s) ${page.errs.join(' / ')}`);
  await page.context().close();
}

// --- 4: storage blocked / full
for (const storage of ['off', 'full']) {
  const page = await newPage(storage);
  const tryMode = async (btn, act) => { await page.evaluate(() => { try { if (typeof BP !== 'undefined' && BP.on) leaveBidPractice(); if (typeof LT !== 'undefined' && LT.on) leaveLeadTrainer(false); goHome(); } catch (e) { } }); await sleep(200); await page.tapIt(btn).catch(e => page.errs.push(btn + ': ' + e.message.split('\n')[0])); await sleep(700); if (act) await act(); };
  await tryMode('#practiceBtn', () => playUntil(page, async () => { const s = await state(page); return s && s.phase === 'play'; }, 30000));
  await tryMode('#dailyBtn');
  await tryMode('#explorerBtn');
  await tryMode('#flashBtn', async () => { const a = await page.$('[data-fccall="P"]'); if (a) { await (phone ? a.tap() : a.click()).catch(() => { }); await sleep(300); } const r = await page.$('[data-fcreset]'); if (r) { await (phone ? r.tap() : r.click()); await sleep(200); } else page.errs.push('no flash-card Reset button'); });
  await tryMode('#leadTrainerBtn');
  await tryMode('#bidPracticeBtn');
  await page.reload(); await sleep(800);
  await tryMode('#practiceBtn');
  check(!page.errs.length, `storage ${storage}: no errors in practice, daily, explorer, flash cards (Reset), lead and bidding practice ${page.errs.join(' / ')}`);
  await page.context().close();
}

await browser.close(); server.close();
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
