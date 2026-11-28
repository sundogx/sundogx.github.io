// "Your mistakes" (js/drills.js) in real Chrome, phone (390 px) and desktop (1280 px).
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/drills.pw.mjs [--shots=<dir>] [--headed]
// Puts 12 boards played by the heuristic robots into History (as yours, sitting South), opens the screen from the home
// page, waits for the play review to find the costly cards, answers a problem wrongly and one rightly (checked against
// the solver's numbers on the page), the saved progress, N for the next problem, Hand record, Play on from here (a
// what-if practice table at that card), the More menu, Escape and Leave, no sideways scrolling, and no page errors.
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

// boards the heuristic robots bid and play (it gives away a trick now and then), saved in History as South's
const SEED = () => Stats.open().then(() => {
  const rand = seededRand('drills-pw');
  let n = 0;
  for (let b = 1; n < 12 && b < 200; b++) {
    const dealer = boardDealer(b), vul = boardVul(b), hands = deal(rand), auction = [];
    while (!auctionOver(auction)) { const s = auctionTurn(dealer, auction), r = botCall(hands[s], s, dealer, auction, vul); auction.push({ by: s, call: r.call }); }
    const contract = finalContract(auction);
    if (!contract || contract.declarer === 'N') continue; // South declares or defends
    const t = { phase: 'play', contract, hands, play: { tricks: [] }, auction, dealer, vul, seats: {} };
    for (let k = 0; k < 52; k++) { const s = playTurn(t.play, contract); let c; try { c = botPlayH(t, s); } catch (e) { c = null; } const L = legalPlays(hands, t.play, contract, s); applyPlay(t.play, contract, s, L.includes(c) ? c : L[0]); }
    const declTricks = tricksWon(t.play, contract).decl;
    const h = { board: b, dealer, vul, hands, auction, contract, tricks: t.play.tricks, declTricks, scoreNS: scoreNS(contract, declTricks, vul) };
    const r = { id: `p:pw:${b}:${hands.N.join('')}`, date: Date.now() - (12 - n) * 6e4, seat: 'S', mode: 'practice', table: 'Practice', h };
    r.role = statsRole(r); r.score = statsMine(r, h.scoreNS);
    Stats.list.push(r); Stats.keys.add(r.id); Stats.put(r); n++;
  }
  return n;
});

for (const vp of ['phone', 'desktop']) {
  const phone = vp === 'phone', W = phone ? 390 : 1280;
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e.stack || e).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  const tap = sel => phone ? page.tap(sel, { timeout: 5000 }) : page.click(sel, { timeout: 5000 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(BASE); await sleep(500);
  check(await page.isVisible('#drillsBtn'), `${vp}: "Your mistakes" on the home page`);
  await tap('#drillsBtn'); await sleep(400);
  check(await page.isVisible('#drills') && await page.isHidden('#home'), `${vp}: the screen opens`);
  check(/No mistakes found yet/.test(await page.textContent('#drInfo')), `${vp}: empty History: explains what will appear`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-empty.png`) });
  await tap('#drLeave'); await sleep(200);
  check(await page.isVisible('#home') && await page.isHidden('#drills'), `${vp}: Leave goes home`);

  const seeded = await page.evaluate(SEED);
  check(seeded === 12, `${vp}: 12 boards put in History`);
  const t0 = Date.now();
  await tap('#drillsBtn');
  await page.waitForSelector('#drTable .rk.play', { timeout: 60000 });
  const first = await page.evaluate(() => ({ n: drS().items.length, cur: DR.cur && DR.cur.k, kind: DR.cur && DR.cur.kind, prog: document.getElementById('drProg').textContent }));
  check(first.n > 0 && first.cur, `${vp}: first problem in ${Date.now() - t0} ms (${first.n} found so far, ${first.kind}; "${first.prog}")`);
  await page.waitForFunction(() => DR.sol, null, { timeout: 20000 });
  check(await page.evaluate(() => !!document.activeElement.closest('#drTable') && document.activeElement.matches('.rk.play')), `${vp}: focus on a playable card when the screen opens`);
  // the position: the mover's legal cards only, matching the record
  const pos = await page.evaluate(() => { const it = DR.cur, r = drRec(it.rec), p = drPosition(r.h, it.i); return { legal: p.legal.slice().sort().join(), shown: [...document.querySelectorAll('#drTable .rk.play')].map(b => b.dataset.play).sort().join(), played: it.card, best: Math.max(...p.legal.map(c => DR.sol[c])), tricks: DR.sol, base: p }; });
  check(pos.legal === pos.shown, `${vp}: the playable cards are the legal ones (${pos.shown})`);
  check(pos.tricks[pos.played] < pos.best, `${vp}: the card played at the table really cost a trick (${pos.tricks[pos.played]} < ${pos.best})`);
  check(await overflow() <= 0, `${vp}: no sideways scrolling (${await overflow()})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-problem.png`), fullPage: true });
  // a wrong answer: the card played at the table
  await tap(`#drTable .rk.play[data-play="${pos.played}"]`);
  await page.waitForSelector('#drResult .dr-cards', { timeout: 10000 });
  const wrong = await page.evaluate(() => ({ txt: document.getElementById('drResult').textContent, st: drS().st, it: drS().items.find(x => x.k === DR.cur.k) }));
  check(/costs \d trick/.test(wrong.txt) && /At the table you played/.test(wrong.txt) && wrong.st.n === 1 && wrong.st.good === 0 && wrong.it.box === 0 && wrong.it.tries === 1, `${vp}: wrong answer: cost shown, graded (${wrong.txt.slice(0, 90)}…)`);
  check(await overflow() <= 0, `${vp}: no sideways scrolling with the answer (${await overflow()})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-answer.png`), fullPage: true });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bridge-dr')));
  check(saved && saved.st.n === 1 && saved.items.length >= 1, `${vp}: progress saved in localStorage`);
  // N: the next problem (another one), answered rightly
  const k1 = await page.evaluate(() => DR.cur.k);
  await page.keyboard.press('n');
  await page.waitForSelector('#drTable .rk.play', { timeout: 10000 });
  await page.waitForFunction(() => DR.sol, null, { timeout: 20000 });
  check(await page.evaluate(() => document.activeElement.matches('#drTable .rk.play')), `${vp}: focus on a playable card after N`);
  const best = await page.evaluate(() => { const p = drPosition(drRec(DR.cur.rec).h, DR.cur.i), m = Math.max(...p.legal.map(c => DR.sol[c])); return { k: DR.cur.k, card: p.legal.find(c => DR.sol[c] === m) }; });
  check(best.k !== k1 || first.n === 1, `${vp}: N shows another problem`);
  await tap(`#drTable .rk.play[data-play="${best.card}"]`);
  await page.waitForSelector('#drResult .dr-ok', { timeout: 10000 });
  const right = await page.evaluate(() => ({ st: drS().st, it: drS().items.find(x => x.k === DR.cur.k) }));
  check(right.st.good === 1 && right.st.streak === 1 && right.it.box === 1 && right.it.due > Date.now() + 3600e3, `${vp}: right answer: box 1, back in a day`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-right.png`), fullPage: true });
  // the scan finishes; kinds filter
  await page.waitForFunction(() => drToScan().length === 0, null, { timeout: 60000 });
  const tot = await page.evaluate(() => ({ n: drS().items.length, kinds: [...new Set(drS().items.map(x => x.kind))].join(), rv: Stats.list.filter(r => r.rv).length }));
  check(tot.n >= 3, `${vp}: all 12 boards checked: ${tot.n} problems (${tot.kinds}); leak finder reviews stored for ${tot.rv}`);
  // Hand record over the screen, Escape closes it and stays
  await tap('[data-drrec]'); await sleep(300);
  check(await page.isVisible('#modalRoot .modal'), `${vp}: Hand record opens`);
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#drills') && !(await page.$('#modalRoot .modal')), `${vp}: Escape closes the record, the screen stays`);
  // Play on from here
  await tap('[data-drplay]'); await sleep(800);
  const wi = await page.evaluate(() => ({ on: !!T && !!T.whatIf, phase: T && T.phase, hidden: document.getElementById('drills').classList.contains('hidden'), played: T && T.play.tricks.flatMap(t => t.cards).length }));
  check(wi.on && wi.phase === 'play' && wi.hidden, `${vp}: Play on from here opens a what-if table (${wi.played} cards played)`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-playon.png`) });
  // the table's More menu has it; Escape leaves to the home page
  check(await page.evaluate(() => { const b = document.getElementById('drMoreBtn'), l = document.getElementById('ltMoreBtn'); return !!b && !b.classList.contains('hidden') && b.previousElementSibling === l; }), `${vp}: in a practice table's More menu, after Lead practice`);
  await page.evaluate(() => document.getElementById('drMoreBtn').click()); await sleep(500);
  check(await page.isVisible('#drills') && await page.isHidden('#tableView'), `${vp}: opens from the More menu`);
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#home') && await page.isHidden('#drills'), `${vp}: Escape leaves`);
  // the kinds menu
  await tap('#drillsBtn'); await page.waitForSelector('#drTable .rk.play, #drInfo p', { timeout: 10000 });
  await page.selectOption('#drKind', 'lead'); await sleep(300);
  const lead = await page.evaluate(() => ({ kind: DR.cur ? DR.cur.kind : null, txt: document.getElementById('drInfo').textContent }));
  check(lead.kind === 'lead' || /No mistakes of this kind|All caught up|learned/.test(lead.txt), `${vp}: Opening leads only (${lead.kind || lead.txt.slice(0, 50)})`);
  await page.selectOption('#drKind', 'all'); await sleep(200);
  // review fix 1: the hand record's Play from here (any table opening) closes this screen and stops its work
  await page.evaluate(() => { DR.anyway = true; drNext(true); }); await page.waitForSelector('#drTable .rk.play', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#drTable .rk.play').click()); await page.waitForSelector('[data-drrec]', { timeout: 20000 });
  await tap('[data-drrec]'); await sleep(300);
  await tap('#replayBtn'); await sleep(300);
  await page.evaluate(() => document.querySelector('#replayBox [data-playfrom]').click()); await sleep(800);
  const gone = await page.evaluate(() => ({ table: !document.getElementById('tableView').classList.contains('hidden'), drills: !document.getElementById('drills').classList.contains('hidden'), on: DR.on, timer: DR.timer, w: !!DR.w, url: !!DR.url, scan: !!DR.scanRec, whatIf: !!(T && T.whatIf) }));
  check(gone.table && !gone.drills && !gone.on && !gone.timer && !gone.w && !gone.url && !gone.scan && gone.whatIf, `${vp}: Hand record > Play from here hides the screen, stops its scan and worker ${JSON.stringify(gone)}`);
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#tableView') && await page.isHidden('#home'), `${vp}: Escape then stays at the table`);
  check(!errs.length, `${vp}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'drills.pw: all ok');
process.exitCode = fails ? 1 : 0;
