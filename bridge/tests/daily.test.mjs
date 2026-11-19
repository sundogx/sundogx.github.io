// Daily deals results API (feature: daily). Needs a running server:
//   npx wrangler dev --port 8796   then   BRIDGE_URL=http://localhost:8796 node tests/daily.test.mjs
import assert from 'node:assert/strict';
const BASE = (process.env.BRIDGE_URL || 'http://localhost:8796').replace(/\/+$/, '');
const today = new Date().toISOString().slice(0, 10);
const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const ip = '10.' + [1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.'); // a fresh address each run
const post = (body, addr = ip) => fetch(BASE + '/api/daily', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': addr }, body: JSON.stringify(body) });
async function uidOf(secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return 'u' + [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
const tag = rnd().slice(0, 6);
const A = { secret: rnd(), name: 'A' + tag }, B = { secret: rnd(), name: 'B' + tag }, C = { secret: rnd(), name: 'C' + tag };
const c4S = { level: 4, strain: 'S', declarer: 'S', doubled: 0 };

// bad inputs
for (const bad of [{}, { date: '2001-01-01', board: 1, secret: A.secret }, { date: today, board: 5, secret: A.secret },
  { date: today, board: 1, secret: 'short' }, { date: today, board: 1, secret: A.secret, contract: { level: 8, strain: 'S', declarer: 'S' }, declTricks: 10 },
  { date: today, board: 1, secret: A.secret, contract: c4S, declTricks: 14 }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
assert.equal((await fetch(BASE + '/api/daily/2001-01-01')).status, 400);

// board 1 (nobody vulnerable): A makes 4S+1 (+450), B makes 4S (+420), C passes out (0); the score is the server's own
const r = await post({ ...A, date: today, board: 1, contract: c4S, declTricks: 11, scoreNS: 99999 });
assert.equal(r.status, 200, await r.text());
assert.equal((await post({ ...B, date: today, board: 1, contract: c4S, declTricks: 10 })).status, 200);
assert.equal((await post({ ...C, date: today, board: 1, contract: null })).status, 200);
// one result per person per board
assert.equal((await post({ ...A, date: today, board: 1, contract: c4S, declTricks: 13 })).status, 409);
// board 2 (N-S vulnerable): A goes down two doubled (-500), B passes out
assert.equal((await post({ ...A, date: today, board: 2, contract: { level: 3, strain: 'N', declarer: 'N', doubled: 1 }, declTricks: 7 })).status, 200);
assert.equal((await post({ ...B, date: today, board: 2, contract: null })).status, 200);

const lb = await (await fetch(`${BASE}/api/daily/${today}?u=${await uidOf(A.secret)}`)).json();
const mine = n => lb.boards[1].rows.find(x => x.name === n);
assert.equal(mine(A.name).score, 450); assert.equal(mine(B.name).score, 420); assert.equal(mine(C.name).score, 0);
assert.equal(mine(A.name).you, true); assert.equal(mine(B.name).you, false);
const b2 = lb.boards[2].rows.find(x => x.name === A.name);
assert.equal(b2.score, -500);
if (lb.boards[1].count === 3 && lb.boards[2].count === 2) { // nothing else posted today
  assert.equal(mine(A.name).pct, 100); assert.equal(mine(B.name).pct, 50); assert.equal(mine(C.name).pct, 0);
  assert.equal(b2.pct, 0);
  const oa = lb.overall.find(p => p.name === A.name), ob = lb.overall.find(p => p.name === B.name);
  assert.equal(oa.pct, 50); assert.equal(ob.pct, 75); assert.ok(ob.rank < oa.rank);
}
assert.ok(!JSON.stringify(lb).includes(await uidOf(A.secret)), 'ids are never sent');

// rate limit per address
let limited = false;
for (let i = 0; i < 45 && !limited; i++) limited = (await post({ secret: rnd(), name: 'x', date: today, board: 3, contract: null }, ip)).status === 429;
assert.ok(limited, 'an address is rate limited');

// the table-creation limit counts a whole IPv6 /64 as one address, however its addresses are written
const net = '2001:db8:' + [1, 2].map(() => Math.floor(Math.random() * 65535).toString(16)).join(':');
const mkTable = addr => fetch(BASE + '/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': addr }, body: JSON.stringify({ secret: rnd(), name: 'v6' }) });
let made = 0, v6limited = false;
for (let i = 1; i <= 25 && !v6limited; i++) {
  const r = await mkTable(i % 2 ? `${net}:${i.toString(16)}::1` : `${net.replace(/:0*([0-9a-f])/g, ':0$1')}:0:0:0:${i.toString(16)}`);
  if (r.status === 429) v6limited = true; else { assert.equal(r.status, 200); made++; }
}
assert.ok(v6limited && made === 20, `one /64 is limited together (${made} tables made)`);
assert.equal((await mkTable('2001:db8:ffff:' + Math.floor(Math.random() * 65535).toString(16) + '::1')).status, 200, 'another /64 is not');
console.log('daily: all passed');
