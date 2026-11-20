// Online stability against a running server: a phone that sleeps through a robot's move and comes back, two tabs
// for one seat, the host leaving mid-board with robots seated, claim/undo races between two people, a connection
// closed as the board ends, message floods and oversized messages, and the 20-tables-an-hour limit per address.
//   npx wrangler dev --port 8787 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000
//   BRIDGE_URL=http://localhost:8787 STALE_MS=3000 node tests/online-stab.test.mjs
// (Hibernation/restart is in tests/online-restart.test.mjs, which runs its own server.)
import { createRequire } from 'node:module';
const { playTurn, auctionTurn } = createRequire(import.meta.url)('../js/engine.js');

const BASE = process.env.BRIDGE_URL || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const STALE = Number(process.env.STALE_MS) || 0;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // run some sections: ONLY=sleep,tabs
const run = name => !ONLY || ONLY.includes(name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
const order = ['N', 'E', 'S', 'W'];
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const until = async (cond, ms, step = 50) => { for (let i = 0; i < ms / step; i++) { if (cond()) return true; await sleep(step); } return !!cond(); };
const post = (body, hdr = {}) => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body) });
const open = async (host, opts = {}) => (await (await post({ secret: sec(host.toLowerCase()), name: host, tableName: 'stab', priv: true, ...opts })).json()).code;

async function client(code, name) {
  const c = { name, errs: [], st: null, chat: [], msgs: 0, closed: false, silent: false, ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    if (e.data === 'pong') return;
    c.msgs++;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); if (m.hist) c.hist = (m.histFrom ? (c.hist || []).slice(0, m.histFrom) : []).concat(m.hist); }
    else if (m.type === 'error') c.errs.push(m.msg);
    else if (m.type === 'think' && c.onThink) c.onThink(m);
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
const dummyOf = t => order[(order.indexOf(t.contract.declarer) + 2) % 4];
function legal(who, seat) {
  const v = who.t(), tr = v.play.tricks, last = tr[tr.length - 1], ps = new Set(tr.flatMap(x => x.cards.map(c => c.card)));
  let h = v.hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
  if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
  return h;
}
const waitingFor = t => { if (t.phase === 'auction') return auctionTurn(t.dealer, t.auction); if (t.phase !== 'play') return null; const s = playTurn(t.play, t.contract); return s === dummyOf(t) ? t.contract.declarer : s; };
// passes, but a human who would end the auction bids 7NT instead (once), so there is always a play phase
const passOrBid = t => { const a = t.auction; return a.length >= 3 && a.slice(-3).every(x => x.call === 'P') && !a.some(x => x.call === '7N') ? '7N' : 'P'; };
// One move for whoever in hum (seat -> client) is to act.
function humanMove(hum) {
  const t = Object.values(hum).find(c => !c.closed).t();
  if (t.phase === 'auction') { const s = auctionTurn(t.dealer, t.auction); if (hum[s]) { hum[s].act('call', passOrBid(t)); return true; } return false; }
  if (t.claim) { const s = t.claim.need.find(x => hum[x] && !t.claim.acc[x]); if (s) { hum[s].act('respond', true); return true; } return false; }
  if (t.undoReq) { const s = t.undoReq.need.find(x => hum[x]); if (s) { hum[s].act('undoReply', true); return true; } return false; }
  if (t.phase !== 'play') return false;
  const seat = playTurn(t.play, t.contract), by = seat === dummyOf(t) ? t.contract.declarer : seat, who = hum[by];
  if (!who) return false;
  const h = legal(who, seat); if (!h.length) return false;
  who.act('card', seat, h[0]); return true;
}
const nCalls = (t, s) => t.auction.filter(x => x.by === s).length;
const robotsAt = async (a, seats) => { a.act('settings', { friends: false }); await sleep(150); for (const s of seats) { a.act('robot', s); await sleep(120); } };

// ---------- 1. long sleep with a robot's move pending, then reconnect
if (STALE && run('sleep')) {
  const code = await open('Alice');
  const a = await client(code, 'Alice');
  await robotsAt(a, ['N', 'E', 'W']);
  await until(() => a.t().phase === 'auction', 3000);
  await until(() => waitingFor(a.t()) === 'S', 8000, 100);
  // Alice calls, so West's call is pending, and her phone sleeps at once (no close, no pings) for a long time
  a.act('call', passOrBid(a.t())); await sleep(30); a.silent = true;
  await sleep(STALE * 3 + 2000);
  const t1 = a.t();
  // she wakes up: the page's old connection is gone or stale; it opens a new one
  const a2 = await client(code, 'Alice');
  await sleep(300);
  const t = a2.t();
  check(t && t.seats.S && t.seats.S.id && !(t.away && t.away.S) && !(t.subs && t.subs.S), 'after a long sleep Alice is back in her seat, not away, no stand-in');
  check(waitingFor(t) === 'S' || t.phase !== 'auction', `the robots made the pending moves while she slept (now waiting for ${waitingFor(t)}, ${t.auction.length} calls, she saw ${t1.auction.length})`);
  // she can act at once and the robots answer
  if (waitingFor(t) === 'S') {
    const n = t.auction.length; a2.act('call', passOrBid(t));
    check(await until(() => a2.t().auction.length >= n + 2 || a2.t().phase !== 'auction', 4000), 'her call is taken and the robots go on');
  }
  check(await until(() => a.closed, 2000), 'the stale connection was closed');
  a.close(); a2.close();
}

// ---------- 2. two tabs for one seat
if (run('tabs')) {
  const code = await open('Alice');
  const a1 = await client(code, 'Alice'), a2 = await client(code, 'Alice'), b = await client(code, 'Bob');
  await robotsAt(a1, ['N', 'E']); b.act('sit', 'W'); await sleep(200);
  check(await until(() => a1.t().phase === 'auction', 3000), 'board starts');
  await until(() => { const t = a1.t(); if (waitingFor(t) === 'S') return true; humanMove({ W: b }); return false; }, 15000, 200);
  // both tabs call at the same moment: one call only
  const n = a1.t().auction.filter(x => x.by === 'S').length;
  a1.act('call', 'P'); a2.act('call', 'P');
  await sleep(1500);
  check(nCalls(a1.t(), 'S') === n + 1 && nCalls(a2.t(), 'S') === n + 1, 'two tabs sending the same call: it is taken once');
  check(a1.t().version === a2.t().version, 'both tabs show the same version');
  // one tab closes: still here
  a2.close(); await sleep(500);
  check(!(a1.t().away && a1.t().away.S), 'closing one of two tabs does not mark the player away');
  // a third tab goes silent while the first stays: still not away, and the silent one is closed
  if (STALE) {
    const a3 = await client(code, 'Alice'); a3.silent = true;
    await sleep(STALE + 1500); b.act('chat', 'hi'); await sleep(500);
    check(!(a1.t().away && a1.t().away.S) && await until(() => a3.closed, 3000), 'a silent extra tab is closed and the player stays seated and present');
    a3.close();
  }
  a1.close(); await sleep(600);
  check(b.t().away && b.t().away.S, 'closing the last tab marks the player away');
  // the other tab comes back: seat taken back
  const a4 = await client(code, 'Alice'); await sleep(300);
  check(!(b.t().away && b.t().away.S), 'a new tab takes the seat back');
  a4.close(); b.close();
}

// ---------- 2b. friends mode: the tab asked for a robot's card closes before answering (another tab stays)
if (run('think')) {
  const code = await open('Alice');
  const tabs = [await client(code, 'Alice'), await client(code, 'Alice')];
  const a = tabs[0];
  a.act('settings', { friends: true }); await sleep(150);
  for (const s of ['N', 'E', 'W']) { a.act('robot', s); await sleep(120); }
  await until(() => a.t().phase === 'auction', 3000);
  const nCards = t => t.play.tricks.reduce((n, x) => n + x.cards.length, 0);
  const waits = []; let asked = null;
  const arm = c => { c.onThink = () => { if (asked) return; asked = { at: Date.now(), n: nCards(a.t()) }; c.close(); }; };
  tabs.forEach(arm);
  const end = Date.now() + 90000;
  while (Date.now() < end && waits.length < 3) {
    const live = tabs.filter(c => !c.closed);
    if (live.length < 2) { const c = await client(code, 'Alice'); arm(c); tabs.push(c); continue; }
    const cur = live[0], t = cur.t();
    if (asked) {
      if (await until(() => nCards(cur.t()) > asked.n || cur.t().phase !== 'play', 6000, 20)) waits.push(Date.now() - asked.at);
      asked = null; continue;
    }
    if (t.phase === 'done') { cur.act('next'); await sleep(300); continue; }
    humanMove({ S: cur }); await sleep(200);
  }
  check(waits.length >= 3 && Math.max(...waits) < 2200, `a robot asked through a tab that then closed plays after its usual pause, not the 2.5 s think wait (${waits.join(', ')} ms)`);
  tabs.forEach(c => c.close());
}

// ---------- 3. the host leaves mid-board with robots seated
if (run('host')) {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob'), k = await client(code, 'Kim');
  await robotsAt(a, ['E', 'W']); b.act('sit', 'N'); await sleep(200);
  await until(() => a.t().phase === 'auction', 3000);
  await until(() => { const t = a.t(); if (waitingFor(t) === 'S') return true; humanMove({ N: b }); return false; }, 15000, 200);
  const hostId = a.t().host;
  a.close();
  const t0 = Date.now();
  // with the 1/60 time scale: stand-in after 1 s, the host's job passes after 2 s
  check(await until(() => b.t().subs && b.t().subs.S, 6000), `a robot stands in for the host (${Date.now() - t0} ms)`);
  check(await until(() => b.t().host !== hostId, 6000), `the host's job passes to Bob (${Date.now() - t0} ms)`);
  // the board finishes with Bob alone (robots for everyone else), and Bob can deal the next
  const done = await until(() => { const t = b.t(); if (t.phase === 'done') return true; humanMove({ N: b }); return false; }, 120000, 200);
  check(done, 'the board finishes after the host left');
  b.act('next'); check(await until(() => b.t().phase === 'auction' && b.t().board === 2, 3000), 'the new host deals the next board');
  // an onlooker with the host gone: the host's job does not go to a non-player, and kibitzers can't act for the host
  check(b.t().host === b.t().seats.N.id, 'the host job went to the seated player, not the onlooker');
  const a2 = await client(code, 'Alice'); await sleep(400);
  check(!(b.t().subs && b.t().subs.S) && !(b.t().away && b.t().away.S), 'Alice comes back to her seat');
  a2.close(); b.close(); k.close();
}

// ---------- 4. claim and undo races between two people
if (run('race')) {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob');
  await robotsAt(a, ['N', 'E']); b.act('sit', 'W'); await sleep(200);
  a.act('settings', { undoAsk: true, allowUndo: true }); await sleep(200);
  await until(() => a.t().phase === 'auction', 3000);
  await until(() => { const t = a.t(); if (t.phase === 'play' && t.play.tricks.length >= 2) return true; humanMove({ S: a, W: b }); return false; }, 60000, 200);
  let bad = 0, rounds = 0, stuckAt = null;
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const t = a.t();
    if (t.phase !== 'play') { if (t.phase === 'done') a.act('next'); else humanMove({ S: a, W: b }); await sleep(150); continue; } // on to the next board
    if (t.claim && t.undoReq) bad++;
    const left = 13 - t.play.tricks.filter(x => x.cards.length === 4).length;
    // both people at once: claim, ask to undo, answer whatever is open, and play
    a.act('claim', left, left); b.act('undo'); b.act('claim', left, left); a.act('undo');
    await sleep(40);
    const t2 = a.t();
    if (t2.claim) { a.act('respond', Math.random() < 0.1); b.act('respond', Math.random() < 0.1); if (Math.random() < 0.3) { a.act('cancelClaim'); b.act('cancelClaim'); } }
    if (t2.undoReq) { a.act('undoReply', Math.random() < 0.5); b.act('undoReply', Math.random() < 0.5); if (Math.random() < 0.3) { a.act('undoCancel'); b.act('undoCancel'); } }
    humanMove({ S: a, W: b });
    rounds++;
    await sleep(150);
    // stuck check: neither claim nor undo nor turn for a human or robot
    const t3 = a.t();
    if (t3.phase === 'play' && !t3.claim && !t3.undoReq && !waitingFor(t3)) stuckAt = t3.version;
  }
  await sleep(1500);
  check(bad === 0, `never a claim and an undo request open together (${rounds} rounds)`);
  check(stuckAt == null, 'never without someone to act');
  check(a.t().version === b.t().version, 'both see the same version');
  const fin = await until(() => { const t = a.t(); if (t.phase === 'done') return true; humanMove({ S: a, W: b }); return false; }, 90000, 200);
  check(fin, 'the board still finishes');
  if (!fin) { const t = a.t(); console.log(JSON.stringify({ phase: t.phase, board: t.board, auction: t.auction, claim: t.claim, undoReq: t.undoReq, away: t.away, subs: t.subs, waiting: waitingFor(t), tricks: t.play.tricks.length, errs: a.errs.slice(-5).concat(b.errs.slice(-5)), chat: a.chat.slice(-6).map(m => m.text), bClosed: b.closed, aClosed: a.closed, version: t.version }));
    a.act('chat', 'still there?'); b.act('call', '7N'); await sleep(1500); console.log('chat answered:', a.chat.some(m => m.text === 'still there?'), 'version', a.t().version, 'auction', a.t().auction.length, 'errs', b.errs); }
  a.close(); b.close();
}

// ---------- 5. a connection closes as the board ends
if (run('end')) {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob');
  await robotsAt(a, ['E', 'W']); b.act('sit', 'N'); await sleep(200);
  await until(() => a.t().phase === 'auction', 3000);
  await until(() => { const t = a.t(); if (t.phase === 'play' && waitingFor(t) && waitingFor(t) !== dummyOf(t) && (waitingFor(t) === 'N' || waitingFor(t) === 'S') && !t.claim) return true; if (t.phase === 'done') { a.act('next'); return false; } humanMove({ S: a, N: b }); return false; }, 90000, 200);
  // whoever is to play concedes the rest and closes in the same instant; the robots accept at once, so the board ends
  const ws = waitingFor(a.t()), who = ws === 'S' ? a : b, other = who === a ? b : a, seat = ws;
  const hist0 = (other.hist || []).length;
  who.act('claim', 0); who.close();
  check(await until(() => other.t().phase === 'done', 4000), 'the concession sent just before closing ends the board');
  check(await until(() => other.t().away && other.t().away[seat], 2000), 'the closer is shown away');
  check((other.hist || []).length === hist0 + 1, 'the board is in the record');
  // the other player deals on, the closer comes back and gets the whole record
  other.act('next'); await until(() => other.t().phase === 'auction', 3000);
  const back = await client(code, who.name); await sleep(400);
  check(back.t().seats[seat].id && !(other.t().away && other.t().away[seat]), 'the closer comes back to the same seat');
  check((back.hist || []).length === (other.hist || []).length && back.hist.length >= 1, `the reconnected page has every finished board (${(back.hist || []).length})`);
  back.close(); other.close();
}

// ---------- 6. floods and oversized messages
if (run('flood')) {
  const code = await open('Alice');
  const a = await client(code, 'Alice'), f = await client(code, 'Flo'), g = await client(code, 'Gus');
  const v0 = a.t().version;
  // Flo sends 2000 actions, 200 oversized messages, 200 binary frames and 500 junk lines in one burst
  for (let i = 0; i < 2000; i++) f.act('chat', 'spam ' + i);
  for (let i = 0; i < 200; i++) f.ws.send(JSON.stringify({ type: 'act', name: 'chat', args: ['x'.repeat(5000)] }));
  for (let i = 0; i < 200; i++) f.ws.send(new Uint8Array(3000));
  for (let i = 0; i < 500; i++) f.ws.send('{not json');
  // Gus chats meanwhile: his line gets through quickly
  const t0 = Date.now(); g.act('chat', 'gus here');
  const got = await until(() => a.chat.some(m => m.text === 'gus here'), 5000, 20);
  check(got && Date.now() - t0 < 2000, `another person's message gets through during a flood (${Date.now() - t0} ms)`);
  await sleep(1500);
  const spam = a.chat.filter(m => /^spam /.test(m.text)).length;
  check(spam <= 10, `the flood's chat is cut down (${spam} lines got through)`);
  check(f.errs.length <= 10, `the flooder gets a few "slow down" messages, not one per message (${f.errs.length})`);
  check(f.errs.some(e => /slow down/i.test(e)), '... and is told to slow down');
  // an oversized message on its own gets a reply (a page that somehow sends one isn't left waiting)
  const h = await client(code, 'Hal'); await sleep(2500);
  h.ws.send(JSON.stringify({ type: 'act', name: 'chat', args: ['y'.repeat(5000)] }));
  check(await until(() => h.errs.some(e => /too long/i.test(e)), 2000), 'an oversized message is answered with "too long"');
  // the table still works for everyone, including the flooder after a pause
  await sleep(10500); f.act('chat', 'flo calm'); // (5 chat lines per 10 s)
  check(await until(() => a.chat.some(m => m.text === 'flo calm'), 3000), 'the flooder can chat again after a pause');
  check(a.t().version > v0, 'table versions moved on normally');
  a.close(); f.close(); g.close(); h.close();
}

// ---------- 7. the 20-new-tables-an-hour limit per address
if (run('limit')) {
  const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`, hdr = { 'cf-connecting-ip': ip };
  const body = { secret: sec('rapid'), name: 'Rapid', priv: true };
  const ok = [], slow = [];
  for (let i = 0; i < 20; i++) { const t0 = Date.now(); const r = await post(body, hdr); ok.push(r.status); slow.push(Date.now() - t0); await r.text(); }
  check(ok.every(s => s === 200), `20 tables in a row from one address open (${ok.filter(s => s === 200).length}/20, slowest ${Math.max(...slow)} ms)`);
  const t0 = Date.now(), r = await post(body, hdr), j = await r.json(), ms = Date.now() - t0;
  check(r.status === 429 && ms < 3000, `the 21st gets 429 at once (${r.status}, ${ms} ms)`);
  check(/20 tables/i.test(j.error || '') && /minute/i.test(j.error || ''), `... with a clear message: "${j.error}"`);
  check(Number(r.headers.get('retry-after')) > 0 && j.retryAfter > 0, `... and when to try again (Retry-After ${r.headers.get('retry-after')} s)`);
  // a bad request doesn't use up the allowance, and joining a table is never limited
  const r2 = await post({ name: 'x' }, { 'cf-connecting-ip': '198.51.100.251' }); await r2.text();
  check(r2.status === 400, 'a bad request is refused before the hourly count');
  // many at once from a fresh address: exactly 20 get through (no lost count)
  const ip2 = { 'cf-connecting-ip': `203.0.113.${1 + Math.floor(Math.random() * 250)}` };
  const rs = await Promise.all(Array.from({ length: 30 }, () => post(body, ip2).then(async r => { await r.text(); return r.status; })));
  check(rs.filter(s => s === 200).length === 20 && rs.filter(s => s === 429).length === 10, `30 at once from one address: ${rs.filter(s => s === 200).length} open, ${rs.filter(s => s === 429).length} refused (want 20/10)`);
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
