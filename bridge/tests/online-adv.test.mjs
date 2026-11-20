// Adversarial checks against a running server: what a hostile or careless client can make the table do.
//   BRIDGE_URL=http://localhost:8787 node tests/online-adv.test.mjs
// Takes about half a minute. Works with or without TEST_TIME_SCALE.
const BASE = process.env.BRIDGE_URL || 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const post = body => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function client(code, name) {
  const c = { name, errs: [], st: null, chat: [], thinks: [], states: 0, ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.states++; c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); }
    else if (m.type === 'error') c.errs.push(m.msg);
    else if (m.type === 'notfound') c.notfound = m;
    else if (m.type === 'think') c.thinks.push(m);
  };
  await new Promise((r, j) => { c.ws.onopen = r; c.ws.onerror = j; });
  c.ws.send(JSON.stringify({ type: 'hello', secret: sec(name.toLowerCase()), name }));
  // ping like the page (js/net.js), more often: a server started with TEST_STALE_MS counts a silent connection as gone
  c.ping = setInterval(() => { if (c.ws.readyState === 1) c.ws.send('ping'); }, 400); c.ping.unref();
  c.ws.addEventListener('close', () => clearInterval(c.ping));
  c.act = (n, ...args) => c.ws.send(JSON.stringify({ type: 'act', name: n, args }));
  c.t = () => c.st && c.st.t;
  c.until = async (f, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (c.st && f(c.t())) return true; await sleep(50); } return false; };
  return c;
}
const seesAll = t => ['N', 'E', 'S', 'W'].every(s => t.hands && t.hands[s].every(x => !x.startsWith('?')));

// --- request bodies are read only up to a small limit, even when sent without a length (chunked)
{
  const http = await import('node:http');
  const big = Buffer.from(JSON.stringify({ secret: sec('zed'), name: 'Zed', tableName: 'x'.repeat(8e6) }));
  for (const path of ['/api/tables', '/api/daily']) {
    const status = await new Promise(res => {
      const rq = http.request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, r => { r.resume(); res(r.statusCode); });
      rq.on('error', e => res('error ' + e.message));
      for (let o = 0; o < big.length; o += 65536) rq.write(big.subarray(o, o + 65536));
      rq.end();
    });
    check(status === 400 || status === 413, `an 8 MB body without a length to ${path} is refused (${status})`);
  }
}

// --- an onlooker who saw every hand may not sit down mid-board after the host turns "spectators see all hands" off
{
  const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'adv kib', priv: true })).json();
  const a = await client(code, 'Alice');
  await a.until(t => t.seats.S);
  for (const s of ['N', 'E', 'W']) a.act('robot', s);
  await a.until(t => t.phase === 'auction');
  a.act('settings', { kibSee: true });
  await a.until(t => t.kibSee === true);
  const e = await client(code, 'Eve');
  await e.until(t => t.phase === 'auction');
  check(seesAll(e.t()), 'with kibSee on, an onlooker sees all four hands');
  a.act('kick', 'W'); // a robot removed mid-board leaves the seat empty
  await a.until(t => !t.seats.W);
  a.act('settings', { kibSee: false });
  await a.until(t => t.kibSee === false);
  e.act('sit', 'W'); await sleep(500);
  check(!(a.t().seats.W && a.t().seats.W.name === 'Eve'), 'that onlooker cannot then take the empty seat during the board (' + JSON.stringify(a.t().seats.W) + ')');
  check(e.errs.some(x => /board ends/.test(x)), '... and is told to wait for the board to end');
  a.ws.close(); e.ws.close();
}

// --- friends mode with nobody seated: an onlooker whose browser was handed a robot's cards may not sit down mid-board
{
  const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'adv think', priv: true })).json();
  const a = await client(code, 'Alice');
  await a.until(t => t.seats.S);
  a.act('standUp'); await a.until(t => !t.seats.S);
  const e = await client(code, 'Eve');
  for (const s of ['N', 'E', 'S', 'W']) a.act('robot', s);
  await a.until(t => t.phase === 'auction');
  let asked = null;
  for (let i = 0; i < 400 && !asked; i++) { asked = e.thinks.length ? e : a.thinks.length ? a : null; await sleep(50); }
  check(!!asked, 'an onlooker is asked to work out a robot\'s card when nobody is seated');
  if (asked) {
    const seat = ['N', 'E', 'S', 'W'].find(s => asked.t().seats[s] && asked.t().seats[s].kind === 'robot');
    asked.act('sit', seat); await sleep(500);
    const o = a.t().seats[seat];
    check(a.t().phase !== 'play' || !(o && o.kind === 'human'), 'that onlooker cannot then take a robot\'s seat during the board (' + JSON.stringify(o) + ')');
  }
  a.ws.close(); e.ws.close();
}

// --- connections that never say hello don't make the table resend itself to everyone
{
  const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'adv churn', priv: true })).json();
  const a = await client(code, 'Alice');
  await a.until(t => t.seats.S); await sleep(300);
  const before = a.states;
  for (let i = 0; i < 10; i++) {
    const w = new WebSocket(`${WS}/api/table/${code}/ws`);
    await new Promise(r => { w.onopen = r; w.onerror = r; });
    w.close(); await sleep(60);
  }
  await sleep(800);
  check(a.states - before <= 1, `opening and closing 10 silent connections sends the players ${a.states - before} updates (want 0)`);
  // and opening connections as fast as possible from one address is slowed down
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const w = new WebSocket(`${WS}/api/table/${code}/ws`);
    const ok = await new Promise(r => { w.onopen = () => r(true); w.onerror = () => r(false); });
    if (!ok) refused++; else w.close();
  }
  check(refused > 0, `40 connections in a burst from one address: ${refused} refused`);
  a.ws.close();
}

// --- team match: an onlooker doesn't get the table talk of a board the other room hasn't played
{
  const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'adv match', priv: true, match: true })).json();
  const a = await client(code, 'Alice');
  await a.until(t => t.seats.S);
  for (const s of ['N', 'E', 'W']) a.act('robot', s);
  await a.until(t => t.phase === 'auction');
  const e = await client(code, 'Eve');
  await e.until(t => t.masked);
  a.act('chat', 'spades are 5-0, the slam is off'); await sleep(600);
  check(a.chat.some(m => /5-0/.test(m.text)), 'the players see their own table talk');
  check(!e.chat.some(m => /5-0/.test(m.text)), 'an onlooker of a match board the other room has not played does not get that talk');
  // a hello on an existing connection doesn't resend chat lines already received
  a.ws.close(); e.ws.close();
}

// --- a second hello on a connection does not make the server resend chat lines
{
  const { code } = await (await post({ secret: sec('alice'), name: 'Alice', tableName: 'adv hello', priv: true })).json();
  const a = await client(code, 'Alice');
  await a.until(t => t.seats.S);
  a.act('chat', 'one'); await sleep(300);
  await sleep(2100);
  a.ws.send(JSON.stringify({ type: 'hello', secret: sec('alice'), name: 'Alice' }));
  a.act('chat', 'two'); await sleep(600);
  const ones = a.chat.filter(m => m.text === 'one').length;
  check(ones === 1, `after a second hello the chat line arrives once (${ones})`);
  a.ws.close();
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
