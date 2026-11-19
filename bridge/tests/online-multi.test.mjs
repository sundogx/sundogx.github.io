// Multi-client scenarios against a running server: races (moves sent by several people at the same moment),
// two tabs for one seat, reconnecting mid-trick, robots standing in for away players and handing back,
// seat moves between boards, the session record, message validation and rate limits.
//   BRIDGE_URL=http://localhost:8787 node tests/online-multi.test.mjs
// Start the server with `npx wrangler dev --var TEST_TIME_SCALE:0.0167` (a minute lasts a second) to also check
// the automatic stand-in for an away player and the lobby hiding empty tables; without it those checks are skipped.
import { createRequire } from 'node:module';
const { playTurn, auctionTurn } = createRequire(import.meta.url)('../js/engine.js');

const BASE = process.env.BRIDGE_URL || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
const order = ['N', 'E', 'S', 'W'];
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const until = async (cond, ms, step = 50) => { for (let i = 0; i < ms / step; i++) { if (cond()) return true; await sleep(step); } return !!cond(); };
const post = body => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const open = async (host, opts = {}) => (await (await post({ secret: sec(host.toLowerCase()), name: host, tableName: 'multi', priv: true, ...opts })).json()).code;

async function client(code, name, secretName = name) {
  const c = { name, errs: [], st: null, chat: [], hist: [], thinks: [], ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); if (m.hist) c.hist = c.hist.slice(0, m.histFrom).concat(m.hist); }
    else if (m.type === 'error') c.errs.push(m.msg);
    else if (m.type === 'think') c.thinks.push(m);
    else if (m.type === 'notfound') c.notfound = m;
  };
  await new Promise((r, j) => { c.ws.onopen = r; c.ws.onerror = j; });
  c.ws.send(JSON.stringify({ type: 'hello', secret: sec(secretName.toLowerCase()), name }));
  c.act = (n, ...args) => c.ws.send(JSON.stringify({ type: 'act', name: n, args }));
  c.t = () => c.st && c.st.t;
  c.close = () => { try { c.ws.close(); } catch (e) { } };
  await until(() => c.st, 3000);
  return c;
}
const cards = t => t.play.tricks.reduce((n, x) => n + x.cards.length, 0);
const dummyOf = t => order[(order.indexOf(t.contract.declarer) + 2) % 4];
// The cards `who` may play for `seat` in `who`'s view (following suit).
function legal(who, seat) {
  const v = who.t(), tr = v.play.tricks, last = tr[tr.length - 1], ps = new Set(tr.flatMap(x => x.cards.map(c => c.card)));
  let h = v.hands[seat].filter(x => !x.startsWith('?') && !ps.has(x));
  if (last && last.cards.length < 4) { const f = h.filter(x => x[0] === last.cards[0].card[0]); if (f.length) h = f; }
  return h;
}
// One move for whichever person in `hum` (seat -> client) is to act; true if one was sent.
function humanMove(hum) {
  const t = Object.values(hum)[0].t();
  if (t.phase === 'auction') { const s = auctionTurn(t.dealer, t.auction); if (hum[s]) { hum[s].act('call', 'P'); return true; } return false; }
  if (t.claim) { const s = t.claim.need.find(x => hum[x] && !t.claim.acc[x]); if (s) { hum[s].act('respond', true); return true; } return false; } // a robot's claim: accept it
  if (t.phase !== 'play' || t.undoReq) return false;
  const seat = playTurn(t.play, t.contract), who = hum[seat === dummyOf(t) ? t.contract.declarer : seat];
  if (!who) return false;
  const h = legal(who, seat); if (!h.length) return false;
  who.act('card', seat, h[0]); return true;
}
// Four people at one table: S hosts (Alice), then W, N, E sit down.
async function fourTable() {
  const code = await open('Alice');
  const names = { S: 'Alice', W: 'Bob', N: 'Cara', E: 'Dan' }, hum = {};
  for (const s of ['S', 'W', 'N', 'E']) { hum[s] = await client(code, names[s]); if (s !== 'S') hum[s].act('sit', s); await sleep(150); }
  await until(() => hum.S.t().phase === 'auction', 3000);
  return { code, hum };
}
// Bid 1C by the dealer and three passes, sent by each person as soon as it is their turn.
async function quickAuction(hum, contract = '1C') {
  const a = hum.S;
  for (let i = 0; i < 4; i++) {
    const t = a.t(), s = auctionTurn(t.dealer, t.auction), n = t.auction.length;
    hum[s].act('call', i === 0 ? contract : 'P');
    await until(() => a.t().auction.length > n || a.t().phase !== 'auction', 3000);
  }
  return a.t().phase === 'play';
}

// ---------- 1. races at a table of four people
{
  const { hum } = await fourTable();
  const all = Object.values(hum), a = hum.S;
  // everyone bids at once: only the dealer's call counts
  const dealer = a.t().dealer;
  all.forEach(c => c.act('call', '1C'));
  await sleep(600);
  check(a.t().auction.length === 1 && a.t().auction[0].by === dealer, 'four simultaneous bids: only the player whose turn it is gets in');
  // two people race for the next call
  const nxt = auctionTurn(a.t().dealer, a.t().auction);
  all.forEach(c => c.act('call', 'P'));
  await sleep(600);
  check(a.t().auction.length === 2 && a.t().auction[1].by === nxt, '... and again for the second call');
  for (let i = 0; i < 2; i++) { const t = a.t(), s = auctionTurn(t.dealer, t.auction), n = t.auction.length; hum[s].act('call', 'P'); await until(() => a.t().auction.length > n || a.t().phase === 'play', 3000); }
  check(a.t().phase === 'play' && a.t().contract && a.t().contract.level === 1, 'the auction ends 1C passed out to the play');
  // everyone tries the opening lead at once (each with a card of their own)
  {
    const t = a.t(), leader = playTurn(t.play, t.contract), d = dummyOf(t);
    for (const [s, c] of Object.entries(hum)) { const seat = s === t.contract.declarer ? d : s; if (seat !== d || s === t.contract.declarer) { const h = legal(c, seat); if (h.length) c.act('card', seat, h[0]); } }
    await sleep(700);
    const t2 = a.t();
    check(cards(t2) === 1 && t2.play.tricks[0].cards[0].seat === leader, 'simultaneous cards: only the opening leader\'s card is played');
  }
  // the views stay consistent: everyone sees the same trick and version
  await sleep(300);
  check(new Set(all.map(c => c.t().version)).size === 1 && all.every(c => cards(c.t()) === 1), 'every player ends with the same table version');
  // play three more cards (one trick)
  for (let i = 0; i < 3; i++) { const n = cards(a.t()); humanMove(hum); await until(() => cards(a.t()) > n, 3000); }
  check(cards(a.t()) === 4, 'first trick complete');
  // claim and undo at the same moment: at most one of them is open
  {
    const t = a.t(), d = t.contract.declarer, lho = order[(order.indexOf(d) + 1) % 4];
    hum[d].act('claim', 13 - 1, 12); hum[lho].act('undo');
    await sleep(700);
    const t2 = a.t();
    check(!(t2.claim && t2.undoReq), 'a claim and an undo request sent together: never both open (claim ' + !!t2.claim + ', undo ' + !!t2.undoReq + ')');
    if (t2.claim) hum[d].act('cancelClaim');
    if (t2.undoReq) hum[t2.undoReq.by === lho ? lho : d].act('undoCancel');
    await until(() => !a.t().claim && !a.t().undoReq, 2000);
    // declarer claims while a defender concedes: only one claim
    const rho = order[(order.indexOf(d) + 3) % 4];
    hum[d].act('claim', 12, 12); hum[rho].act('claim', 0, 12);
    await sleep(700);
    const c = a.t().claim;
    check(c && (c.by === d || c.by === rho) && all.every(x => x.t().claim && x.t().claim.by === c.by), 'two claims at once: one stands, and everyone sees the same one');
    // both defenders answer at once (one accepts, one rejects) while the claimer withdraws
    if (c) {
      const need = c.need;
      hum[need[0]].act('respond', true); if (need[1]) hum[need[1]].act('respond', false); hum[c.by === d ? d : rho].act('cancelClaim');
      await sleep(700);
      check(!a.t().claim && a.t().phase === 'play', 'accept, reject and withdraw at the same moment: the claim is gone and play goes on');
    }
  }
  // two tabs for one seat: Cara opens a second tab
  {
    const cara2 = await client(a.t().id, 'Cara');
    const t = cara2.t();
    check(t.hands.N.every(x => !x.startsWith('?')) && JSON.stringify(t.hands) === JSON.stringify(hum.N.t().hands), 'a second tab for the same seat sees just what the first tab sees');
    hum.N.close(); await sleep(500);
    check(!(a.t().away && a.t().away.N), 'closing one of two tabs does not mark the player away');
    // play on from the second tab
    const hum2 = { ...hum, N: cara2 };
    let moved = 0;
    for (let i = 0; i < 8; i++) { const n = cards(a.t()); if (!humanMove(hum2)) break; if (await until(() => cards(a.t()) > n, 3000)) moved++; }
    check(moved === 8, 'play goes on with the second tab (' + moved + ' cards)');
    // reconnect mid-trick: Bob drops after a card in the middle of a trick and comes back
    while (cards(a.t()) % 4 !== 1 && a.t().phase === 'play') { const n = cards(a.t()); humanMove(hum2); await until(() => cards(a.t()) > n, 3000); }
    const t3 = a.t(), seat = playTurn(t3.play, t3.contract), who = t3.contract.declarer === seat || dummyOf(t3) === seat ? t3.contract.declarer : seat;
    const key = Object.keys(hum2).find(s => s === who);
    hum2[key].close(); await sleep(400);
    check(a.t().away && a.t().away[key], 'the player to act drops mid-trick and is marked away');
    hum2[key] = await client(a.t().id, hum2[key].name);
    await sleep(300);
    const back = hum2[key].t();
    check(!(back.away && back.away[key]) && cards(back) === cards(a.t()), '... reconnects and sees the trick as it stands');
    const n = cards(a.t()); humanMove(hum2);
    check(await until(() => cards(a.t()) > n, 3000), '... and plays their card');
    Object.values(hum2).forEach(c => c.close()); hum.N.close();
  }
}

// ---------- 2. the end of a board: everyone presses Next at once; the session record; seat moves
{
  const { hum } = await fourTable();
  const a = hum.S, all = Object.values(hum);
  await quickAuction(hum);
  // the declarer's side concedes everything, so the board ends
  { const t = a.t(); hum[t.contract.declarer].act('claim', 0); }
  await until(() => a.t().claim, 2000);
  { const c = a.t().claim; for (const s of c.need) hum[s].act('respond', true); }
  check(await until(() => a.t().phase === 'done', 3000), 'the board ends on an accepted concession');
  const h = a.hist[a.hist.length - 1];
  check(h && h.players && h.players.S.name === 'Alice' && h.players.W.name === 'Bob' && h.players.N.id && h.players.E.kind === 'human', 'the board\'s record says who sat where');
  // seat moves: not by a guest, not mid-board
  hum.W.act('swap', 'rotate'); await sleep(400);
  check(a.t().seats.W.name === 'Bob' && hum.W.errs.some(e => /Only the host/.test(e)), 'only the host can move players');
  a.act('swap', 'N', 'E'); await sleep(400);
  check(a.t().seats.N.name === 'Dan' && a.t().seats.E.name === 'Cara' && a.chat.some(x => /swapped North and East/.test(x.text)), 'the host swaps two seats between boards');
  a.act('swap', 'rotate'); await sleep(400);
  const st = a.t().seats;
  check(st.E.name === 'Dan' && st.S.name === 'Cara' && st.W.name === 'Alice' && st.N.name === 'Bob', 'the host moves everyone one seat clockwise');
  // everyone presses Next at once: one new board
  const b0 = a.t().board;
  all.forEach(c => c.act('next'));
  await sleep(700);
  check(a.t().board === b0 + 1 && a.t().phase === 'auction', 'four Next presses at once deal exactly one board (' + b0 + ' -> ' + a.t().board + ')');
  a.act('swap', 'rotate'); await sleep(400);
  check(a.t().seats.W.name === 'Alice' && a.errs.some(e => /when this board ends/.test(e)), 'nobody moves seats mid-board');
  // the new hands follow the moved seats: Alice (now West) sees West's cards only
  const t = a.t();
  check(t.hands.W.every(x => !x.startsWith('?')) && ['N', 'E', 'S'].every(s => t.hands[s].every(x => x.startsWith('?'))), 'after moving, each player sees only their new seat\'s hand');
  // play board 1 again from the other side: its record compares the two results in IMPs
  await quickAuction({ N: hum.W, E: hum.E, S: hum.N, W: a });
  { const t = a.t(), m = { N: hum.W, E: hum.E, S: hum.N, W: a }; m[t.contract.declarer].act('claim', 0); await until(() => a.t().claim, 2000); for (const s of a.t().claim.need) m[s].act('respond', true); }
  await until(() => a.t().phase === 'done', 3000);
  a.act('next', { replay: 1 }); await sleep(500);
  check(a.t().replayOf === 1, 'the host deals board 1 again');
  {
    const m = { N: hum.W, E: hum.E, S: hum.N, W: a };
    await quickAuction(m, '2C');
    const t = a.t(); m[t.contract.declarer].act('claim', 0); await until(() => a.t().claim, 2000); for (const s of a.t().claim.need) m[s].act('respond', true);
    await until(() => a.t().phase === 'done', 3000);
    const r = a.hist[a.hist.length - 1], o = a.hist.find(x => x.board === 1);
    check(r.vs && r.vs.board === 1 && Number.isInteger(r.vs.imps) && (r.scoreNS === o.scoreNS ? r.vs.imps === 0 : r.vs.imps !== 0 || Math.abs(r.scoreNS - o.scoreNS) < 20), `the replay's record has the IMPs against the original (${r.scoreNS} vs ${o.scoreNS}: ${r.vs && r.vs.imps})`);
  }
  all.forEach(c => c.close());
}

// ---------- 3. message validation and rate limits
{
  const code = await open('Vera');
  const a = await client(code, 'Vera'); await sleep(200);
  const v0 = a.t().version;
  const junk = ['null', '[]', '"x"', '42', '{}', '{"type":"act"}', '{"type":"act","name":"__proto__"}', '{"type":"act","name":"hasOwnProperty"}',
    '{"type":"act","name":"sit","args":[{"toString":1}]}', '{"type":"act","name":"sit","args":["__proto__"]}', '{"type":"act","name":"call","args":[["1C"]]}',
    '{"type":"act","name":"settings","args":[null]}', '{"type":"act","name":"settings","args":[{"boardLimit":1e99}]}', '{"type":"act","name":"next","args":[{"replay":{"x":1}}]}',
    '{"type":"act","name":"swap","args":["N","N"]}', '{"type":"act","name":"swap","args":[{},[]]}', '{"type":"act","name":"grant","args":["__proto__"]}',
    '{"type":"act","name":"claim","args":[1e9,"x"]}', '{"type":"act","name":"robot","args":["X"]}', '{"type":"thought","key":{},"card":[]}',
    '{"type":"act","name":"chat","args":["' + 'x'.repeat(5000) + '"]}', '{"type":"hello"}', '{"type":"hello","secret":{"length":99}}', '{bad json'];
  for (const j of junk) a.ws.send(j);
  await sleep(800);
  a.act('chat', 'still here'); await sleep(400);
  check(a.chat.some(x => x.text === 'still here') && a.t().version === v0 + 1, 'junk messages change nothing and the table still answers (version ' + v0 + ' -> ' + a.t().version + ')');
  // a flood of actions: the server says slow down, then accepts actions again
  a.errs.length = 0;
  for (let i = 0; i < 40; i++) a.act('settings', { allowUndo: i % 2 === 0 });
  await sleep(800);
  check(a.errs.some(e => /Slow down/.test(e)), 'a flood of actions is told to slow down');
  for (let i = 0; i < 8; i++) a.act('chat', 'spam ' + i);
  await sleep(600);
  check(a.chat.filter(x => /^spam/.test(x.text)).length <= 5, 'at most 5 chat lines in 10 seconds');
  await sleep(2500);
  a.errs.length = 0; a.act('settings', { locked: true }); await sleep(400);
  check(a.t().locked === true && !a.errs.length, '... and after a pause actions work again');
  // two people race for the same empty seat on a locked table vs an open one
  a.act('settings', { locked: false }); await sleep(300);
  const x = await client(code, 'Xena'), y = await client(code, 'Yuri');
  x.act('sit', 'N'); y.act('sit', 'N'); await sleep(600);
  const n = a.t().seats.N, inX = Object.values(a.t().seats).filter(o => o && o.name === 'Xena').length, inY = Object.values(a.t().seats).filter(o => o && o.name === 'Yuri').length;
  check(n && (n.name === 'Xena' || n.name === 'Yuri') && inX + inY === 1, 'two people sitting in the same seat at once: one gets it, the other stays an onlooker');
  // a second identity on the same connection doesn't inherit the seat
  x.ws.send(JSON.stringify({ type: 'hello', secret: sec('mallory'), name: 'Mallory' })); await sleep(2200);
  x.ws.send(JSON.stringify({ type: 'hello', secret: sec('mallory'), name: 'Mallory' })); await sleep(400);
  x.act('standUp'); await sleep(400);
  check(a.t().seats.N && a.t().seats.N.name === n.name, 'a connection that switches identity can\'t act for the seat it had');
  for (const c of [a, x, y]) c.close();
}

// ---------- 4. robots: adding and removing mid-session, standing in for an away player and handing back
{
  const code = await open('Alice');
  const a = await client(code, 'Alice'), b = await client(code, 'Bob');
  b.act('sit', 'N'); await sleep(200);
  a.act('robot', 'E'); await sleep(150);
  b.act('robot', 'W'); await sleep(400);
  check(a.t().phase === 'auction' && a.t().seats.W.kind === 'robot', 'a seated guest can add a robot, and the board starts');
  // the host removes a robot between boards and a friend sits there
  const hum = { S: a, N: b };
  await until(() => { const t = a.t(); if (t.phase === 'play') return true; humanMove(hum); return false; }, 30000, 300);
  if (a.t().phase === 'play') { const t = a.t(); const dc = t.contract.declarer; const c = ['S', 'N'].includes(dc) ? hum[dc] : hum[['S', 'N'].find(s => s !== dummyOf(t))]; c.act('claim', 0); }
  await until(() => a.t().phase === 'done' || (a.t().claim && (a.t().claim.need.forEach(s => hum[s] && !a.t().claim.acc[s] && hum[s].act('respond', true)), false)), 8000, 300);
  check(a.t().phase === 'done', 'board finished');
  a.act('kick', 'W'); await sleep(300);
  a.act('next'); await sleep(400);
  check(a.t().phase === 'done' && a.errs.some(e => /Fill the empty seat/.test(e)), 'no new board while a seat is empty (it could never finish)');
  const c = await client(code, 'Cara'); c.act('sit', 'W'); await sleep(400);
  check(a.t().seats.W && a.t().seats.W.name === 'Cara', 'the host removes a robot between boards and a friend takes the seat');
  // Cara leaves mid-board: the host puts a robot in her empty seat and it plays on
  a.act('next'); await sleep(400);
  c.act('standUp'); await sleep(300);
  a.act('robot', 'W'); await sleep(300);
  check(a.t().seats.W && a.t().seats.W.kind === 'robot', 'a robot can take a seat someone left mid-board');
  c.act('sit', 'W'); await sleep(300);
  check(a.t().seats.W && a.t().seats.W.name === 'Cara', '... and she can come back to it, replacing the robot');
  a.act('kick', 'W'); await sleep(300);
  check(a.t().seats.W && a.t().seats.W.kind === 'robot' && a.chat.some(x => /A robot takes West/.test(x.text)), 'a player the host removes mid-board is replaced by a robot, so the board can finish');
  c.close();
  // automatic stand-in (needs TEST_TIME_SCALE): Bob drops and the table waits for him
  const hum2 = { S: a, N: b };
  b.close(); await sleep(400);
  const fast = await until(() => { const t = a.t(); if (t.subs && t.subs.N) return true; if (t.phase === 'done') a.act('next'); else humanMove({ S: a }); return false; }, 9000, 300);
  if (fast) {
    check(a.chat.some(x => /A robot is playing for North while Bob is away/.test(x.text)), 'a robot stands in by itself for a player who is away when the table waits for them');
    const nN = () => a.t().phase === 'play' ? a.t().play.tricks.flatMap(x => x.cards).filter(x => x.seat === 'N').length : 0;
    const n0 = nN(), a0 = a.t().auction.length, b0 = a.t().board;
    await until(() => { const t = a.t(); if (nN() > n0 || t.board > b0 || t.auction.length > a0 + 2 || t.phase === 'done') return true; humanMove({ S: a }); return false; }, 15000, 300);
    check(nN() > n0 || a.t().board > b0 || a.t().auction.length > a0 + 2 || a.t().phase === 'done', 'the stand-in plays on for North');
    const b2 = await client(code, 'Bob'); await sleep(500);
    check(!(a.t().subs && a.t().subs.N) && !(a.t().away && a.t().away.N) && a.chat.some(x => /Bob is back/.test(x.text)), 'Bob comes back and takes over from the robot');
    b2.close();
    // nobody else here: no stand-in (Alice leaves too, and the table just waits)
  } else console.log('skip  automatic stand-in (start the server with --var TEST_TIME_SCALE:0.0167)');
  a.close();
}

// ---------- 5. lobby: an empty public table drops out of the list
{
  const code = await open('Lena', { priv: false });
  const a = await client(code, 'Lena'); await sleep(300);
  a.close(); await sleep(3500);
  let row = (await (await fetch(BASE + '/api/tables')).json()).tables.find(x => x.code === code);
  check(row && row.people === 0, 'the lobby shows nobody at a table everyone has left (' + (row && row.people) + ')');
  // with TEST_TIME_SCALE 0.0167, 30 minutes last half a minute
  await sleep(31000);
  row = (await (await fetch(BASE + '/api/tables')).json()).tables.find(x => x.code === code);
  if (!row) {
    check(true, 'an empty idle table drops out of the lobby');
    const z = await client(code, 'Zoe'); await sleep(3500);
    row = (await (await fetch(BASE + '/api/tables')).json()).tables.find(x => x.code === code);
    check(row && row.people === 1, '... and comes back when someone opens it');
    z.close();
  } else console.log('skip  empty table leaving the lobby (needs TEST_TIME_SCALE)');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
