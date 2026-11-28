// "Your mistakes" bidding problems (js/drills.js, kind 'bid') in real Chrome, phone (390 px) and desktop (1280 px).
//   NODE_PATH=<dir with node_modules/playwright-core> node tests/drillbid.pw.mjs [--shots=<dir>] [--headed]
// Puts 16 boards into History where you (South) sometimes made another call than the robots (the robots bid on after
// it), lets History's "Where the IMPs went" work out par, opens Your mistakes from its "Practise these" link (the
// Bidding kind), and checks a "What do you bid?" problem: your hand, the auction so far with a ? and every call
// explained, the bidding box with the legal calls only. It answers once with the call made at the table (wrong:
// graded, the robots' call and its meaning shown) and once with the robots' call (right: box 1, back in a day), and
// checks focus, Escape, no sideways scrolling and no page errors.
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

// boards bid by the robots, with South making a slip now and then (pass, or a bid near the robots' call); no play
// (the bidding check needs none), scored with the contract making exactly
const SEED = () => Stats.open().then(() => {
  const rand = seededRand('drillbid-pw');
  let n = 0;
  for (let b = 1; n < 16 && b < 400; b++) {
    const dealer = boardDealer(b), vul = boardVul(b), hands = deal(rand), auction = [];
    let slip = false;
    while (!auctionOver(auction)) {
      const s = auctionTurn(dealer, auction), r = botCall(hands[s], s, dealer, auction, vul);
      if (s === 'S' && !slip && rand() < 0.6) {
        const legal = legalCalls(dealer, auction), v = bidValue(r.call);
        const near = legal.filter(x => x !== r.call && (x === 'P' || (bidValue(x) >= 0 && v >= 0 && Math.abs(bidValue(x) - v) <= 5)));
        if (near.length) { auction.push({ by: s, call: near[Math.floor(rand() * near.length)] }); slip = true; continue; }
      }
      auction.push(r.alert ? { by: s, call: r.call, alert: r.alert } : { by: s, call: r.call });
    }
    if (!slip) continue;
    const contract = finalContract(auction);
    const declTricks = contract ? contract.level + 6 : null;
    const h = { board: b, dealer, vul, hands, auction, contract, tricks: [], declTricks, scoreNS: contract ? scoreNS(contract, declTricks, vul) : 0 };
    const r = { id: `p:bpw:${b}:${hands.N.join('')}`, date: Date.now() - (16 - n) * 6e4, seat: 'S', mode: 'practice', table: 'Practice', h };
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
  const seeded = await page.evaluate(SEED);
  check(seeded === 16, `${vp}: 16 boards with a call of yours unlike the robots' put in History`);
  // History: "Where the IMPs went" gets par for the boards, then offers "Practise these"
  await page.evaluate(() => Stats.show());
  await page.waitForSelector('#leakBox .leakdr[data-drkind="bid"]', { timeout: 60000 });
  check(true, `${vp}: "Where the IMPs went" has a "Practise these" link for the contracts`);
  if (shots) { await page.evaluate(() => document.querySelector('#leakBox').scrollIntoView()); await page.screenshot({ path: path.join(shots, `${W}-leaks-practise.png`) }); }
  const t0 = Date.now();
  await tap('#leakBox .leakdr[data-drkind="bid"]');
  await page.waitForSelector('#drTable .dr-bbox .bbox', { timeout: 60000 });
  const first = await page.evaluate(() => ({ kind: DR.kind, sel: document.getElementById('drKind').value, modal: !!document.querySelector('#modalRoot .modal'), n: drS().items.filter(x => x.kind === 'bid').length, cur: DR.cur && DR.cur.kind }));
  check(first.kind === 'bid' && first.sel === 'bid' && !first.modal && first.cur === 'bid', `${vp}: opens Your mistakes at Bidding, History closed; first problem in ${Date.now() - t0} ms (${first.n} found so far)`);
  check(await page.evaluate(() => document.activeElement.matches('#drTable .bbox button')), `${vp}: focus in the bidding box`);
  // the problem: hand, auction so far with '?', every earlier call explained by the system, legal calls only
  const pb = await page.evaluate(() => {
    const it = DR.cur, r = drRec(it.rec), h = r.h, before = h.auction.slice(0, it.i), legal = legalCalls(h.dealer, before);
    const grid = document.querySelector('#drAuction .agrid'), cells = [...grid.querySelectorAll('.c')];
    const enabledStrains = []; // every level: the strains it enables
    return {
      info: document.getElementById('drInfo').textContent, hand: document.querySelector('#drTable .bp-hand').textContent,
      q: cells[cells.length - 1].textContent === '?', calls: cells.length - 1 === before.length,
      expl: cells.filter(c => c.dataset.alert).length, bids: before.filter(a => a.call !== 'P').length,
      pass: !document.querySelector('[data-drcall="P"]').disabled, x: !document.querySelector('[data-drcall="X"]').disabled === legal.includes('X'),
      xx: !document.querySelector('[data-drcall="XX"]').disabled === legal.includes('XX'),
      minLv: [...document.querySelectorAll('[data-drlevel]')].filter(b => !b.disabled).map(b => +b.dataset.drlevel)[0],
      minLegal: Math.min(...legal.filter(c => bidValue(c) >= 0).map(c => +c[0])), card: it.card, rcall: it.rcall, loss: it.loss,
    };
  });
  check(/What do you bid\?/.test(pb.info) && /HCP/.test(pb.hand), `${vp}: "What do you bid?" with your hand (${pb.info.slice(0, 70)}…)`);
  check(pb.q && pb.calls, `${vp}: the auction so far ends in a ?`);
  check(pb.expl >= pb.bids, `${vp}: every bid so far can be tapped for its meaning (${pb.expl} explained, ${pb.bids} bids)`);
  check(pb.pass && pb.x && pb.xx && pb.minLv === pb.minLegal, `${vp}: the bidding box offers the legal calls only (lowest level ${pb.minLv})`);
  check(await overflow() <= 0, `${vp}: no sideways scrolling (${await overflow()})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-bid-problem.png`), fullPage: true });
  // tap a call in the auction: its explanation
  const ex = await page.$('#drAuction .agrid .c[data-alert]');
  if (ex) { await ex.click(); await sleep(200); check(await page.isVisible('#explainPop'), `${vp}: tapping a call explains it`); await page.evaluate(() => hideExplain()); }
  // a wrong answer: the call made at the table
  const callSel = c => c.length === 2 ? [`[data-drlevel="${c[0]}"]`, `[data-drcall="${c}"]`] : [`[data-drcall="${c}"]`];
  for (const s of callSel(pb.card)) { await tap(s); await sleep(80); }
  await page.waitForSelector('#drResult .dr-bcmp', { timeout: 10000 });
  const wrong = await page.evaluate(() => ({ txt: document.getElementById('drResult').textContent, st: drS().st, it: drS().items.find(x => x.k === DR.cur.k), means: document.querySelector('#drResult .dr-bcmp tr.bp-diff td:nth-child(3)').textContent, focus: document.activeElement.matches('[data-drnext]') }));
  check(/The robots bid/.test(wrong.txt) && /worse double dummy/.test(wrong.txt) && /At the table you bid/.test(wrong.txt) && wrong.st.n === 1 && wrong.st.good === 0 && wrong.it.box === 0 && wrong.it.tries === 1, `${vp}: the table's call: wrong, graded (${wrong.txt.slice(0, 100)}…)`);
  check(pb.rcall === 'P' || wrong.means.length > 3, `${vp}: the robots' call is explained ("${wrong.means}")`);
  check(wrong.focus, `${vp}: focus on Next`);
  check(await overflow() <= 0, `${vp}: no sideways scrolling with the answer (${await overflow()})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-bid-answer.png`), fullPage: true });
  // the robots' call on the next problem: right
  await page.keyboard.press('n');
  await page.waitForSelector('#drTable .dr-bbox .bbox', { timeout: 10000 });
  const nx = await page.evaluate(() => ({ k: DR.cur.k, rcall: DR.cur.rcall, kind: DR.cur.kind }));
  check(nx.kind === 'bid', `${vp}: N: the next bidding problem`);
  for (const s of callSel(nx.rcall)) { await tap(s); await sleep(80); }
  await page.waitForSelector('#drResult .dr-ok', { timeout: 10000 });
  const right = await page.evaluate(() => ({ st: drS().st, it: drS().items.find(x => x.k === DR.cur.k) }));
  check(right.st.good === 1 && right.st.streak === 1 && right.it.box === 1 && right.it.due > Date.now() + 3600e3, `${vp}: the robots' call: right, box 1, back in a day`);
  if (shots) await page.screenshot({ path: path.join(shots, `${W}-drills-bid-right.png`), fullPage: true });
  // the scan finishes: every board's calls checked
  await page.waitForFunction(() => drBidToScan().length === 0, null, { timeout: 60000 });
  const tot = await page.evaluate(() => ({ n: drS().items.filter(x => x.kind === 'bid').length, b: Object.keys(drS().bscanned).length }));
  check(tot.b === 16 && tot.n >= 2, `${vp}: all 16 boards' calls checked: ${tot.n} bidding problems`);
  await tap('[data-drrec]'); await sleep(300);
  check(await page.isVisible('#modalRoot .modal'), `${vp}: Hand record opens`);
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#drills'), `${vp}: Escape closes the record, the screen stays`);
  await page.keyboard.press('Escape'); await sleep(200);
  check(await page.isVisible('#home') && await page.isHidden('#drills'), `${vp}: Escape leaves`);
  check(!errs.length, `${vp}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'drillbid.pw: all ok');
process.exitCode = fails ? 1 : 0;
