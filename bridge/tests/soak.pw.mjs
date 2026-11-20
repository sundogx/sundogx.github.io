// UI soak / fuzz for the practice screens, in real Chrome (playwright-core, channel 'chrome').
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/soak.pw.mjs [options]
//   --mode=practice|daily|bp|lt|explorer|flash|mini|rubber|replay|mix   (default mix: hops between them)
//   --vp=phone|desktop   phone = 390x844 touch (taps), desktop = 1280x800 (clicks)
//   --secs=120 --seed=1 --cpu=4 (CPU throttle) --chaos=1 (reloads, offline, rotation, back/forward, hidden tab)
//   --storage=ok|off|full   off: localStorage throws on access; full: every setItem throws QuotaExceededError
//   --headed  --shots=<dir> (screenshots of stuck screens)
// The page is served from bridge/ by a tiny local HTTP server (service worker blocked, config.js -> no server).
// It reports page errors, console errors, unhandled rejections, layout shifts (CLS without recent input),
// screens that stop making progress, listener growth on window/document (duplicate handlers) and state checks
// (T vs. the screen). Exit code 1 if anything was found.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const { chromium } = require('playwright-core');

const A = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const MODE = A.mode || 'mix', VP = A.vp || 'phone', SECS = +(A.secs || 120), CPU = +(A.cpu || 4), CHAOS = A.chaos !== '0';
const STORAGE = A.storage || 'ok', SHOTS = A.shots || '';
let seed = +(A.seed || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- static server for bridge/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
  if (p === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end("window.BRIDGE_API = '';"); }
  if (p.startsWith('/api/')) { res.writeHead(503); return res.end('no server in soak'); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/`;

// --- instrumentation, injected before the page's scripts
const INIT = ({ storage }) => {
  const S = window.__soak = { errs: [], cls: 0, shifts: [], listeners: { window: 0, document: 0 }, byType: {}, lastInput: 0 };
  addEventListener('error', e => S.errs.push('error: ' + (e.message || e.type) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', e => S.errs.push('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opt) {
    if (this === window) S.listeners.window++; else if (this === document) { S.listeners.document++; S.byType[type] = (S.byType[type] || 0) + 1; }
    if (opt && opt.once && (this === window || this === document)) { const f0 = fn; const self = this; fn = function (e) { if (self === document) { S.listeners.document--; S.byType[type]--; } else S.listeners.window--; return f0.call(this, e); }; }
    return add.call(this, type, fn, opt);
  };
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function (type, fn, opt) {
    if (this === window) S.listeners.window--; else if (this === document) { S.listeners.document--; S.byType[type] = (S.byType[type] || 0) - 1; }
    return rem.call(this, type, fn, opt);
  };
  for (const ty of ['pointerdown', 'click', 'keydown']) addEventListener(ty, () => { S.lastInput = performance.now(); }, true);
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput && e.value > 0.001) { S.cls += e.value; S.shifts.push([Math.round(e.startTime - S.lastInput), +e.value.toFixed(4), (e.sources || []).map(s => s.node && (s.node.id || s.node.className || s.node.nodeName)).join(',').slice(0, 120), (e.sources || []).map(s => s.previousRect && `${s.previousRect.y | 0}->${s.currentRect.y | 0}`).join(' ').slice(0, 80)]); } })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) { }
  if (storage === 'off') {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  } else if (storage === 'full') {
    Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
  }
};

const browser = await chromium.launch({ channel: 'chrome', headless: !A.headed });
const phone = VP === 'phone';
const ctx = await browser.newContext({
  viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 3 : 1, serviceWorkers: 'block',
});
await ctx.addInitScript(INIT, { storage: STORAGE });
const page = await ctx.newPage();
const found = new Map(); // message -> {n, first context}
let lastAction = '';
const report = (kind, msg) => {
  const k = kind + ': ' + String(msg).split('\n').slice(0, 3).join(' | ').slice(0, 300);
  const f = found.get(k); if (f) f.n++; else { found.set(k, { n: 1, after: lastAction }); console.log('FOUND', k, '\n      after:', lastAction); }
};
page.on('pageerror', e => report('pageerror', e.stack || e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|503|404|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) report('console.error', m.text()); });
page.on('crash', () => report('crash', 'page crashed'));
let cdp = await ctx.newCDPSession(page);
const throttle = async () => { try { await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); } catch (e) { } };
await throttle();
await page.goto(BASE); await sleep(800);

// --- what can be tapped now
const SKIP = '#createBtn,#joinCodeBtn,#otherDeviceBtn,#inviteBtn,[data-export],a[href^="http"],#benChk,[data-ben],#refreshBtn,#saveNameBtn,#leaveBtn';
const candidates = () => page.evaluate(SKIP => {
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.pointerEvents === 'none') return false; if (el.closest('[inert]')) return false; const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)); const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h) || h.contains(el)); };
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll('[data-soak]')) el.removeAttribute('data-soak');
  for (const el of document.querySelectorAll('button, [role=button], input[type=checkbox], input[type=radio], select, .card[data-play], [data-call], [data-level], [data-strain], [data-tab], summary')) {
    if (el.disabled || el.matches(SKIP) || el.closest(SKIP)) continue;
    if (!vis(el)) continue;
    const id = 'sk' + (i++); el.setAttribute('data-soak', id);
    const w = el.matches('.card[data-play].legal, [data-confirmcall], [data-call], [data-strain], [data-level]') ? 6 : el.matches('.modal *') ? 2 : 1;
    out.push({ id, w, tag: el.tagName, sel: el.tagName === 'SELECT', label: (el.id ? '#' + el.id + ' ' : '') + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) });
  }
  return out;
}, SKIP).catch(() => []);
const wpick = c => { const tot = c.reduce((s, x) => s + x.w, 0); let r = rnd() * tot; for (const x of c) { r -= x.w; if (r <= 0) return x; } return c[c.length - 1]; };

// --- state signature for stuck detection and consistency checks
const sig = () => page.evaluate(() => {
  const vis = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden') && e.offsetParent !== null; };
  const screens = [...document.querySelectorAll('main > section, main > div')].filter(e => !e.classList.contains('hidden') && e.offsetHeight > 0).map(e => e.id);
  let t = null;
  try { if (typeof T !== 'undefined' && T && T.auction) t = { phase: T.phase, board: T.board, calls: T.auction.length, cards: T.play ? T.play.tricks.reduce((n, x) => n + x.cards.length, 0) : 0, turn: typeof turnSeat === 'function' ? turnSeat(T) : '', me: mySeat(T) }; } catch (e) { t = { err: String(e) }; }
  const modals = document.querySelectorAll('#modalRoot .modal').length;
  const problems = [];
  if (screens.length === 0) problems.push('no screen visible');
  if (screens.length > 1) problems.push('two screens visible: ' + screens.join(','));
  if (vis('tableView') && !t) problems.push('table view shown with T null');
  if (t && t.phase === 'auction' && t.turn === t.me && t.me && !document.querySelector('#bidArea:not(.hidden):not(.idle)') && !document.querySelector('#modalRoot .modal') && vis('tableView')) problems.push('my turn to bid but bidding box idle');
  if (modals > 1) problems.push(modals + ' modals stacked');
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + innerWidth);
  return { key: JSON.stringify([screens, t, modals, document.body.innerText.length]), screens, t, problems, S: { errs: __soak.errs.splice(0), cls: __soak.cls, shifts: __soak.shifts.splice(0), listeners: { ...__soak.listeners }, byType: { ...__soak.byType } } };
}).catch(e => ({ key: 'eval-failed', problems: [], screens: [], S: { errs: [], cls: 0, shifts: [], listeners: {} } }));

const enter = {
  practice: '#practiceBtn', daily: '#dailyBtn', bp: '#bidPracticeBtn', lt: '#leadTrainerBtn', explorer: '#explorerBtn', flash: '#flashBtn',
  mini: '#practiceNew', rubber: '#practiceNew', replay: '#practiceBtn',
};
const tap = async (sel, n = 1) => {
  const loc = page.locator(sel).first();
  for (let i = 0; i < n; i++) { if (phone) await loc.tap({ timeout: 2000, force: true, noWaitAfter: true }); else await loc.click({ timeout: 2000, force: true, noWaitAfter: true }); }
};
const goHomeScreen = async () => { await page.evaluate(() => { try { if (typeof goHome === 'function') { if (typeof BP !== 'undefined' && BP.on) leaveBidPractice(); if (typeof LT !== 'undefined' && LT.on) leaveLeadTrainer(false); goHome(); } } catch (e) { __soak.errs.push('goHome threw ' + e); } }).catch(() => { }); };
const startMode = async m => {
  lastAction = 'enter ' + m;
  await goHomeScreen(); await sleep(200);
  try {
    await tap(enter[m]);
    if (m === 'mini' || m === 'rubber') { await sleep(300); await page.evaluate(m => { const r = document.querySelector(`#modalRoot input[value="${m === 'mini' ? 'mini' : 'rubber'}"]`) || [...document.querySelectorAll('#modalRoot input[type=radio]')].find(x => (x.closest('label') || {}).textContent?.toLowerCase().includes(m === 'mini' ? 'mini' : 'rubber')); if (r) r.click(); }, m); await tap('#pmStart').catch(() => { }); }
    if (m === 'replay') { await sleep(300); await page.evaluate(() => { const r = document.querySelector('[data-record]'); if (r) r.click(); }); }
  } catch (e) { report('enter', m + ': ' + e.message.split('\n')[0]); }
};

// --- chaos
const chaos = {
  async reload() { lastAction = 'reload'; await ctx.setOffline(false); /* the service worker is blocked here, so an offline reload would only show Chrome's error page */ await page.reload({ waitUntil: 'load' }).catch(e => report('reload', e.message)); await sleep(500); },
  async offline() { const on = rnd() < 0.5; lastAction = 'offline ' + on; await ctx.setOffline(on); },
  async rotate() { const v = page.viewportSize(); lastAction = 'rotate'; await page.setViewportSize({ width: v.height, height: v.width }); },
  async hide() {
    lastAction = 'background tab';
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    await sleep(300 + rnd() * 2000);
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); }).catch(() => { });
  },
  async backfwd() { lastAction = 'back/forward'; await ctx.setOffline(false); await page.goBack({ timeout: 4000 }).catch(() => { }); await sleep(300); await page.goForward({ timeout: 4000 }).catch(() => { }); if (!page.url().startsWith(BASE)) await page.goto(BASE); await sleep(300); },
  async dbl() { const c = await candidates(); if (!c.length) return; const x = wpick(c); lastAction = 'double-tap ' + x.label; await tap(`[data-soak="${x.id}"]`, 2).catch(() => { }); },
  async escape() { lastAction = 'Escape'; await page.keyboard.press('Escape'); },
  async randomTap() { const v = page.viewportSize(); const x = Math.floor(rnd() * v.width), y = Math.floor(rnd() * v.height); lastAction = `tap at ${x},${y}`; if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); },
};

// --- main loop
const modes = MODE === 'mix' ? Object.keys(enter) : [MODE];
let curMode = pick(modes); await startMode(curMode);
const t0 = Date.now(); let actions = 0, lastKey = '', lastChange = Date.now(), baseListeners = null, maxCls = 0, cls = 0;
let stuckReported = 0;
while (Date.now() - t0 < SECS * 1000) {
  const r = rnd();
  try {
    if (CHAOS && r < 0.04) await chaos[pick(Object.keys(chaos))]();
    else if (r < 0.07 && MODE === 'mix') { curMode = pick(modes); await startMode(curMode); }
    else {
      const c = await candidates();
      if (c.length) {
        const x = wpick(c); lastAction = (phone ? 'tap ' : 'click ') + x.label;
        if (x.sel) await page.evaluate(id => { const s = document.querySelector(`[data-soak="${id}"]`); if (s && s.options.length) { s.selectedIndex = Math.floor(Math.random() * s.options.length); s.dispatchEvent(new Event('change', { bubbles: true })); } }, x.id);
        else await tap(`[data-soak="${x.id}"]`);
      } else if (MODE !== 'mix') await startMode(curMode);
    }
  } catch (e) { if (!/Target closed|detached|timeout|navigat|not visible|not attached/i.test(e.message)) report('driver', e.message.split('\n').slice(0, 4).join(' | ')); }
  actions++;
  await sleep(40 + rnd() * 400);
  const s = await sig();
  for (const e of s.S.errs) report('page', e);
  for (const p of s.problems) report('state', p);
  for (const sh of s.S.shifts) if (sh[1] > 0.02) report('layout-shift', `${sh[1]} sources=${sh[2]} y ${sh[3]} (${sh[0]} ms after the last input)`);
  if (s.S.cls > cls) cls = s.S.cls;
  if (s.key !== lastKey) { lastKey = s.key; lastChange = Date.now(); }
  else if (Date.now() - lastChange > 25000 && Date.now() - stuckReported > 25000) {
    stuckReported = Date.now(); report('stuck', `no change for 25 s on ${s.screens.join(',')} T=${JSON.stringify(s.t)}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `stuck-${actions}.png`) }).catch(() => { }); }
    await startMode(curMode = pick(modes));
  }
  if (s.S.listeners.window !== undefined) {
    if (!baseListeners) baseListeners = { ...s.S.listeners, at: actions };
    // a reload resets the counters; anything that only goes up across a soak is a leak
  }
  if (actions % 50 === 0) console.log(`${Math.round((Date.now() - t0) / 1000)}s ${actions} actions, mode ${curMode}, listeners w${s.S.listeners.window} d${s.S.listeners.document}, CLS ${cls.toFixed(3)}`);
}
const fin = await sig();
console.log('document listeners by type:', JSON.stringify(fin.S.byType));
console.log(`done: ${actions} actions in ${SECS}s (${VP}, cpu x${CPU}, storage ${STORAGE}, chaos ${CHAOS}); listeners window ${fin.S.listeners.window} document ${fin.S.listeners.document}; CLS seen ${cls.toFixed(3)}`);
console.log(JSON.stringify([...found].map(([k, v]) => ({ k, ...v })), null, 1));
await browser.close(); server.close();
process.exit(found.size ? 1 : 0);
