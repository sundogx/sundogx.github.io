// A phone that goes to sleep mid-board, with the real page (js/net.js) in Chrome: the page's script is paused (no timers,
// no pings, its connection left open), the server counts the silent connection as gone and closes it, a robot stands in,
// and when the page wakes up it reconnects by itself and takes the seat back.
//   npx wrangler dev --port 8832 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:30000
//   NODE_PATH=<dir with playwright-core> node tests/online-sleep.pw.mjs http://localhost:8832/
// (TEST_STALE_MS must be above the page's 25 s ping interval; about a minute.)
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');
const BASE = (process.argv[2] || 'http://localhost:8832/').replace(/\/?$/, '/');
const WS = BASE.replace(/^http/, 'ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, m) => { console.log((ok ? 'ok   ' : 'FAIL ') + m); if (!ok) fails++; };
const until = async (cond, ms, step = 200) => { for (let i = 0; i < ms / step; i++) { if (await cond()) return true; await sleep(step); } return !!(await cond()); };

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'slp')), { channel: 'chrome', headless: true });
await ctx.route('**/config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "window.BRIDGE_API = '';" }));
await ctx.addInitScript(() => { if (!localStorage.getItem('bt:me')) localStorage.setItem('bt:me', JSON.stringify({ name: 'Sleepy', secret: 'sekret-sleepy-0123456789' })); });
const page = ctx.pages()[0] || await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const frames = []; page.on('websocket', w => w.on('framesent', d => { if (process.env.DEBUG) frames.push([Date.now(), String(d.payload).slice(0, 30)]); }));
await page.goto(BASE); await sleep(1000);
await page.click('#createBtn');
await page.waitForFunction(() => T && !T.local && Net.gotState, null, { timeout: 15000 });
if (!(await page.evaluate(() => mySeat(T)))) { await page.evaluate(() => doAct('sit', 'S')); await sleep(800); }
const code = await page.evaluate(() => T.id);
await page.evaluate(() => doAct('settings', { friends: false })); await sleep(300);

// a friend at North, in Node, who keeps pinging and watches the table
const f = { st: null, ws: new WebSocket(`${WS}api/table/${code}/ws`) };
f.ws.onmessage = e => { if (e.data !== 'pong') { const m = JSON.parse(e.data); if (m.type === 'state') f.st = m.t; } };
await new Promise(r => f.ws.onopen = r);
f.ws.send(JSON.stringify({ type: 'hello', secret: 'friend-of-sleepy-0123456789', name: 'Friend' }));
setInterval(() => f.ws.readyState === 1 && f.ws.send('ping'), 1000).unref();
const fact = (n, ...args) => f.ws.send(JSON.stringify({ type: 'act', name: n, args }));
await sleep(500); fact('sit', 'N'); await sleep(400);
for (const s of ['E', 'W']) { await page.evaluate(s => doAct('robot', s), s); await sleep(300); }
await until(() => f.st && f.st.phase === 'auction', 10000);
// pass for the friend whenever it is North's turn, until the table waits for the page (South)
const turn = t => { if (t.phase !== 'auction') return null; const o = ['N', 'E', 'S', 'W'], d = o.indexOf(t.dealer); return o[(d + t.auction.length) % 4]; };
const waiting = await until(() => { const t = f.st; if (turn(t) === 'N') fact('call', 'P'); return turn(t) === 'S'; }, 20000);
check(waiting, 'the table waits for the page (South) in the auction');

// the phone sleeps
const cdp = await ctx.newCDPSession(page);
// (Page.setWebLifecycleState 'frozen' keeps timers running in headless Chrome; pausing the script thread stops them like a sleeping phone)
await cdp.send('Debugger.enable'); await cdp.send('Debugger.pause');
const t0 = Date.now();
const subbed = await until(() => f.st.subs && f.st.subs.S, 90000, 500);
if (process.env.DEBUG) console.log(JSON.stringify(frames.filter(x => x[0] > t0 - 30000).map(x => [x[0] - t0, x[1]])), JSON.stringify(f.st.away));
check(subbed, `a robot stands in for the sleeping page (${Math.round((Date.now() - t0) / 1000)} s)`);
await until(() => f.st.auction.some(x => x.by === 'S') || f.st.phase !== 'auction', 10000);
check(f.st.auction.some(x => x.by === 'S') || f.st.phase !== 'auction', '... and calls for South');

// the phone wakes up: the page notices its connection was closed, reconnects and takes over
await cdp.send('Debugger.resume'); await cdp.send('Debugger.disable');
const t1 = Date.now();
const back = await until(() => !(f.st.subs && f.st.subs.S) && !(f.st.away && f.st.away.S), 30000, 250);
check(back, `the page reconnects by itself and takes the seat back (${Math.round((Date.now() - t1) / 100) / 10} s after waking)`);
const pv = await page.evaluate(() => ({ seat: mySeat(T), conn: (document.getElementById('connState') || {}).textContent || '', open: Net.ws && Net.ws.readyState }));
check(pv.seat === 'S' && pv.open === 1, 'the page shows its seat with an open connection ' + JSON.stringify(pv));
check(!errs.length, 'no page errors ' + errs.slice(0, 2).join(' | '));
await ctx.close();
process.exit(fails ? 1 : 0);
