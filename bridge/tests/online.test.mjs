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
  const c = { name, errs: [], st: null, chat: [], thinks: [], ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); }
    else if (m.type === 'error') c.errs.push(m.msg);
    else if (m.type === 'think') c.thinks.push(m); // friends mode: the server asks this browser for a robot's card (left unanswered here)
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

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
