// End-to-end checks against a running server (npm run dev, or the deployed Worker).
//   BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs
const BASE = process.env.BRIDGE_URL || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const post = (body) => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function client(code, name) {
  const c = { name, errs: [], st: null, chat: [], hist: [], thinks: [], ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); if (m.hist) c.hist = c.hist.slice(0, m.histFrom).concat(m.hist); }
    else if (m.type === 'error') c.errs.push(m.msg);
    else if (m.type === 'think') c.thinks.push(m); // friends mode: the server asks this browser for a robot's card (left unanswered here)
    else if (m.type === 'notfound') c.notfound = m;
  };
  await new Promise(r => c.ws.onopen = r);
  c.ws.send(JSON.stringify({ type: 'hello', secret: sec(name.toLowerCase()), name }));
  c.act = (n, ...args) => c.ws.send(JSON.stringify({ type: 'act', name: n, args }));
  c.t = () => c.st && c.st.t;
  return c;
}

// --- input validation
check((await post(null)).status === 400, 'null body is rejected with 400, not a crash');
check((await post({ secret: 'short', name: 'x' })).status === 400, 'short secret is rejected');

// --- a full four-player board
const seats = ['S', 'W', 'N', 'E'], names = ['Alice', 'Bob', 'Cara', 'Dan'], order = ['N', 'E', 'S', 'W'];
const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'test', priv: true })).json();
const cl = [];
for (const n of names) cl.push(await client(code, n));
await sleep(500);
const by = Object.fromEntries(seats.map((s, i) => [s, cl[i]]));
for (let i = 1; i < 4; i++) { cl[i].act('sit', seats[i]); await sleep(200); }
await sleep(400);
const T = () => cl[0].t();
let leaks = 0;
cl.forEach((c, i) => { for (const s of order) if (s !== seats[i] && (c.t().hands[s] || []).some(x => !x.startsWith('?'))) leaks++; });
check(leaks === 0, 'nobody sees another player\'s hand during the auction');

// seat hopping: a seated player may not move to another seat mid-board
const bobSeat = seats[1];
cl[1].act('sit', 'N'); await sleep(400);
check(T().seats[bobSeat].name === 'Bob' && T().seats.N.name === 'Cara', 'a seated player cannot hop seats during a board');
cl[1].act('standUp'); await sleep(300); cl[1].act('sit', 'E'); await sleep(300);
check(!(T().seats.E && T().seats.E.name === 'Bob'), 'a player who stood up mid-board cannot take a different seat');
cl[1].act('sit', bobSeat); await sleep(300);
check(T().seats[bobSeat] && T().seats[bobSeat].name === 'Bob', '... but can return to their own seat');

// prototype names are not actions
const v0 = T().version;
cl[3].act('constructor'); cl[3].act('toString'); await sleep(400);
check(T().version === v0, 'inherited property names are not treated as actions');

// bid and play it out
let turn = T().dealer;
by[turn].act('call', '1C'); await sleep(250);
for (let k = 0; k < 3; k++) { turn = order[(order.indexOf(turn) + 1) % 4]; by[turn].act('call', 'P'); await sleep(250); }
await sleep(400);
check(T().phase === 'play', 'auction ends and play begins');
const d = T().contract.declarer, dummy = order[(order.indexOf(d) + 2) % 4];
const ctrl = s => s === dummy ? d : s;
const cnt = () => ((T().play || {}).tricks || []).reduce((n, t) => n + t.cards.length, 0);
const played = () => new Set(((T().play || {}).tricks || []).flatMap(t => t.cards.map(c => c.card)));
const waitCnt = async (n, ms) => { for (let i = 0; i < ms / 50; i++) { if (cnt() > n) return true; await sleep(50); } return false; };
// Play it out. The shared rules engine says whose turn it is, so every card is one round trip.
import { createRequire } from 'node:module';
const { playTurn, auctionTurn } = createRequire(import.meta.url)('../js/engine.js');
// the opening leader may not take the lead back after seeing dummy without the opponents' agreement
{
  const leader = order[(order.indexOf(d) + 1) % 4], lc = by[leader];
  lc.act('card', leader, lc.t().hands[leader][0]);
  if (await waitCnt(0, 3000)) {
    await sleep(300);
    lc.act('undo'); await sleep(400);
    check(cnt() === 1 && T().undoReq && T().undoReq.by === leader, 'undoing the opening lead after dummy is seen becomes a request to the opponents');
    by[d].act('undoReply', false); await sleep(400);
    check(cnt() === 1 && !T().undoReq, '... and the lead stands when they decline');
  } else check(false, 'opening lead was played');
}
for (let guard = 0; guard < 80 && T().phase === 'play' && cnt() < 52; guard++) {
  const n = cnt(), seat = playTurn(T().play, T().contract), who = ctrl(seat);
  const tr = T().play.tricks, last = tr[tr.length - 1];
  const ps = played();
  let h = by[who].t().hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
  if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
  by[who].act('card', seat, h[0]);
  if (!(await waitCnt(n, 3000))) break;
}
await sleep(500);
check(cnt() === 52 && T().phase === 'done', 'all 52 cards played and the board finishes (played ' + cnt() + ', phase ' + T().phase + ')');
cl.forEach(c => c.ws.close());

// --- friends mode is only for private tables
{
  const { code: pc } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'public', priv: false })).json();
  const a = await client(pc, 'Alice'); await sleep(400);
  a.act('settings', { friends: true }); await sleep(400);
  check(a.t().friends !== true && a.errs.some(e => /private/.test(e)), 'the host cannot turn on friends mode at a public table');
  a.ws.close();
}

// Bid (passing for the humans) until the robots reach a contract; the humans in `hum` are seat -> client.
async function toPlay(hum, host) {
  for (let guard = 0; guard < 400; guard++) {
    const t = host.t();
    if (t.phase === 'play') return true;
    if (t.phase === 'done') { host.act('next'); await sleep(400); continue; }
    if (t.phase === 'auction') { const s = auctionTurn(t.dealer, t.auction); if (hum[s]) { hum[s].act('call', 'P'); await sleep(300); continue; } }
    await sleep(100);
  }
  return false;
}

// --- friends mode: only the browser that was asked may answer for a robot
{
  const { code: fc } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'friends', priv: true })).json();
  const a = await client(fc, 'Alice'), b = await client(fc, 'Bob'); await sleep(400);
  for (const s of ['N', 'E', 'W']) { a.act('robot', s); await sleep(150); }
  await sleep(400);
  const inPlay = await toPlay({ S: a }, a);
  // wait for a think about a robot's card (Alice plays her own cards meanwhile)
  let th = null;
  for (let guard = 0; guard < 300 && !th && a.t().phase === 'play'; guard++) {
    if (a.thinks.length) { th = a.thinks[0]; break; }
    const t = a.t(), seat = playTurn(t.play, t.contract), dummy = order[(order.indexOf(t.contract.declarer) + 2) % 4];
    const ctrlr = seat === dummy ? t.contract.declarer : seat;
    if (ctrlr === 'S') {
      const tr = t.play.tricks, last = tr[tr.length - 1], ps = new Set(tr.flatMap(x => x.cards.map(c => c.card)));
      let h = t.hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
      if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
      const n = t.play.tricks.reduce((k, x) => k + x.cards.length, 0); a.act('card', seat, h[0]);
      for (let i = 0; i < 60 && a.t().play.tricks.reduce((k, x) => k + x.cards.length, 0) === n; i++) await sleep(50);
    } else await sleep(100);
  }
  if (inPlay && th) {
    const v = th.view, hand = v.known[v.seat], tr = v.tricks[v.tricks.length - 1];
    let legal = hand; if (tr && tr.cards.length && tr.cards.length < 4) { const f = hand.filter(x => x[0] === tr.cards[0].card[0]); if (f.length) legal = f; }
    const evil = legal.find(x => x !== th.prefer);
    const t = b.t(), publicKey = `${t.id}:${t.board}:${t.play.tricks.map(x => x.cards.map(c => c.card).join('')).join('|')}`;
    check(th.key !== publicKey, 'the think request carries a key nobody else knows');
    const n = t.play.tricks.reduce((k, x) => k + x.cards.length, 0);
    b.ws.send(JSON.stringify({ type: 'thought', key: publicKey, card: evil }));
    b.ws.send(JSON.stringify({ type: 'thought', key: th.key, card: evil })); // even with the key, Bob wasn't asked
    for (let i = 0; i < 100 && b.t().play.tricks.reduce((k, x) => k + x.cards.length, 0) === n; i++) await sleep(50);
    const flat = b.t().play.tricks.flatMap(x => x.cards);
    check(flat.length > n && flat[n].card !== evil, `a browser that wasn't asked can't choose the robot's card (played ${flat[n] && flat[n].card}, spoofed ${evil})`);
  } else check(false, 'friends table reached a robot decision (in play ' + inPlay + ', think ' + !!th + ')');
  a.ws.close(); b.ws.close();
}

// --- team match: onlookers never see hands
const m = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'match', priv: true, match: true })).json();
const spec = await client(m.code, 'Spectator'); await sleep(400);
check(spec.t() && spec.t().kibSee === false && spec.t().seed === undefined, 'team match rooms hide hands from onlookers and never send the seed');

// ... nor a board this room has finished before the other room has played it
{
  const closedCode = spec.t().match.otherCode;
  const play1 = async (code, n1, n2, host) => { // two humans N-S, robots E-W; a human claims nothing so the board ends at once
    const x = host || await client(code, n1), y = await client(code, n2); await sleep(400);
    x.act('sit', 'S'); await sleep(200); y.act('sit', 'N'); await sleep(200);
    x.act('robot', 'E'); await sleep(150); x.act('robot', 'W'); await sleep(400);
    const hum = { S: x, N: y };
    if (!(await toPlay(hum, x))) return [x, y];
    const t = x.t(), dummy = order[(order.indexOf(t.contract.declarer) + 2) % 4];
    const claimer = ['S', 'N'].find(s => s !== dummy);
    hum[claimer].act('claim', 0); await sleep(1000);
    return [x, y];
  };
  const alice = await client(m.code, 'Alice'); await sleep(300);
  const [oa, ob] = await play1(m.code, 'Alice', 'Bob', alice);
  check(oa.t().phase === 'done', 'open room finished board 1');
  await sleep(400);
  const sv = spec.t();
  check(sv.masked && !sv.contract && sv.auction.length === 0 && Object.values(sv.hands).flat().every(x => x.startsWith('?')), 'an onlooker doesn\'t see the finished board before the other room has played it');
  check(!spec.chat.some(x => /^Board 1:/.test(x.text)) && oa.chat.some(x => /^Board 1:/.test(x.text)), '... nor its result line (the players get it)');
  const [ca, cb] = await play1(closedCode, 'Cara', 'Dan');
  check(ca.t().phase === 'done', 'closed room finished board 1');
  await sleep(800);
  check(!spec.t().masked && spec.chat.filter(x => /^Board 1:/.test(x.text)).length === 1, 'once both rooms have played it, the onlooker sees the board and gets the result line once');
  check(oa.chat.filter(x => /^Board 1:/.test(x.text)).length === 1, '... and the players still have it only once');
  for (const c of [oa, ob, ca, cb]) c.ws.close();
}
spec.ws.close();

// Play one move for whichever of the humans in `hum` (seat -> client) is to act: pass in the auction, the first legal card in play.
// Returns true if a move was sent.
function humanMove(hum) {
  const c0 = Object.values(hum)[0], t = c0.t();
  if (t.phase === 'auction') { const s = auctionTurn(t.dealer, t.auction); if (hum[s]) { hum[s].act('call', 'P'); return true; } return false; }
  if (t.phase !== 'play' || t.claim || t.undoReq) return false;
  const seat = playTurn(t.play, t.contract), dummy = order[(order.indexOf(t.contract.declarer) + 2) % 4];
  const who = hum[seat === dummy ? t.contract.declarer : seat];
  if (!who) return false;
  const v = who.t(), tr = v.play.tricks, last = tr[tr.length - 1], ps = new Set(tr.flatMap(x => x.cards.map(c => c.card)));
  let h = v.hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
  if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
  who.act('card', seat, h[0]); return true;
}
const until = async (cond, ms, step = 100) => { for (let i = 0; i < ms / step; i++) { if (cond()) return true; await sleep(step); } return !!cond(); };
// Two humans N-S (S hosts), robots E-W; bid to a contract and concede it, so the board ends at once.
async function quickBoard(a, b) {
  const hum = { S: a, N: b };
  if (!(await toPlay(hum, a))) return false;
  const t = a.t(), dummy = order[(order.indexOf(t.contract.declarer) + 2) % 4];
  hum[['S', 'N'].find(s => s !== dummy)].act('claim', 0);
  return until(() => a.t().phase === 'done', 3000);
}

// --- host: hand over, and passing on when the host has left
{
  const { code: hc } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'host', priv: true })).json();
  const a = await client(hc, 'Alice'), b = await client(hc, 'Bob'); await sleep(400);
  b.act('sit', 'N'); await sleep(300);
  b.act('makeHost', 'S'); await sleep(300);
  check(a.t().host === a.t().createdBy, 'only the host can hand over the host\'s job');
  a.act('makeHost', 'N'); await sleep(300);
  check(a.t().host !== a.t().createdBy && a.chat.some(x => /Bob is now the host/.test(x.text)), 'the host can hand the job to a seated player');
  b.act('makeHost', 'S'); await sleep(300);
  check(a.t().host === a.t().createdBy, '... and back');
  // the host stands up while alone, leaves, and someone else sits down: they become the host
  b.act('standUp'); await sleep(300); a.act('standUp'); await sleep(300);
  check(a.t().host === a.t().createdBy, 'a host who stands up with nobody seated stays the host');
  a.ws.close(); await sleep(400);
  b.act('sit', 'E'); await sleep(400);
  check(b.t().seats.E && b.t().host !== b.t().createdBy && b.chat.some(x => /Bob is now the host, as the host has left/.test(x.text)), 'a host who left the table hands the job to the next player who sits down');
  b.ws.close();
}

// --- lobby: public tables show who is there and the settings that matter for joining
{
  const { code: lc } = await (await post({ secret: sec('lena'), name: 'Lena', tableName: 'lobby test', priv: false })).json();
  const a = await client(lc, 'Lena'); await sleep(300);
  a.act('settings', { locked: true }); await sleep(3500); // the lobby list is cached for 3 seconds
  const row = (await (await fetch(BASE + '/api/tables')).json()).tables.find(x => x.code === lc);
  check(row && row.people === 1 && row.locked === true && row.boardLimit === 0 && row.seats.S && row.seats.S.name === 'Lena', 'the lobby lists people at the table, locked seats and the time limit');
  // --- closing a table
  const k = await client(lc, 'Kim'); await sleep(300);
  k.act('close'); await sleep(400);
  check(!k.notfound && k.errs.some(e => /Only the host/.test(e)), 'only the host can close the table');
  a.act('close'); await sleep(600);
  check(a.notfound && a.notfound.closed && k.notfound, 'the host closes the table and everyone at it is told');
  await sleep(3200);
  const gone = !(await (await fetch(BASE + '/api/tables')).json()).tables.some(x => x.code === lc);
  const z = await client(lc, 'Zoe'); await sleep(400);
  check(gone && z.notfound && !z.notfound.closed, '... it leaves the lobby and its code no longer opens a table');
  z.ws.close();
}

// --- closing a team match closes both rooms
{
  const mm = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'match2', priv: true, match: true })).json();
  const a = await client(mm.code, 'Alice'); await sleep(400);
  const c = await client(a.t().match.otherCode, 'Cara'); await sleep(300);
  a.act('close'); await sleep(800);
  check(a.notfound && c.notfound, 'closing one room of a team match closes the other room too');
}

// --- play a deal again (host only), not in a team match
{
  const { code: rc } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'replay', priv: false })).json();
  const a = await client(rc, 'Alice'), b = await client(rc, 'Bob'); await sleep(400);
  b.act('sit', 'N'); await sleep(200);
  a.act('robot', 'E'); await sleep(150); a.act('robot', 'W'); await sleep(400);
  check(await quickBoard(a, b), 'a board finished');
  const h1 = a.hist[0], bd = a.t().board; // board 1 (if it was passed out, toPlay has moved on to the next one)
  b.act('next', { replay: 1 }); await sleep(400);
  check(a.t().phase === 'done' && b.errs.some(e => /Only the host/.test(e)), 'only the host can deal a board again');
  a.act('next', { replay: 1 }); await sleep(500);
  const t2 = a.t();
  check(t2.board === bd + 1 && t2.replayOf === 1 && t2.dealer === h1.dealer && t2.vul === h1.vul && JSON.stringify(t2.hands.S.slice().sort()) === JSON.stringify(h1.hands.S.slice().sort()), 'the host deals board 1 again (same cards, dealer and vulnerability)');
  check(Object.entries(t2.hands).every(([s, h]) => s === 'S' || h.every(x => x.startsWith('?'))), '... and the other hands stay hidden as usual');
  check(await quickBoard(a, b) && a.hist.some(h => h.board === bd + 1 && h.replayOf === 1), '... and its record says which board it repeats');
  a.ws.close(); b.ws.close();
}
{
  const mm = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'match3', priv: true, match: true })).json();
  const a = await client(mm.code, 'Alice'), b = await client(mm.code, 'Bob'); await sleep(400);
  b.act('sit', 'N'); await sleep(200);
  a.act('robot', 'E'); await sleep(150); a.act('robot', 'W'); await sleep(400);
  await quickBoard(a, b);
  const bd = a.t().board; // (a passed-out board moves on to the next one)
  a.act('next', { replay: 1 }); await sleep(400);
  check(a.t().board === bd && a.errs.some(e => /fixed deals/.test(e)), 'a team match never deals a board again (' + a.t().phase + ' ' + a.t().board + ' ' + a.errs.join('; ') + ')');
  a.act('close'); await sleep(300);
  a.ws.close(); b.ws.close();
}

// --- a robot's claim when a person is its dummy: the person answers it themself
// (only a board where North, a robot, declares opposite the human South shows this; up to about 90 seconds of boards)
{
  const { code: dc } = await (await post({ secret: sec('dora'), name: 'Dora', tableName: 'dummy claim', priv: false })).json();
  const a = await client(dc, 'Dora'); await sleep(300);
  for (const s of ['N', 'E', 'W']) { a.act('robot', s); await sleep(120); }
  let seen = null; const t0 = Date.now();
  while (!seen && Date.now() - t0 < 90000) {
    const t = a.t();
    if (t.claim) {
      if (t.contract.declarer === 'N' && t.claim.by === 'N' && t.claim.need.includes('S')) { seen = t.claim; break; }
      if (t.claim.need.includes('S') && !t.claim.acc.S) a.act('respond', true);
      await sleep(300); continue;
    }
    if (t.phase === 'done') { a.act('next'); await sleep(400); continue; }
    // not the board we want: South concedes as a defender
    if (t.phase === 'play' && (t.contract.declarer === 'E' || t.contract.declarer === 'W')) { a.act('claim', 0); await sleep(400); continue; }
    if (t.phase === 'auction' && auctionTurn(t.dealer, t.auction) === 'S') {
      // raise North's suit opening once, so North declares more often; otherwise pass
      const last = [...t.auction].reverse().find(x => /^[1-7]/.test(x.call)), mine = t.auction.some(x => x.by === 'S' && x.call !== 'P');
      const raise = last && last.by === 'N' && !mine && !/NT$/.test(last.call) && +last.call[0] < 4 ? (+last.call[0] + 1) + last.call.slice(1) : 'P';
      a.act('call', raise); await sleep(300); continue;
    }
    if (humanMove({ S: a })) await sleep(300); else await sleep(100);
  }
  if (seen) {
    await sleep(600);
    const t = a.t();
    check(t.claim && !t.claim.acc.S && t.phase === 'play', 'a robot declarer\'s claim waits for its human dummy\'s answer');
    a.act('respond', false); await sleep(500);
    check(!a.t().claim && a.chat.some(x => /South rejected the claim/.test(x.text)), '... who can reject it');
  } else console.log('skip  a robot declarer\'s claim with a human dummy (no such board came up in time)');
  a.ws.close();
}

// --- friends mode: a robot standing in for an away player never sends that person's cards to another browser
{
  const { code: sc } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'subs', priv: true })).json();
  const a = await client(sc, 'Alice'); let b = await client(sc, 'Bob'); await sleep(400);
  b.act('sit', 'N'); await sleep(200);
  a.act('robot', 'E'); await sleep(150); a.act('robot', 'W'); await sleep(400);
  b.ws.close(); await sleep(500);
  check(a.t().away && a.t().away.N, 'a player whose connection closes is marked away');
  a.act('sub', 'N'); await sleep(400);
  check(a.t().subs && a.t().subs.N && a.chat.some(x => /A robot is playing for North/.test(x.text)), 'their partner can let a robot play for them at once');
  const nCards = () => a.t().play.tricks.flatMap(x => x.cards).filter(c => c.seat === 'N').length;
  await until(() => (a.t().phase === 'play' && nCards() >= 3) || a.t().phase === 'done' || (humanMove({ S: a }) && false), 60000, 300);
  check(a.t().phase === 'done' || nCards() >= 3, 'the stand-in bids and plays for North');
  check(!a.thinks.some(x => x.view.seat === 'N'), 'no think request carries the away player\'s cards (' + a.thinks.length + ' think requests)');
  b = await client(sc, 'Bob'); await sleep(500);
  check(!a.t().subs.N && !a.t().away.N && a.chat.some(x => /Bob is back/.test(x.text)), 'when they come back they take over from the robot');
  a.ws.close(); b.ws.close();
}


console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
