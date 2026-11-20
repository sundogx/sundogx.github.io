// A table whose Durable Object is thrown out of memory (hibernation, eviction, a deploy) mid-board, with a robot's
// move pending: it must come back with the same board, chat and record, and the robots must go on by themselves.
// wrangler dev can't hibernate an object on demand, so this kills and restarts its own server on the same
// storage (the closest thing: memory is lost, storage and alarms stay; connections drop, so pages reconnect).
//   node tests/online-restart.test.mjs            (starts `npx wrangler dev` on PORT, default 8961)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { auctionTurn, playTurn } = createRequire(import.meta.url)('../js/engine.js');

const PORT = Number(process.env.PORT) || 8961, BASE = `http://localhost:${PORT}`, WS = `ws://localhost:${PORT}`;
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..'), STATE = mkdtempSync(join(tmpdir(), 'bridge-restart-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = s => s.padEnd(20, 'x');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const until = async (cond, ms, step = 50) => { for (let i = 0; i < ms / step; i++) { if (await cond()) return true; await sleep(step); } return !!(await cond()); };

let srv = null;
async function start() {
  srv = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', STATE, '--var', 'TEST_STALE_MS:3000'], { cwd: DIR, stdio: 'ignore', detached: true });
  const up = await until(async () => { try { return (await fetch(BASE + '/api/tables')).ok; } catch (e) { return false; } }, 60000, 300);
  if (!up) throw new Error('server did not start');
}
async function stop() { try { process.kill(-srv.pid, 'SIGKILL'); } catch (e) { } await sleep(1500); }

async function client(code, name) {
  const c = { name, errs: [], st: null, chat: [], closed: false, ws: new WebSocket(`${WS}/api/table/${code}/ws`) };
  c.ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') { c.st = m; c.chat = (m.chatFull ? [] : c.chat).concat(m.chat || []); if (m.hist) c.hist = (m.histFrom ? (c.hist || []).slice(0, m.histFrom) : []).concat(m.hist); }
    else if (m.type === 'error') c.errs.push(m.msg);
  };
  c.ws.onclose = () => { c.closed = true; clearInterval(c.ping); };
  c.ws.onerror = () => { };
  await new Promise((r, j) => { c.ws.onopen = r; c.ws.onerror = j; });
  c.ws.send(JSON.stringify({ type: 'hello', secret: sec(name.toLowerCase()), name }));
  c.ping = setInterval(() => { if (c.ws.readyState === 1) c.ws.send('ping'); }, 300);
  c.act = (n, ...args) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'act', name: n, args })); };
  c.t = () => c.st && c.st.t;
  c.close = () => { clearInterval(c.ping); try { c.ws.close(); } catch (e) { } };
  await until(() => c.st, 5000);
  return c;
}
const moves = t => t.auction.length + t.play.tricks.reduce((n, x) => n + x.cards.length, 0);
const waiting = t => t.phase === 'auction' ? auctionTurn(t.dealer, t.auction) : t.phase === 'play' ? playTurn(t.play, t.contract) : null;

try {
  await start();
  const code = (await (await fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: sec('alice'), name: 'Alice', priv: true }) })).json()).code;
  let a = await client(code, 'Alice');
  a.act('settings', { friends: false }); await sleep(150);
  for (const s of ['N', 'E', 'W']) { a.act('robot', s); await sleep(150); }
  await until(() => a.t().phase === 'auction', 3000);
  // finish one board quickly (Alice concedes as soon as she can), so there is a record to keep
  await until(() => { const t = a.t(); if (t.phase === 'done') return true; if (t.phase === 'auction' && waiting(t) === 'S') a.act('call', t.auction.some(x => x.call !== 'P') ? 'P' : '1C');
    if (t.phase === 'play' && !t.claim && (waiting(t) === 'S' || (waiting(t) === 'N' && t.contract.declarer === 'S'))) a.act('claim', 0); return false; }, 60000, 200);
  a.act('chat', 'before the restart'); await sleep(300);
  a.act('next');
  await until(() => a.t().phase === 'auction' && waiting(a.t()) === 'S', 8000, 100);
  const before = { version: a.t().version, board: a.t().board, hist: (a.hist || []).length, chat: a.chat.length };
  // Alice calls, so a robot's call is pending (0.65 s), and the server dies at once
  a.act('call', 'P'); await sleep(60);
  const m0 = moves(a.t());
  await stop();
  check(await until(() => a.closed, 3000), 'the connection drops with the server');
  await start();
  // nobody connects for a while: the stored alarm must play the pending robot calls by itself
  await sleep(4000);
  a = await client(code, 'Alice'); await sleep(300);
  const t = a.t();
  check(!!t, 'the table is still there after the restart');
  check(t && t.board === before.board && (a.hist || []).length === before.hist, `same board and record (board ${t && t.board}, ${(a.hist || []).length} finished)`);
  check(a.chat.some(m => m.text === 'before the restart'), 'the chat came back');
  check(t && t.version >= before.version, 'the version did not go backwards');
  check(t && moves(t) > m0, `the robots played on by themselves after the restart (${t && moves(t) - m0} moves; waiting for ${t && waiting(t)})`);
  check(t && !(t.away && t.away.S) && !(t.subs && t.subs.S), 'Alice is back in her seat');
  // and the board goes on normally with her
  if (t && waiting(t) === 'S') { const n = moves(t); a.act('call', 'P'); check(await until(() => moves(a.t()) >= n + 2 || a.t().phase !== 'auction', 4000), 'her next call is taken and the robots answer'); }
  // a restart with Alice connected the whole time: she reconnects at once and the robots go on
  await until(() => waiting(a.t()) === 'S' || a.t().phase === 'done', 20000, 100);
  if (a.t().phase !== 'done') {
    a.act(a.t().phase === 'auction' ? 'call' : 'claim', a.t().phase === 'auction' ? 'P' : 0); await sleep(30);
    const m1 = moves(a.t());
    await stop(); await start();
    a = await client(code, 'Alice');
    check(await until(() => moves(a.t()) > m1 || a.t().phase === 'done', 6000, 100), 'reconnected at once: the pending robot move still comes');
  }
  a.close();
} catch (e) { console.error(e); failed++; }
finally { await stop(); }
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
