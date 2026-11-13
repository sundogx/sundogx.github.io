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
  const c = { name, errs: [], st: null, ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') c.st = m; else if (m.type === 'error') c.errs.push(m.msg); };
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
let stuck = 0;
while (T().phase === 'play' && cnt() < 52) {
  const n = cnt(), tr = T().play.tricks, last = tr[tr.length - 1];
  const cands = last && last.cards.length < 4 ? [order[(order.indexOf(last.cards[last.cards.length - 1].seat) + 1) % 4]] : order;
  const ps = played(); let moved = false;
  for (const s of cands) {
    let h = by[ctrl(s)].t().hands[s].filter(x => !x.startsWith('?') && !ps.has(x));
    if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
    for (const card of h) { by[ctrl(s)].act('card', s, card); if (await waitCnt(n, 800)) { moved = true; break; } }
    if (moved) break;
  }
  if (!moved && ++stuck > 3) break;
  if (moved) stuck = 0;
}
await sleep(500);
check(cnt() === 52 && T().phase === 'done', 'all 52 cards played and the board finishes (played ' + cnt() + ', phase ' + T().phase + ')');
cl.forEach(c => c.ws.close());

// --- team match: onlookers never see hands
const m = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'match', priv: true, match: true })).json();
const spec = await client(m.code, 'Spectator'); await sleep(400);
check(spec.t() && spec.t().kibSee === false && spec.t().seed === undefined, 'team match rooms hide hands from onlookers and never send the seed');
spec.ws.close();

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
