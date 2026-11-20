// Bad connections against a running server: a phone that goes to sleep (its connection stays open on the server
// but goes silent), a flaky network that leaves dead connections behind, the host leaving between boards, races
// between claims, undos and moves from four people, and daily results posted twice.
//   npx wrangler dev --port 8787 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000
//   BRIDGE_URL=http://localhost:8787 STALE_MS=3000 node tests/online-net.test.mjs
// TEST_STALE_MS shortens how long a connection may go without a ping (150 s live) before the table counts it as gone;
// STALE_MS tells this test the same number. Without them the silent-connection checks are skipped.
// Every client here pings like the page does (js/net.js), only more often.
import { createRequire } from 'node:module';
const { playTurn, auctionTurn } = createRequire(import.meta.url)('../js/engine.js');

const BASE = process.env.BRIDGE_URL || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const STALE = Number(process.env.STALE_MS) || 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
const order = ['N', 'E', 'S', 'W'];
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const until = async (cond, ms, step = 50) => { for (let i = 0; i < ms / step; i++) { if (cond()) return true; await sleep(step); } return !!cond(); };
const post = body => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const open = async (host, opts = {}) => (await (await post({ secret: sec(host.toLowerCase()), name: host, tableName: 'net', priv: true, ...opts })).json()).code;

// A client that pings every 300 ms until silenced (c.silent = true: a phone asleep, the connection left open).
async function client(code, name) {
  const c = { name, errs: [], st: null, chat: [], thinks: [], closed: false, silent: false, ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); }
    else if (m.type === 'error') c.errs.push(m.msg);
    // friends mode: the server asks this browser for a robot's card; c.answer: reply at once (no card), like a page would
    else if (m.type === 'think') { c.thinks.push(m); if (c.answer && !c.silent && c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'thought', key: m.key, card: null })); }
  };
  c.ws.onclose = () => { c.closed = true; clearInterval(c.ping); };
  await new Promise((r, j) => { c.ws.onopen = r; c.ws.onerror = j; });
  c.ws.send(JSON.stringify({ type: 'hello', secret: sec(name.toLowerCase()), name }));
  c.ping = setInterval(() => { if (!c.silent && c.ws.readyState === 1) c.ws.send('ping'); }, 300);
  c.act = (n, ...args) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'act', name: n, args })); };
  c.t = () => c.st && c.st.t;
  c.close = () => { clearInterval(c.ping); try { c.ws.close(); } catch (e) { } };
  await until(() => c.st, 3000);
  return c;
}
const cards = t => t.play.tricks.reduce((n, x) => n + x.cards.length, 0);
const dummyOf = t => order[(order.indexOf(t.contract.declarer) + 2) % 4];
function legal(who, seat) {
  const v = who.t(), tr = v.play.tricks, last = tr[tr.length - 1], ps = new Set(tr.flatMap(x => x.cards.map(c => c.card)));
  let h = v.hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
  if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
  return h;
}
// The seat whose person the table is waiting for (the controller of the seat to act), or null.
const waitingFor = t => { if (t.phase === 'auction') return auctionTurn(t.dealer, t.auction); if (t.phase !== 'play') return null; const s = playTurn(t.play, t.contract); return s === dummyOf(t) ? t.contract.declarer : s; };
// One move for whoever in hum (seat -> client) is to act: pass in the auction, lowest legal card, accept claims.
function humanMove(hum, skip = new Set()) {
  const t = Object.values(hum).find(c => !c.closed).t();
  if (t.phase === 'auction') { const s = auctionTurn(t.dealer, t.auction); if (hum[s] && !skip.has(s)) { hum[s].act('call', 'P'); return true; } return false; }
  if (t.claim) { const s = t.claim.need.find(x => hum[x] && !skip.has(x) && !t.claim.acc[x]); if (s) { hum[s].act('respond', true); return true; } return false; }
  if (t.undoReq) { const s = t.undoReq.need.find(x => hum[x] && !skip.has(x)); if (s) { hum[s].act('undoReply', true); return true; } return false; }
  if (t.phase !== 'play') return false;
  const seat = playTurn(t.play, t.contract), by = seat === dummyOf(t) ? t.contract.declarer : seat, who = hum[by];
  if (!who || skip.has(by)) return false;
  const h = legal(who, seat); if (!h.length) return false;
  who.act('card', seat, h[0]); return true;
}

// ---------- 1. a phone goes to sleep mid-board: its connection stays open but stops pinging
if (STALE) {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob');
  a.act('settings', { friends: false }); await sleep(200);
  b.act('sit', 'W'); await sleep(200);
  a.act('robot', 'N'); await sleep(150); a.act('robot', 'E');
  await until(() => a.t().phase === 'auction', 3000);
  // play until it is Bob's turn
  await until(() => { const t = a.t(); if (waitingFor(t) === 'W') return true; humanMove({ S: a }); return false; }, 20000, 250);
  check(waitingFor(a.t()) === 'W', 'the table waits for Bob (West)');
  // Bob's phone sleeps: no close, no pings
  b.silent = true;
  const t0 = Date.now();
  const subbed = await until(() => a.t().subs && a.t().subs.W, STALE + 6000, 100);
  check(subbed, `a robot stands in for a player whose connection went silent (${subbed ? Date.now() - t0 : '>' + (STALE + 6000)} ms; silent limit ${STALE} ms)`);
  check(a.t().away && a.t().away.W, '... who is shown as away');
  check(await until(() => b.closed, 2000), '... and the silent connection is closed, so a phone that wakes up reconnects');
  const nW = () => a.t().phase === 'play' ? a.t().play.tricks.flatMap(x => x.cards).filter(x => x.seat === 'W').length : a.t().auction.filter(x => x.by === 'W').length;
  const w0 = nW();
  check(await until(() => { if (nW() > w0) return true; humanMove({ S: a }); return false; }, 15000, 250), 'the stand-in plays for West');
  // Bob wakes up and reconnects
  const b2 = await client(code, 'Bob'); await sleep(400);
  check(!(a.t().subs && a.t().subs.W) && !(a.t().away && a.t().away.W), 'Bob reconnects and takes his seat back');
  // a player who thinks a long time but whose page is open (pinging) is never marked away
  // (up to 90 s: when a robot declares with Alice as dummy, the robots play the whole board, ~1 s a card)
  await until(() => { const t = a.t(); if (waitingFor(t) === 'S') return true; if (t.phase === 'done') a.act('next'); else humanMove({ W: b2 }); return false; }, 90000, 250);
  if (waitingFor(a.t()) === 'S') {
    await sleep(STALE * 2 + 2500);
    check(!(a.t().away && a.t().away.S) && !(a.t().subs && a.t().subs.S) && !a.closed, `a player thinking for ${(STALE * 2 + 2500) / 1000} s with the page open keeps their seat`);
  } else check(false, 'the table gets to Alice\'s turn');
  a.close(); b2.close(); b.close();
} else console.log('skip  silent connections (start the server with --var TEST_STALE_MS:3000 and set STALE_MS=3000)');

// ---------- 1b. a robot's move is due just as another duty comes up (a seated connection goes silent, or the
// host's job passes): the alarm that handles that duty must still leave the robot's move planned
// Alice (S, host) and Bob (N) with robots E and W. passOrBid: a pass, unless it would end the auction.
const passOrBid = t => { const a = t.auction; return a.length >= 3 && a.slice(-3).every(x => x.call === 'P') && !a.some(x => x.call === '7N') ? '7N' : 'P'; };
async function robotTable() {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob');
  a.act('settings', { friends: false }); await sleep(200);
  b.act('sit', 'N'); await sleep(200);
  a.act('robot', 'E'); await sleep(150); a.act('robot', 'W');
  await until(() => a.t().phase === 'auction', 3000);
  return { a, b };
}
const calls = (t, s) => t.auction.filter(x => x.by === s).length;
async function untilTurn(a, b, seat) {
  return until(() => { const t = a.t(); if (t.phase !== 'auction') return false; const s = auctionTurn(t.dealer, t.auction); if (s === seat) return true;
    if (s === 'S') a.act('call', passOrBid(t)); else if (s === 'N') b.act('call', passOrBid(t)); return false; }, 10000, 250);
}
if (STALE) {
  const { a, b } = await robotTable();
  if (await untilTurn(a, b, 'S')) {
    // Bob's phone sleeps; Alice calls just before his connection counts as gone, so West's call (0.65 s) comes due after it does
    b.ws.send('ping'); b.silent = true;
    await sleep(STALE - 350);
    const w0 = calls(a.t(), 'W'), t0 = Date.now();
    a.act('call', passOrBid(a.t()));
    const moved = await until(() => calls(a.t(), 'W') > w0, 5000, 50);
    check(moved && Date.now() - t0 < 2500, `a robot still calls when a seated connection goes silent during its pause (${moved ? Date.now() - t0 : '>5000'} ms)`);
    check(a.t().away && a.t().away.N, '... and the silent player is shown away');
  } else check(false, 'the table gets to Alice\'s call');
  a.close(); b.close();
} else console.log('skip  robot move due as a connection goes silent (needs TEST_STALE_MS)');
{
  const { a, b } = await robotTable();
  if (await untilTurn(a, b, 'N')) {
    // the host leaves; Bob calls so East's call (0.65 s) comes due just after the host's job should pass (2 s scaled)
    const hostId = b.t().host;
    a.close(); await sleep(1650);
    const e0 = calls(b.t(), 'E'), t0 = Date.now();
    b.act('call', passOrBid(b.t()));
    const moved = await until(() => calls(b.t(), 'E') > e0, 5000, 50);
    check(moved && Date.now() - t0 < 2500, `a robot still calls when the host's job passes during its pause (${moved ? Date.now() - t0 : '>5000'} ms; needs TEST_TIME_SCALE)`);
    check(b.t().host !== hostId, '... and the host\'s job has passed');
  } else check(false, 'the table gets to Bob\'s call');
  a.close(); b.close();
}

// ---------- 2. a flaky network leaves dead connections behind; the person can still get back in
if (STALE) {
  const code = await open('Gina');
  const g = await client(code, 'Gina');
  const ghosts = [];
  for (let i = 0; i < 12; i++) {
    try { const c = await client(code, 'Gina'); c.silent = true; ghosts.push(c); } catch (e) { }
    await sleep(250); // (5 new connections a second per address)
  }
  g.silent = true;
  await sleep(STALE + 1500);
  let ok = false;
  try { const c = await client(code, 'Gina'); ok = !!c.t(); c.close(); } catch (e) { }
  check(ok, `after ${ghosts.length + 1} connections went silent from one address, a new one still gets in (the limit is 12)`);
  ghosts.forEach(c => c.close()); g.close();
} else console.log('skip  dead connections and the per-address limit (needs TEST_STALE_MS)');

// ---------- 2b. a seated person goes silent while a robot's move is waiting (the silent check used to take the
// robot's alarm and not set it again, so the robots stopped). Two people, two robots; time runs out, so the
// robots play all four hands; then North's phone sleeps.
if (STALE) {
  const code = await open('Pia');
  const p = await client(code, 'Pia'), q = await client(code, 'Quin');
  q.act('sit', 'N'); await sleep(200);
  p.act('robot', 'E'); await sleep(150); p.act('robot', 'W'); await sleep(300);
  p.act('settings', { boardLimit: 5 }); await sleep(300);
  const tu = await until(() => p.t().timeUp, 10000);
  if (tu) {
    await sleep(1500);
    q.silent = true;
    let last = p.t().version, lastAt = Date.now(), stalled = false;
    await until(() => {
      const t = p.t();
      if (t.version !== last) { last = t.version; lastAt = Date.now(); }
      if (Date.now() - lastAt > STALE + 5000) { stalled = true; return true; }
      return t.phase === 'done';
    }, 120000, 100);
    check(!stalled && p.t().phase === 'done', `a person goes silent while the robots finish a board: the robots keep playing (phase ${p.t().phase}${stalled ? ', stalled' : ''})`);
  } else check(false, 'the board time runs out (needs TEST_TIME_SCALE)');
  p.close(); q.close();
} else console.log('skip  silent while a robot moves (needs TEST_STALE_MS)');

// ---------- 2c. friends mode: the browser asked for a robot's card goes silent. Once its connection is closed the
// robot plays at once instead of waiting out the 2.5 s it gives a browser. Rex (N) is the only seated person, with
// two tabs that both answer; Ann (the host) watches. On Rex's turn his second tab goes silent and he plays just
// before it counts as gone, so the robot after him is due (1 s) after the tab is closed. Tried until that tab is asked.
if (STALE) {
  const code = await open('Ann');
  const a = await client(code, 'Ann');
  await until(() => a.t().seats.S, 2000); a.act('standUp'); await until(() => !a.t().seats.S, 2000);
  const r = await client(code, 'Rex'); r.answer = true;
  r.act('sit', 'N'); await sleep(300);
  for (const s of ['E', 'S', 'W']) { a.act('robot', s); await sleep(150); }
  await until(() => a.t().phase === 'auction', 3000);
  let r2 = null, ms = null, tries = 0;
  const end = Date.now() + 150000;
  while (ms == null && tries < 8 && Date.now() < end) {
    if (!r2 || r2.closed) { r2 && r2.close(); r2 = await client(code, 'Rex'); r2.answer = true; await sleep(300); }
    const t = a.t();
    if (t.phase === 'done') { a.act('next'); await sleep(500); continue; }
    if (t.phase === 'auction') { if (auctionTurn(t.dealer, t.auction) === 'N') r.act('call', 'P'); await sleep(200); continue; }
    const tr = t.play.tricks[t.play.tricks.length - 1];
    if (t.claim || t.undoReq || waitingFor(t) !== 'N') { await sleep(100); continue; }
    if (tr && tr.cards.length === 3) { const s0 = playTurn(t.play, t.contract); r.act('card', s0, legal(r, s0)[0]); await sleep(300); continue; } // (a trick's last card: the next pause differs)
    tries++;
    r2.ws.send('ping'); r2.silent = true;
    await sleep(STALE - 700);
    const seat = playTurn(t.play, t.contract), n0 = cards(a.t()), k0 = r2.thinks.length;
    r.act('card', seat, legal(r, seat)[0]);
    const t1 = Date.now();
    const moved = await until(() => cards(a.t()) >= n0 + 2, 6000, 25);
    if (r2.thinks.length > k0) ms = moved ? Date.now() - t1 : 99999; // the silent tab was asked: this is the case to time
    await until(() => r2.closed, 3000);
  }
  check(ms != null && ms < 1900, `the robot doesn't wait for an answer from a tab that went silent (${ms} ms after the card before; 1 s pause, 2.5 s wait for an answer; ${tries} tries)`);
  a.close(); r.close(); r2 && r2.close();
} else console.log('skip  robot asked a silent tab (needs TEST_STALE_MS)');

// ---------- 3. the host leaves between boards: the job passes without anyone having to act
{
  const code = await open('Hana');
  const names = { S: 'Hana', W: 'Ivan', N: 'Jo', E: 'Kim' }, hum = {};
  for (const s of ['S', 'W', 'N', 'E']) { hum[s] = await client(code, names[s]); if (s !== 'S') hum[s].act('sit', s); await sleep(150); }
  await until(() => hum.W.t().phase === 'auction', 3000);
  await until(() => { if (hum.W.t().phase === 'done') return true; humanMove(hum); return false; }, 8000, 150);
  check(hum.W.t().phase === 'done', 'a passed-out board ends');
  const hostId = hum.W.t().host;
  hum.S.close();
  // HOST_AWAY_MS is 2 minutes live (2 s with TEST_TIME_SCALE 0.0167)
  const passed = await until(() => hum.W.t().host !== hostId, 6000, 100);
  check(passed, 'the host leaves between boards: a seated player becomes host without anyone acting (needs TEST_TIME_SCALE)');
  if (passed) {
    const h = hum.W.t().host, nh = Object.values(hum).find(c => c !== hum.S && c.t().seats && Object.values(c.t().seats).some(o => o && o.id === h && o.name === c.name));
    if (nh) { nh.act('settings', { allowUndo: false }); await sleep(400); }
    check(nh && hum.W.t().allowUndo === false, '... who can change the settings at once');
  }
  Object.values(hum).forEach(c => c.close());
}

// ---------- 4. people send claims, undos, answers and cards at random for a while; the table never sticks
// (once with four people; once with two people and two robots, one person dropping out and back in on the way)
async function fuzz(withRobots) {
  const code = await open('Lou');
  const names = withRobots ? { S: 'Lou', N: 'Ned' } : { S: 'Lou', W: 'Max', N: 'Ned', E: 'Ola' }, hum = {};
  for (const s of Object.keys(names)) { hum[s] = await client(code, names[s]); if (s !== 'S') hum[s].act('sit', s); await sleep(150); }
  hum.S.act('settings', { undoAsk: !withRobots, friends: false }); await sleep(200);
  if (withRobots) { hum.S.act('robot', 'E'); await sleep(150); hum.S.act('robot', 'W'); }
  await until(() => hum.S.t().phase === 'auction', 3000);
  let rnd = withRobots ? 777 : 12345; const r = n => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
  let boards = 0, stuck = 0, sent = 0, lastV = -1, lastAt = Date.now(), dropped = false;
  const start = Date.now();
  // the table waits for a robot (a table robot, or a stand-in for an away person): it must move within a few seconds
  const robotTurn = t => { if (t.claim || t.undoReq || t.timeUp) return false; const w = waitingFor(t); if (!w) return false; const o = t.seats[w]; return o && (o.kind === 'robot' || (t.subs && t.subs[w])); };
  while (Date.now() - start < 40000 && boards < 6) {
    const live = Object.entries(hum).filter(([, c]) => !c.closed);
    const t = live[0][1].t();
    if (t.version !== lastV) { lastV = t.version; lastAt = Date.now(); }
    else if (robotTurn(t) && Date.now() - lastAt > 6000) { stuck++; console.log('     stuck on a robot:', JSON.stringify({ phase: t.phase, auction: t.auction.length, cards: cards(t), subs: t.subs, away: t.away })); lastAt = Date.now(); }
    if (t.phase === 'done') { boards++; live[r(live.length)][1].act('next'); await sleep(250); continue; }
    // halfway, Ned drops for a while (a robot stands in after a minute, a second here) and comes back
    if (withRobots && !dropped && Date.now() - start > 12000) { dropped = true; hum.N.close(); await sleep(2500); hum.N = await client(code, 'Ned'); }
    // a burst of random actions from random people at the same moment
    for (let k = 0; k < 3; k++) {
      const [, c] = live[r(live.length)], left = t.phase === 'play' ? 13 - Math.floor(cards(t) / 4) : 13;
      const x = r(10);
      if (x < 4) humanMove(hum);
      else if (x === 4) c.act('undo');
      else if (x === 5) c.act('claim', r(left + 1), left);
      else if (x === 6) c.act('respond', r(2) === 0);
      else if (x === 7) c.act('undoReply', r(2) === 0);
      else if (x === 8) { c.act('cancelClaim'); c.act('undoCancel'); }
      else if (t.phase === 'auction') c.act('call', ['P', '1C', 'X', '2NT'][r(4)]);
      sent++;
    }
    await sleep(60 + r(120));
  }
  // then play on normally: the board in progress has to finish
  const b0 = hum.S.t().board;
  const fin = await until(() => { const t = hum.S.t(); if (t.phase === 'done' || t.board > b0) return true; humanMove(hum); return false; }, withRobots ? 60000 : 30000, 120);
  await sleep(400);
  const vs = new Set(Object.values(hum).map(c => c.t().version));
  const what = withRobots ? 'two people and two robots, one person dropping out' : 'four people';
  // (boards finished in the random phase is shown for information only: with robots taking 1-1.8 s a card, a board
  // takes about 50 s, longer than the 40 s phase, so 0-2 is normal; the check is "never stuck" and "the board finishes")
  check(stuck === 0 && fin, `${what}: random claims, undos and moves (${sent} actions, ${boards} boards finished in 40 s): the table never sticks and the board finishes`);
  check(vs.size === 1, '... everyone ends on the same table version');
  check(Object.values(hum).every(c => !c.errs.some(e => /Could not save|server error/i.test(e))), '... no save errors');
  Object.values(hum).forEach(c => c.close());
}
await fuzz(false);
await fuzz(true);

// ---------- 5. daily results posted twice (a reply lost on a bad connection, then the page sends it again)
{
  const day = new Date().toISOString().slice(0, 10);
  const body = s => JSON.stringify({ date: day, board: 1, secret: sec('daily-net-' + s), name: 'Net' + s, auction: ['P', 'P', 'P', 'P'] });
  const send = s => fetch(BASE + '/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(s) }).then(r => r.status);
  const tag = Date.now().toString(36);
  const [x, y] = await Promise.all([send(tag), send(tag)]);
  check([x, y].sort().join() === '200,409', `the same result posted twice at once: one is added, the other is told it is there already (${x}, ${y})`);
  check(await send(tag) === 409, '... and a later retry too (the page then stops sending it)');
  const d = await (await fetch(`${BASE}/api/daily/${day}`)).json();
  check(d.boards[1].rows.filter(r0 => r0.name === 'Net' + tag).length === 1, 'the leaderboard has the result once');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
