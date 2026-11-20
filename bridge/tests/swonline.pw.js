// Online table + update reload: does the page keep its seat when it reloads itself between boards, and does it
// hold off during a board? Start the server with `npx wrangler dev --port 8873`, then
//   NODE_PATH=<dir with playwright-core> node tests/swonline.pw.js http://localhost:8873/
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, m) => { console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) fails++; };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'swo')), { channel: 'chrome', headless: true });
  await ctx.route('**/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "window.BRIDGE_API = '';" }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('bt:me')) localStorage.setItem('bt:me', JSON.stringify({ name: 'Tester', secret: 'sekret-online-0123456789' })); });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE); await sleep(1000);
  await page.click('#createBtn');
  await page.waitForFunction(() => T && !T.local && Net.gotState, null, { timeout: 15000 });
  if (!(await page.evaluate(() => mySeat(T)))) { await page.evaluate(() => doAct('sit', 'S')); await sleep(800); }
  const seat0 = await page.evaluate(() => ({ seat: mySeat(T), phase: T.phase, code: T.id }));
  console.log('seated', JSON.stringify(seat0));
  // between boards (waiting): the update reload happens, and the seat comes back
  await page.evaluate(() => { window.__same = 1; swUpdateReady(); });
  await page.waitForFunction(() => !window.__same, null, { timeout: 8000 }).catch(() => { });
  await page.waitForFunction(() => typeof T !== 'undefined' && T && !T.local && Net.gotState, null, { timeout: 15000 });
  await sleep(500);
  let st = await page.evaluate(() => ({ same: !!window.__same, seat: mySeat(T), away: T.away, phase: T.phase, code: T.id }));
  console.log('after reload', JSON.stringify(st));
  check(!st.same && st.seat === seat0.seat && st.code === seat0.code && !(st.away || {})[st.seat], 'waiting: reloaded by itself, same table, seat kept, not away');
  // fill with robots: a board starts; mid-board no reload
  for (const s of ['N', 'E', 'W']) { await page.evaluate(s => doAct('robot', s), s); await sleep(300); }
  await page.waitForFunction(() => T.phase === 'auction' || T.phase === 'play', null, { timeout: 10000 }).catch(() => { });
  await page.evaluate(() => { window.__same = 2; swUpdateReady(); });
  await sleep(3000);
  st = await page.evaluate(() => ({ same: window.__same, phase: T.phase }));
  check(st.same === 2 && (st.phase === 'auction' || st.phase === 'play'), 'online board in progress: no reload (' + st.phase + ')');
  // play the board out (Pass, first legal card)
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const s = await page.evaluate(() => {
      if (!T || T.phase === 'done') return 'done';
      if (T.claim && T.claim.need && T.claim.need.includes(mySeat(T)) && !(T.claim.acc || {})[mySeat(T)]) doAct('respond', true); else if (isMyTurn(T)) { const ts = turnSeat(T); if (T.phase === 'auction') doAct('call', 'P'); else doAct('card', ts, legalPlays(T.hands, T.play, T.contract, ts)[0]); }
      return T.phase;
    }).catch(() => 'reloaded');
    if (s === 'done' || s === 'reloaded') break;
    await sleep(300);
  }
  await page.waitForFunction(() => !window.__same, null, { timeout: 8000 }).catch(() => { });
  await page.waitForFunction(() => typeof T !== 'undefined' && T && !T.local && Net.gotState, null, { timeout: 15000 });
  await sleep(500);
  st = await page.evaluate(() => ({ same: !!window.__same, seat: mySeat(T), away: T.away, phase: T.phase, hist: T.history.length }));
  console.log('after board', JSON.stringify(st));
  check(!st.same && st.seat === seat0.seat && !(st.away || {})[st.seat] && st.phase === 'done' && st.hist >= 1, 'board done: reloaded by itself, seat kept, result still there');
  check(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  console.log(fails ? fails + ' FAILED' : 'all ok');
  await ctx.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
