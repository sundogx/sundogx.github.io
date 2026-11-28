// Deal setup (js/dealgen.js) in real Chrome, phone (390 px) and desktop (1280 px).
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/dealgen.pw.mjs [--shots=<dir>] [--headed]
// Opens the screen from the home page, picks a ready-made setup, gives South two cards, checks the status line,
// the sample deal and the robots' auction, a mistake in the setup, saving a setup (kept over a reload), the PBN
// download, "Play these deals" (the practice board and later boards fit the setup, Options shows "My deal setup"),
// Leave and Escape, no sideways scrolling, and no page errors.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');
const A = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
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
const shots = A.shots ? path.resolve(A.shots) : null; if (shots) fs.mkdirSync(shots, { recursive: true });

// does a hand (card list) fit 15-17 balanced with the two spade honours?
const fitsNT = (h) => { const v = { A: 4, K: 3, Q: 2, J: 1 }, p = h.reduce((t, c) => t + (v[c[1]] || 0), 0); const L = ['S', 'H', 'D', 'C'].map(s => h.filter(c => c[0] === s).length).sort((a, b) => b - a);
  return p >= 15 && p <= 17 && L[3] >= 2 && L[0] <= 5 && !(L[0] === 5 && L[1] === 4) && h.includes('SA') && h.includes('SK'); };

for (const vp of ['phone', 'desktop']) {
  const phone = vp === 'phone', W = phone ? 390 : 1280;
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('My 1NT') : d.accept());
  const tap = sel => phone ? page.tap(sel, { timeout: 5000 }) : page.click(sel, { timeout: 5000 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(BASE); await sleep(500);

  await tap('#dealGenBtn'); await sleep(400);
  check(await page.isVisible('#dealGen') && await page.isHidden('#home'), `${vp}: Deal setup opens from the home page`);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'dgPreset', `${vp}: focus on the Start from menu`);
  check(/Every deal fits/.test(await page.textContent('#dgStatus')), `${vp}: blank setup: every deal fits`);
  await page.selectOption('#dgPreset', 'nt'); await sleep(500);
  const s1 = await page.evaluate(() => ({ lo: document.querySelector('.dg-seat[data-seat="S"] [data-f="hlo"]').value, hi: document.querySelector('.dg-seat[data-seat="S"] [data-f="hhi"]').value, shape: document.querySelector('.dg-seat[data-seat="S"] [data-f="shape"]').value, sum: document.querySelector('[data-sum="S"]').textContent }));
  check(s1.lo === '15' && s1.hi === '17' && s1.shape === 'bal' && s1.sum === '15-17 HCP, balanced', `${vp}: preset fills South: ${JSON.stringify(s1)}`);
  // two given cards, typed
  await page.fill('.dg-seat[data-seat="S"] [data-f="cards"]', 'AK - - -'); await sleep(700);
  const st = await page.textContent('#dgStatus');
  check(/About 1 deal in [\d,]+ fits/.test(st), `${vp}: status: ${st}`);
  const sample = await page.evaluate(() => DG.sample && DG.sample.hands);
  check(sample && fitsNT(sample.S), `${vp}: the sample deal fits (South ${sample && sample.S.join(' ')})`);
  check(await page.$$eval('#dgSample .agrid .c', n => n.length) >= 4 && /robots bid it to/.test(await page.textContent('#dgSample')), `${vp}: the robots' auction for the sample`);
  // tap a call in the sample auction: the explanation bubble
  const call = await page.$('#dgSample .agrid [data-alert]');
  if (call) { await call.click(); await sleep(150); check(await page.isVisible('#explainPop'), `${vp}: a sample call explains itself`); await page.mouse.click(5, 5); }
  await tap('#dgAnother'); await sleep(300);
  check(fitsNT((await page.evaluate(() => DG.sample.hands)).S), `${vp}: Another deals another fitting sample`);
  check(await overflow() <= 0, `${vp}: no sideways scrolling (${await overflow()})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-dealgen.png`), fullPage: true });
  // a mistake: the same card for North
  await page.fill('.dg-seat[data-seat="N"] [data-f="cards"]', 'A - - -'); await sleep(700);
  check(/given to both North and South|given to both South and North/.test(await page.textContent('#dgStatus')) && await page.isDisabled('#dgPlay') && await page.$eval('#dgStatus', e => e.classList.contains('dg-err')), `${vp}: a card given twice is reported, Play is off`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-dealgen-error.png`) });
  await page.fill('.dg-seat[data-seat="N"] [data-f="cards"]', ''); await sleep(600);
  check(await page.isEnabled('#dgPlay'), `${vp}: fixed, Play is on again`);
  // save, reload, still there
  await tap('#dgSaveAs'); await sleep(200);
  check(await page.$eval('#dgSaved', e => e.value) === 'My 1NT', `${vp}: saved as "My 1NT"`);
  await page.reload(); await sleep(500);
  await tap('#dealGenBtn'); await sleep(400);
  check(await page.evaluate(() => DG.spec.seats.S.hcp.join() === '15,17' && DG.spec.seats.S.cards === 'AK - - -' && !!DG.saved['My 1NT']), `${vp}: the setup and the saved one are kept over a reload`);
  // PBN download
  await page.selectOption('#dgCount', '8');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), tap('#dgPBN')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  const deals = [...txt.matchAll(/\[Deal "N:([^"]+)"\]/g)].map(m => m[1].split(' ')[2]); // South's hand
  check(deals.length === 8 && /\[Board "8"\]/.test(txt), `${vp}: PBN file with 8 boards (${dl.suggestedFilename()})`);
  check(deals.every(h => { const [s, hh, d, c] = h.split('.'); return fitsNT([...s].map(r => 'S' + r).concat([...hh].map(r => 'H' + r), [...d].map(r => 'D' + r), [...c].map(r => 'C' + r))); }), `${vp}: every PBN board fits the setup`);
  // Escape leaves to the home page
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#home') && await page.isHidden('#dealGen'), `${vp}: Escape leaves`);
  // Play these deals
  await tap('#dealGenBtn'); await sleep(400);
  await tap('#dgPlay'); await sleep(1200);
  const t = await page.evaluate(() => ({ on: !!T && T.local, deals: Prefs.deals, S: T && T.hands.S, board: T && T.board, hidden: document.getElementById('dealGen').classList.contains('hidden') }));
  check(t.on && t.deals === 'gen' && t.hidden && fitsNT(t.S), `${vp}: Play these deals opens practice with a fitting board ${t.board} (${(t.S || []).join(' ')})`);
  const later = await page.evaluate(() => { let n = 0; for (let i = 0; i < 20; i++) { const h = practiceDeal(T); if (h) n += 1; window.__h = (window.__h || []).concat([h.S]); } return window.__h; });
  check(later.length === 20 && later.every(fitsNT), `${vp}: the next practice boards fit too (20 of 20)`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-dealgen-table.png`) });
  // Options shows the choice; from the table's More menu the screen opens and Leave goes back to the table
  await page.evaluate(() => document.querySelector('[data-options]').click()); await sleep(300);
  check(await page.$eval('#optDeals', e => e.value) === 'gen' && /My deal setup/.test(await page.$eval('#optDeals', e => e.selectedOptions[0].textContent)), `${vp}: Options > Deals in practice shows My deal setup`);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => document.querySelector('#moreBox [data-dealgen]').click()); await sleep(400);
  check(await page.isVisible('#dealGen') && await page.isHidden('#tableView'), `${vp}: opens from the table's More menu`);
  await tap('#dgLeave'); await sleep(300);
  check(await page.isVisible('#tableView') && await page.isHidden('#dealGen'), `${vp}: Leave goes back to the table`);
  // a practice table already open, its board untouched: Play these deals deals that board again with the setup
  await page.evaluate(() => { Prefs.deals = 'random'; savePrefs(); localStorage.removeItem('bt:practice'); });
  await page.evaluate(() => goHome()); await sleep(300);
  await page.evaluate(() => { DG.spec = dgPreset('twoc'); dgSave(); });
  await tap('#practiceBtn'); await sleep(800);
  const before = await page.evaluate(() => ({ board: T.board, S: T.hands.S.join(' ') }));
  await page.evaluate(() => goHome()); await sleep(300);
  await tap('#dealGenBtn'); await sleep(400);
  await tap('#dgPlay'); await sleep(800);
  const after = await page.evaluate(() => ({ board: T.board, S: T.hands.S, msg: T.chat.some(m => /dealt again with your deal setup/.test(m.text)) }));
  const hcpOf = h => h.reduce((t, c) => t + ({ A: 4, K: 3, Q: 2, J: 1 }[c[1]] || 0), 0);
  check(after.board === before.board && hcpOf(after.S) >= 22 && after.msg, `${vp}: an untouched practice board is dealt again (board ${before.board} -> ${after.board}, South ${hcpOf(after.S)} HCP)`);
  check(!errs.length, `${vp}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'dealgen.pw: all ok');
process.exitCode = fails ? 1 : 0;
