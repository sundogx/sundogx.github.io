// Bridge online: Cloudflare Worker + Durable Objects.
// Each table is one Durable Object (TableRoom). It holds the full deal, checks every move with the
// same rules code as the website (game.js), plays the robots, and sends each person only the cards
// they are allowed to see. A single Lobby object keeps the list of public tables.
import { DurableObject } from 'cloudflare:workers';
import * as G from './game.js';

const { SEATS, A } = G;
const IDLE_DELETE_MS = 3 * 24 * 3600e3; // tables nobody has touched for 3 days are deleted
const LOBBY_MAX_AGE_MS = 12 * 3600e3;   // the lobby lists tables active in the last 12 hours
const MAX_MSG = 4000;
const THINK_MS = 2500;                   // friends mode: how long a robot waits for a player's browser to work out its card
const MAX_BOARDS = 100;                  // finished boards kept per table (keeps the stored record far below the size limit)
const HOST_AWAY_MS = 120e3;              // a host away this long hands the host's job to a seated player who is here
const HELLO_WAIT_MS = 20e3;              // a connection that hasn't said hello by then makes way when the table is full
const AWAY_SUB_MS = 60e3;                // a player away this long, when the table is waiting for them, gets a robot stand-in
const IDLE_UNSTARTED_MS = 24 * 3600e3;   // a public table where no board was ever dealt is deleted after a day
const LOBBY_EMPTY_MS = 30 * 60e3;        // the lobby hides a table with nobody at it once it has been idle this long
const STALE_SOCKET_MS = 150e3;           // a connection with no ping (every 25 s) for this long is probably dead: no think requests
const histSig = h => h.length + ':' + (h.length ? h[h.length - 1].board : 0);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
// The JSON body of a request, read only up to max bytes (a body sent without a length could otherwise be huge):
// the parsed value, or null for too large or not JSON.
async function readJson(req, max = 4000) {
  if (Number(req.headers.get('content-length')) > max) return null;
  if (!req.body) return null;
  const reader = req.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n <= max) parts.push(value); // past max the rest is read and dropped (answering before the body is in upsets some clients)
  }
  if (n > max) return null;
  const buf = new Uint8Array(n); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return null; }
}
const cleanName = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);

async function idFromSecret(secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret)));
  return 'u' + [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
const tableStub = (env, code) => env.TABLE.get(env.TABLE.idFromName(code));
const lobbyStub = env => env.LOBBY.get(env.LOBBY.idFromName('lobby'));

// ---------------- HTTP entry point ----------------
// The web page lives on GitHub Pages, so browsers on these origins may call this server.
const ALLOWED_ORIGINS = ['https://sundogx.github.io', 'http://localhost:8787', 'http://127.0.0.1:8787'];
const corsHeaders = origin => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'vary': 'origin',
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!url.pathname.startsWith('/api/')) return handle(req, env);
    // Pages on other websites must not be able to use this server.
    if (origin && origin !== url.origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
    const res = await handle(req, env);
    if (!origin || res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
    return out;
  },
};

const handle = async (req, env) => {
  {
    const url = new URL(req.url);
    const path = url.pathname;

    // Site owner only: close tables by Durable Object id or table code (needs the ADMIN_TOKEN secret, set with
    // `npx wrangler secret put ADMIN_TOKEN`; without it this route doesn't exist). Body: { ids: [...], codes: [...], lobby: true }.
    if (path === '/api/admin/purge' && req.method === 'POST') {
      const tok = env.ADMIN_TOKEN, got = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
      if (!tok || got.length !== tok.length || got !== tok) return new Response('Not found', { status: 404 });
      const body = await readJson(req, 64000);
      if (!body || typeof body !== 'object' || (body.ids != null && !Array.isArray(body.ids)) || (body.codes != null && !Array.isArray(body.codes))) return json({ error: 'bad request' }, 400);
      const why = 'The site owner closed this table.';
      // (idFromString throws on a malformed id: that counts as one failure, not a crash of the whole request)
      const jobs = [...(body.ids || []).slice(0, 200).map(id => () => env.TABLE.get(env.TABLE.idFromString(String(id)))),
        ...(body.codes || []).slice(0, 200).map(c => () => tableStub(env, String(c)))];
      const res = await Promise.allSettled(jobs.map(async j => j().purge(why)));
      if (body.lobby) await lobbyStub(env).clear();
      return json({ closed: res.filter(r => r.status === 'fulfilled').length, failed: res.filter(r => r.status === 'rejected').length });
    }

    if (path === '/api/tables' && req.method === 'GET') {
      return json({ tables: await lobbyStub(env).list() });
    }

    if (path === '/api/tables' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return json({ error: 'bad request' }, 400);
      const secret = String(body.secret || '');
      const name = cleanName(body.name);
      if (secret.length < 16 || !name) return json({ error: 'name required' }, 400); // checked first: a bad request doesn't use up the hourly allowance
      const ip = req.headers.get('cf-connecting-ip') || 'local';
      if (!(await lobbyStub(env).allowCreate(ipGroup(ip)))) return json({ error: 'too many tables, try again later' }, 429);
      const uid = await idFromSecret(secret);
      const tableName = String(body.tableName || '').trim().slice(0, 30);
      const priv = !!body.priv;
      G.setMe({ id: uid, name });

      // Pick unused codes; a fresh Durable Object refuses init() only if the code is taken.
      const make = async (build) => {
        for (let i = 0; i < 8; i++) {
          const t = build();
          if (await tableStub(env, t.id).init(t)) return t;
        }
        throw new Error('no free code');
      };

      if (body.match) {
        const seed = 'm' + [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        const closedCode = G.rid(5), openCode = G.rid(5);
        const base = tableName || 'Team match';
        const closed = G.newTable({ name: base + ', Closed room', priv });
        const open = G.newTable({ name: base + ', Open room', priv });
        closed.id = closedCode; open.id = openCode;
        closed.kibSee = open.kibSee = false; // onlookers could pass on hands the other room is about to play
        closed.seed = open.seed = seed;
        open.match = { id: open.id, room: 'Open', otherCode: closed.id };
        closed.match = { id: open.id, room: 'Closed', otherCode: open.id };
        open.seats.S = { kind: 'human', id: uid, name };
        G.sysMsg(open, `${name} opened the match. The Closed room code is ${closed.id}.`);
        G.sysMsg(closed, `Match opened by ${name}. The Open room code is ${open.id}.`);
        const clash = () => json({ error: 'code clash, try again' }, 503);
        if (!(await tableStub(env, closed.id).init(closed))) return clash();
        if (!(await tableStub(env, open.id).init(open))) { // don't leave the Closed room open on its own
          await tableStub(env, closed.id).closeBy(uid).catch(e => console.error(e));
          return clash();
        }
        return json({ code: open.id });
      }

      let t;
      try { t = await make(() => {
        const t = G.newTable({ name: tableName, priv });
        t.host = t.createdBy = uid; // (G's current person may have changed during the await of an earlier try)
        t.seats.S = { kind: 'human', id: uid, name };
        G.sysMsg(t, `${name} opened the table`);
        return t;
      }); } catch (e) { console.error(e); return json({ error: 'could not open a table, try again' }, 503); }
      return json({ code: t.id });
    }

    const m = path.match(/^\/api\/table\/([A-Z]{5})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return tableStub(env, m[1]).fetch(req);
    }

    /* feature: daily */
    if (path === '/api/daily' || path.startsWith('/api/daily/')) {
      try { return await dailyRoute(req, env, path); } catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
    }

    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    // Anything else is a page or file; the static assets in /public answer those.
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  }
};

// ---------------- one bridge table ----------------
// Server-side checks on top of the shared rules. The acting person's seat always comes from
// their identity, never from the message, so nobody can bid or play for someone else.
const live = t => t.phase === 'auction' || t.phase === 'play';
// Once a board is under way nobody may take a different seat, or they could look at more than one hand.
// Returns why someone may not take a seat right now, or null if they may.
const seatBlock = (t, uid, seat) => {
  if (!live(t)) return null;
  const mine = SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === uid);
  if (mine && mine !== seat) return 'A board is in progress. You can only sit in your own seat until it ends.';
  const prev = t.left && Object.hasOwn(t.left, uid) ? t.left[uid] : null;
  if (prev) return prev === seat ? null : 'A board is in progress. You can only sit in your own seat until it ends.';
  // never seated this board: anyone who could watch all four hands waits for the next board
  // (kibSeen: onlookers saw hands this board anyway: the host turned that off mid-board, or in friends mode a
  // robot's cards went to an onlooker's browser)
  if (!mine && (t.kibSee !== false || t.kibSeen === t.board)) return 'Onlookers can see every hand, so you can sit down when this board ends.';
  return null;
};
const markLeft = (t, uid, seat) => { if (live(t) && uid) t.left = { ...(t.left || {}), [uid]: seat }; };
const MAX_REQUESTS = 20;
const MAX_SOCKETS = 80;    // connections per table (players, onlookers, and ones that haven't said hello yet)
const MAX_ONLOOKERS = 60;  // onlookers' connections per table, so players can always get in
const MAX_PER_IP = 12;     // connections per table from one address
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const TIME_UP = "Time's up for this board, so the robots are finishing it.";
// TEST_TIME_SCALE (only set for automated tests) shortens the time limits and the host's away time, e.g. 0.0167 makes a minute one second.
let timeScale = 1;
// How long a connection may go without a ping or a message before the table counts it as gone (TEST_STALE_MS for tests).
let staleMs = STALE_SOCKET_MS;
const idleLimit = t => !t.private && !t.board ? IDLE_UNSTARTED_MS : IDLE_DELETE_MS;
const deadline = t => (t.boardLimit && t.boardStart && live(t) && !t.timeUp) ? t.boardStart + t.boardLimit * 60e3 * timeScale : null;
const ACTIONS = {
  sit: (t, u, seat) => {
    if (!SEATS.includes(seat)) return false;
    const why = seatBlock(t, u.uid, seat); if (why) return G.fail(why);
    const o = t.seats[seat];
    // Locked table: ask the host instead of sitting straight down.
    if (t.locked && t.host !== u.uid && !(o && o.kind === 'human')) {
      if (G.mySeat(t)) return false;
      if (Object.keys(t.requests || {}).length >= MAX_REQUESTS) return false;
      t.requests = { ...(t.requests || {}), [u.uid]: { name: u.name, seat, at: Date.now() } };
      return 'requested';
    }
    return A.sit(t, seat);
  },
  grant: (t, u, uid) => {
    const r = typeof uid === 'string' && t.requests && Object.hasOwn(t.requests, uid) ? t.requests[uid] : null;
    if (t.host !== u.uid || !r) return false;
    if (seatBlock(t, uid, r.seat)) return G.fail('A board is in progress. That player can sit down when it ends.');
    const o = t.seats[r.seat];
    if (o && o.kind === 'human') return false;
    for (const s of SEATS) { const x = t.seats[s]; if (x && x.kind === 'human' && x.id === uid) t.seats[s] = null; }
    t.seats[r.seat] = { kind: 'human', id: uid, name: r.name };
    delete t.requests[uid];
    G.sysMsg(t, `The host seated ${r.name} ${G.SEAT_NAME[r.seat]}`);
    if (SEATS.every(s => t.seats[s]) && t.board === 0) G.startBoard(t);
  },
  decline: (t, u, uid) => {
    if (t.host !== u.uid || typeof uid !== 'string' || !t.requests || !Object.hasOwn(t.requests, uid)) return false;
    delete t.requests[uid];
  },
  robot: (t, u, seat) => SEATS.includes(seat) && (G.mySeat(t) || t.host === u.uid) ? A.robot(t, seat) : false,
  standUp: (t, u) => { const s = G.mySeat(t), r = A.standUp(t); if (r !== false) markLeft(t, u.uid, s); return r; },
  kick: (t, u, seat) => {
    if (!SEATS.includes(seat)) return false;
    const o = t.seats[seat], r = A.kick(t, seat);
    if (r !== false && o && o.kind === 'human') {
      markLeft(t, o.id, seat);
      // mid-board a robot takes over the seat: nobody new could sit there before the board ends (onlookers may have seen every hand)
      if (live(t)) { t.seats[seat] = { kind: 'robot' }; G.sysMsg(t, `A robot takes ${G.SEAT_NAME[seat]}`); }
    }
    return r;
  },
  settings: (t, u, patch) => {
    if (!patch || typeof patch !== 'object') return false;
    const p = {};
    for (const k of ['locked', 'allowUndo', 'kibSee', 'undoAsk', 'friends']) if (k in patch) p[k] = !!patch[k];
    if (t.match && p.kibSee) delete p.kibSee; // onlookers could pass on hands the other room is about to play
    if ('boardLimit' in patch) { const v = +patch.boardLimit; if ([0, 5, 7, 10, 15].includes(v)) p.boardLimit = v; }
    // friends mode hands the robots' cards to a player's browser: never at a public table, where that could be a stranger's
    if (!t.private && 'friends' in p) { delete p.friends; if (!Object.keys(p).length) return G.fail('Friends mode is only for private tables'); }
    if (!Object.keys(p).length) return false;
    if (live(t) && t.kibSee !== false && p.kibSee === false) t.kibSeen = t.board;
    const r = A.settings(t, p);
    if (r !== false && 'undoAsk' in p) G.sysMsg(t, p.undoAsk ? 'Undo now needs the opponents\' agreement' : 'Undo no longer needs the opponents\' agreement');
    return r;
  },
  // A redeal is only for a board nobody has bid on, and never in a team match (its deals are fixed).
  redeal: (t, u) => t.host !== u.uid ? G.fail('Only the host can redeal') : (t.seed || t.auction.length) ? false : A.redeal(t),
  call: (t, u, call, alert) => {
    if (t.timeUp) return G.fail(TIME_UP);
    const s = G.mySeat(t); if (!s || typeof call !== 'string') return false;
    return A.call(t, s, call, alert ? String(alert).slice(0, 60) : null);
  },
  card: (t, u, seat, card) => {
    if (t.timeUp) return G.fail(TIME_UP);
    const s = G.mySeat(t);
    if (!s || !SEATS.includes(seat) || typeof card !== 'string' || G.controllerOf(t, seat) !== s) return false;
    return A.card(t, seat, card);
  },
  claim: (t, u, n, left) => { // left (optional): the tricks left when the claimer chose n
    if (t.timeUp) return G.fail(TIME_UP); const s = G.mySeat(t); return s && Number.isInteger(n) ? A.claim(t, s, n, Number.isInteger(left) ? left : null) : false; },
  respond: (t, u, accept) => { const s = G.mySeat(t); return s ? A.respond(t, s, !!accept) : false; },
  cancelClaim: t => { const s = G.mySeat(t); return s ? A.cancelClaim(t, s) : false; },
  chat: (t, u, text) => {
    const v = String(text ?? '').trim().slice(0, 200);
    if (!v) return false;
    const r = A.chat(t, v);
    // Spectators can't pass information to the players during a board: their messages go to other spectators.
    if (r !== false && !G.mySeat(t) && (t.phase === 'auction' || t.phase === 'play')) t.chat[t.chat.length - 1].kib = true;
    return r;
  },
  // opt.replay (host only): deal that finished board again, with its dealer and vulnerability (not in a team match)
  next: (t, u, opt) => {
    if (!(G.mySeat(t) || t.host === u.uid)) return false;
    if (opt && typeof opt === 'object' && 'replay' in opt) {
      if (t.host !== u.uid) return G.fail('Only the host can deal a board again');
      if (t.seed) return G.fail('A team match plays its own fixed deals');
      const rec = t.history.find(h => h.board === opt.replay);
      if (!SEATS.every(s => t.seats[s])) return G.fail('Fill the empty seat first (a player or a robot)');
      return rec ? A.next(t, rec) : G.fail('That board is no longer in the record');
    }
    // a board with an empty seat could never finish: a newcomer can't sit down mid-board when onlookers see every hand
    if (t.phase === 'done' && !SEATS.every(s => t.seats[s])) return G.fail('Fill the empty seat first (a player or a robot)');
    return A.next(t);
  },
  // Between boards the host can swap two seats (people or robots, or a seat and an empty one), or move
  // everyone one seat clockwise (swap('rotate')), e.g. to play a deal again from the other side.
  swap: (t, u, a, b) => {
    if (t.host !== u.uid) return G.fail('Only the host can move players');
    if (live(t)) return G.fail('Players can change seats when this board ends');
    let to; // new seat -> old seat
    if (a === 'rotate') to = Object.fromEntries(SEATS.map((s, i) => [SEATS[(i + 1) % 4], s]));
    else if (SEATS.includes(a) && SEATS.includes(b) && a !== b && (t.seats[a] || t.seats[b])) to = Object.fromEntries(SEATS.map(s => [s, s === a ? b : s === b ? a : s]));
    else return false;
    const seats = t.seats, away = t.away || {}, subs = t.subs || {};
    t.seats = {}; t.away = {}; t.subs = {};
    for (const s of SEATS) {
      const f = to[s]; t.seats[s] = seats[f];
      if (away[f]) t.away[s] = away[f];
      if (subs[f]) t.subs[s] = subs[f];
    }
    G.sysMsg(t, a === 'rotate' ? 'The host moved everyone one seat clockwise' : `The host swapped ${G.SEAT_NAME[a]} and ${G.SEAT_NAME[b]}`);
    if (SEATS.every(s => t.seats[s]) && t.board === 0) G.startBoard(t);
  },
  // The host hands the job to another seated player.
  makeHost: (t, u, seat) => {
    const o = SEATS.includes(seat) ? t.seats[seat] : null;
    if (t.host !== u.uid || !o || o.kind !== 'human' || o.id === u.uid) return false;
    t.host = o.id; G.sysMsg(t, `${o.name} is now the host`);
  },
  undo: t => {
    if (t.timeUp) return G.fail(TIME_UP);
    const s = G.mySeat(t); if (!s) return false;
    if (t.undoReq) return false;
    // Taking back the opening lead (after seeing dummy), or a call or card the robots have answered since,
    // always needs the human opponents' agreement; other undos only when the host asks for it.
    const reveals = G.undoReveals(t, s);
    if (!t.undoAsk && !reveals) return A.undo(t, s);
    // check the undo is possible, then ask the human opponents
    const probe = structuredClone(t);
    if (A.undo(probe, s) === false) return false;
    const opp = SEATS.filter(x => !sameSideSeat(x, s) && t.seats[x] && t.seats[x].kind === 'human');
    const humans = opp.filter(x => !(t.subs && t.subs[x]));
    if (reveals && humans.length < opp.length) return G.fail('An opponent is away, and this undo needs their agreement.');
    if (!humans.length) return A.undo(t, s);
    t.undoReq = { by: s, need: humans, mark: progressMark(t) };
    G.sysMsg(t, `${G.SEAT_NAME[s]} asks to undo`);
  },
  undoReply: (t, u, accept) => {
    const s = G.mySeat(t), r = t.undoReq;
    if (!s || !r || !r.need.includes(s)) return false;
    if (!accept) { t.undoReq = null; G.sysMsg(t, `${G.SEAT_NAME[s]} declined the undo`); return; }
    r.need = r.need.filter(x => x !== s);
    if (r.need.length) return;
    t.undoReq = null;
    if (A.undo(t, r.by) === false) { G.takeError(); G.sysMsg(t, 'The undo is no longer possible, so play continues'); }
  },
  undoCancel: t => { const s = G.mySeat(t); if (!t.undoReq || t.undoReq.by !== s) return false; t.undoReq = null; G.sysMsg(t, `${G.SEAT_NAME[s]} withdrew the undo request`); },
  // Let a robot play for a player who lost their connection, until they come back.
  sub: (t, u, seat) => {
    const mine = G.mySeat(t), o = t.seats[seat];
    if (!mine || !SEATS.includes(seat) || seat === mine || !o || o.kind !== 'human' || !(t.away && t.away[seat])) return false;
    // an opponent has to wait a little in case the page was only refreshed
    if (!sameSideSeat(seat, mine) && t.host !== u.uid && Date.now() - t.away[seat] < 30e3) return G.fail('Give them half a minute to come back first.');
    if (t.subs && t.subs[seat]) return false;
    t.subs = { ...(t.subs || {}), [seat]: true };
    G.sysMsg(t, `A robot is playing for ${G.SEAT_NAME[seat]} until ${o.name} comes back`);
  },
};

const sameSideSeat = (a, b) => ((SEATS.indexOf(a) - SEATS.indexOf(b)) & 1) === 0;
const progressMark = t => t.board + ':' + t.auction.length + ':' + t.play.tricks.reduce((n, tr) => n + tr.cards.length, 0);

// Team match: the result line of a board ("Board 1: 3NT +1 ...") is held back from onlookers until both rooms
// have played it; then a copy that only onlookers get is added. Returns how many lines were added.
function announceBoth(t, other) {
  if (!t.match) return 0;
  const both = new Set(other.map(h => h.board));
  let n = 0;
  for (const h of t.history) {
    if (h.board <= (t.announced || 0) || !both.has(h.board)) continue;
    t.announced = h.board;
    const line = t.chat.find(m => m.res === h.board && !m.kib);
    if (line) { t.chat.push({ sys: true, text: line.text, ts: Date.now(), kib: true }); n++; }
  }
  if (t.chat.length > 120) t.chat.splice(0, t.chat.length - 120);
  return n;
}

// Seat a human who's back, mark one who left, and keep stand-in robots tidy.
function tidyPresence(t) {
  // an undo request lapses as soon as anyone bids or plays
  if (t.undoReq && t.undoReq.mark !== progressMark(t)) t.undoReq = null;
  t.away = t.away || {}; t.subs = t.subs || {};
  if (!live(t) && t.left) t.left = {};
  for (const s of SEATS) {
    const o = t.seats[s];
    if (!o || o.kind !== 'human') { delete t.away[s]; delete t.subs[s]; }
  }
  const human = s => { const o = t.seats[s]; return !!(o && o.kind === 'human'); };
  // An undo request lapses if the person who asked, or one who has to agree, is no longer seated.
  if (t.undoReq && (!human(t.undoReq.by) || t.undoReq.need.some(s => !human(s)))) {
    t.undoReq = null; G.sysMsg(t, 'The undo request lapsed because a seat changed');
  }
  // ... or when a robot stands in for someone who has to agree (a robot doesn't agree to undos)
  if (t.undoReq && t.undoReq.need.some(s => t.subs[s])) { t.undoReq = null; G.sysMsg(t, 'The undo request lapsed because a robot is playing for an opponent'); }
  // A claim lapses if the claimer's seat is empty; a robot (table robot or stand-in) answers for its seat, with the
  // exact double-dummy check (G.claimAccept). Robots claim themselves in A.robotStep (js/table.js robotClaim).
  if (t.claim && !t.seats[G.controllerOf(t, t.claim.by)]) { t.claim = null; G.sysMsg(t, 'The claim lapsed because the claimer left. Play continues.'); }
  const c = t.claim;
  if (c) for (const s of c.need) {
    // as in resolveRobotClaim (js/table.js): the claimer's partner answers for themself, even as dummy
    // (a robot declarer must not accept its own claim for a human dummy)
    const ctrl = sameSideSeat(s, c.by) ? s : G.controllerOf(t, s), o = t.seats[ctrl];
    if ((t.subs[ctrl] || (o && o.kind === 'robot')) && !c.acc[s] && t.claim) {
      const ok = G.claimAnswer(t, c.by, c.tricks);
      G.setMe({ id: '' });
      A.respond(t, s, ok);
      if (!ok) t.chat[t.chat.length - 1].text = `The robot ${t.subs[ctrl] ? 'playing for' : 'at'} ${G.SEAT_NAME[s]} rejected the claim. Play continues.`;
    }
  }
}

// The host's job passes to a seated player who is here when the host has been away for HOST_AWAY_MS,
// or isn't at the table at all (not seated and no open connection, e.g. the Closed room of a match they opened).
// here: the people with an open connection. Checked on every change, so it happens with the next action.
function passHost(t, here) {
  const seated = SEATS.filter(s => t.seats[s] && t.seats[s].kind === 'human');
  const hs = seated.find(s => t.seats[s].id === t.host);
  const gone = hs ? !!(t.away && t.away[hs] && Date.now() - t.away[hs] >= HOST_AWAY_MS * timeScale) : !here.has(t.host);
  if (!gone) return;
  const to = seated.find(s => t.seats[s].id !== t.host && here.has(t.seats[s].id) && !(t.away && t.away[s]));
  if (!to) return;
  t.host = t.seats[to].id;
  G.sysMsg(t, `${t.seats[to].name} is now the host, as the host ${hs ? 'is away' : 'isn\'t at the table'}`);
}

// When the host's job should pass (see passHost): the host is seated and away, and another seated player is here.
function hostDue(t, here) {
  const hs = SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === t.host);
  if (!hs || !(t.away && t.away[hs])) return null;
  if (!SEATS.some(s => s !== hs && t.seats[s] && t.seats[s].kind === 'human' && here.has(t.seats[s].id) && !t.away[s])) return null;
  return t.away[hs] + HOST_AWAY_MS * timeScale;
}

// The away player the table is waiting for (their turn, or a claim or undo request that needs their answer) and
// when a robot should stand in for them (AWAY_SUB_MS after they left), or null. A stranger who closed the page
// mid-board would otherwise hold up the other three until someone thought of the 'sub' action.
function awayBlocking(t) {
  if (!live(t) || t.timeUp || !t.away) return null;
  let need;
  if (t.claim) need = t.claim.need.filter(s => !t.claim.acc[s]).map(s => sameSideSeat(s, t.claim.by) ? s : G.controllerOf(t, s));
  else if (t.undoReq) need = t.undoReq.need;
  else { const ts = G.turnSeat(t); need = ts ? [G.controllerOf(t, ts)] : []; }
  let best = null;
  for (const s of need) {
    const o = t.seats[s];
    if (!o || o.kind !== 'human' || !t.away[s] || (t.subs && t.subs[s])) continue;
    const at = t.away[s] + AWAY_SUB_MS * timeScale;
    if (!best || at < best.at) best = { seat: s, id: o.id, at };
  }
  return best;
}

export class TableRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    { const v = Number(env.TEST_TIME_SCALE); if (v > 0) timeScale = v; }
    { const v = Number(env.TEST_STALE_MS); if (v > 0) staleMs = v; }
    this.t = null; this.other = []; this.lobbyKey = '';
    this.think = undefined; // friends mode: the open request for a robot's card (undefined: look on the connections, see getThink)
    ctx.blockConcurrencyWhile(async () => {
      this.t = (await ctx.storage.get('t')) || null;
      if (this.t && !this.t.history) this.t.history = (await ctx.storage.get('h')) || [];
      // (a table saved before the chat had its own key has it in 't': the next save moves it)
      const legacyChat = !!(this.t && this.t.chat);
      if (this.t && !this.t.chat) this.t.chat = (await ctx.storage.get('c')) || [];
      this.savedSig = this.t ? histSig(this.t.history) : '';
      this.savedChat = this.t && !legacyChat ? this.t.chatN || 0 : -1;
      this.other = (await ctx.storage.get('other')) || [];
    });
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async init(t) {
    if (this.t) return false;
    this.t = t;
    await this.save();
    this.reportLobby();
    await this.setAlarm(Date.now() + idleLimit(t));
    return true;
  }

  // The other room of a team match sends its finished boards here.
  // It answers with this room's boards, so a room that missed an update (a failed call) catches up next time.
  async setOther(history) {
    await this.gotOther(history);
    return this.t ? this.t.history : null;
  }
  // The other room's boards, for a room that may have missed an update (asked when someone connects, at most twice a minute).
  async getHistory() { return this.t ? this.t.history : null; }
  pullOther() {
    const t = this.t; if (!t || !t.match || Date.now() - (this.pulledAt || 0) < 30e3) return;
    this.pulledAt = Date.now();
    tableStub(this.env, t.match.otherCode).getHistory().then(h => this.gotOther(h)).catch(e => console.error(e));
  }
  async gotOther(history) {
    if (!this.t || !Array.isArray(history) || histSig(history) === histSig(this.other)) return;
    this.other = history;
    await this.ctx.storage.put('other', this.other);
    if (!(await this.apply({}, t => announceBoth(t, this.other) ? undefined : false))) this.broadcast();
  }

  // Close the table for good (the host's 'close' action, or the other room of a match being closed).
  async shutdown(why) {
    if (!this.t) return;
    const code = this.t.id;
    this.t = null; this.other = []; this.think = null;
    await this.ctx.storage.deleteAlarm(); this.alarmAt = null;
    await this.ctx.storage.deleteAll();
    lobbyStub(this.env).remove(code).catch(() => { });
    for (const ws of this.ctx.getWebSockets()) { this.sendTo(ws, { type: 'notfound', closed: true, msg: why }); try { ws.close(1000, 'closed'); } catch (e) { } }
  }
  // Site owner's purge: like shutdown, but also wipes storage when the table never loaded.
  async purge(why) {
    const code = this.t && this.t.id;
    if (this.t) await this.shutdown(why);
    else { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); for (const ws of this.ctx.getWebSockets()) { this.sendTo(ws, { type: 'notfound', closed: true, msg: why }); try { ws.close(1000, 'closed'); } catch (e) { } } }
    return code || null;
  }
  async closeBy(uid) { if (this.t && (this.t.host === uid || this.t.createdBy === uid)) await this.shutdown('The match was closed.'); }
  async closeTable(uid, ws) {
    const t = this.t;
    if (t.host !== uid) { this.sendTo(ws, { type: 'error', msg: 'Only the host can close the table.' }); return; }
    if (t.match) await tableStub(this.env, t.match.otherCode).closeBy(uid).catch(e => console.error(e));
    await this.shutdown('The host closed the table.');
  }

  async fetch(req) {
    this.dropStale(); // (dead connections left by a flaky network would otherwise use up the limits below)
    let socks = this.ctx.getWebSockets().filter(w => w.readyState === 1);
    if (socks.length >= MAX_SOCKETS) { // make room: drop connections that never said who they are
      const now = Date.now();
      for (const w of socks) { const a = w.deserializeAttachment() || {}; if (!a.uid && now - (a.at || 0) > HELLO_WAIT_MS) try { w.close(1008, 'no hello'); } catch (e) { } }
      socks = this.ctx.getWebSockets().filter(w => w.readyState === 1);
    }
    if (socks.length >= MAX_SOCKETS) return new Response('This table is full of onlookers. Try again later.', { status: 429 });
    const ip = req.headers.get('cf-connecting-ip') || '';
    // new connections from one address: 10 at once, then 5 a second (each one that says hello updates everyone)
    if (ip && !this.allow('c:' + ip, false, 0.5)) return new Response('Too many connections from your address. Try again later.', { status: 429 });
    if (ip && socks.filter(w => (w.deserializeAttachment() || {}).ip === ip).length >= MAX_PER_IP) return new Response('Too many connections from your address. Try again later.', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid: null, name: '', sid: hex(8), ip, at: Date.now() }); // sid: this connection, for rate limits
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!this.t) { this.sendTo(ws, { type: 'notfound' }); try { ws.close(1000, 'not found'); } catch (e) { } return; }

    if (m.type === 'hello') {
      const secret = String(m.secret || '');
      if (secret.length < 16) return;
      const prev = ws.deserializeAttachment() || {};
      const now = Date.now();
      if (prev.helloAt && now - prev.helloAt < 2000) return; // one hello every 2 seconds per connection
      const att = { uid: await idFromSecret(secret), name: cleanName(m.name) || 'Player', helloAt: now, sid: prev.sid, ip: prev.ip };
      if (!this.t) return; // the table may have closed while the hash was worked out
      // a full table of onlookers turns further onlookers away (players can always get to their seats)
      if (!SEATS.some(s => this.t.seats[s] && this.t.seats[s].kind === 'human' && this.t.seats[s].id === att.uid) && !(this.t.left && Object.hasOwn(this.t.left, att.uid))) {
        const seated = new Set(SEATS.map(s => this.t.seats[s]).filter(o => o && o.kind === 'human').map(o => o.id));
        const kibs = this.ctx.getWebSockets().filter(w => { if (w === ws || w.readyState !== 1) return false; const a = w.deserializeAttachment() || {}; return a.uid && !seated.has(a.uid) && !this.stale(w, a); }).length;
        if (kibs >= MAX_ONLOOKERS) { this.sendTo(ws, { type: 'error', msg: 'This table is full of onlookers. Try again later.' }); try { ws.close(1008, 'full'); } catch (e) { } return; }
      }
      const cur = ws.deserializeAttachment() || {}; // (read again: a broadcast during the hash may have moved this connection's sync on)
      if (cur.uid && cur.uid !== att.uid) { att.hl = 0; att.ol = 0; att.cl = 0; } // a new identity starts its sync from scratch
      else { att.hl = cur.hl || 0; att.hb = cur.hb; att.ol = cur.ol || 0; att.ob = cur.ob; att.cl = cur.cl || 0; }
      ws.serializeAttachment(att);
      G.setMe({ id: att.uid });
      const seat = G.mySeat(this.t);
      if (seat && ((this.t.away && this.t.away[seat]) || (this.t.subs && this.t.subs[seat]) || this.t.seats[seat].name !== att.name)) {
        await this.apply(att, t => {
          const wasSub = t.subs && t.subs[seat];
          if (t.away) delete t.away[seat];
          if (t.subs) delete t.subs[seat];
          t.seats[seat].name = att.name;
          if (wasSub) G.sysMsg(t, `${att.name} is back and has taken over from the robot`);
        });
        return;
      }
      // a seated player whose connection went without a close (see apply) gets marked away now
      if (SEATS.some(s => { const o = this.t.seats[s]; return o && o.kind === 'human' && !(this.t.away && this.t.away[s]) && !this.here().has(o.id); })) { await this.apply(att, () => { }); return; }
      this.broadcast(); // new viewer gets the table; everyone gets the new watcher count
      this.reportLobby();
      this.pullOther();
      if (!this.robotPending()) await this.planAlarm(); // someone to play on with an away player: their stand-in may be due
      return;
    }

    let u = ws.deserializeAttachment() || {};
    if (u.uid && Date.now() - (u.seen || 0) > Math.min(20e3, staleMs / 4)) { u = { ...u, seen: Date.now() }; ws.serializeAttachment(u); } // (see stale)
    if (u.uid && m.type === 'thought') { this.thought(m, u, ws); return; }
    if (!u.uid || m.type !== 'act') return;
    // rate limits per person and per connection (a new identity on the same connection gets no fresh allowance)
    const isChat = m.name === 'chat';
    // (and per address, more loosely, as friends at home share one: new identities are free to make)
    if (!this.allow('u:' + u.uid, isChat) || (u.sid && !this.allow('s:' + u.sid, isChat)) || (u.ip && !this.allow('i:' + u.ip, isChat, 3))) { this.sendTo(ws, { type: 'error', msg: 'Slow down a little, then try again.' }); return; }
    if (m.name === 'close') { await this.closeTable(u.uid, ws); return; }
    const fn = typeof m.name === 'string' && Object.hasOwn(ACTIONS, m.name) ? ACTIONS[m.name] : null;
    if (!fn) return;
    const args = Array.isArray(m.args) ? m.args.slice(0, 3) : [];
    await this.apply(u, t => fn(t, u, ...args), ws);
  }

  async webSocketClose(ws) {
    try { ws.close(1000); } catch (e) { }
    await this.leftSocket(ws);
  }
  async webSocketError(ws) { await this.leftSocket(ws); }

  // If that was a seated player's last open connection, mark them away.
  async leftSocket(ws) {
    if (!this.t) return;
    const a = ws.deserializeAttachment() || {};
    G.setMe({ id: a.uid || '' });
    const seat = a.uid ? G.mySeat(this.t) : null;
    const stillHere = a.uid && this.ctx.getWebSockets().some(x => { if (x === ws || x.readyState !== 1) return false; const b = x.deserializeAttachment() || {}; return b.uid === a.uid && !this.stale(x, b); });
    if (seat && !stillHere && !(this.t.away && this.t.away[seat])) {
      await this.apply(a, t => { t.away = { ...(t.away || {}), [seat]: Date.now() }; }, null, ws);
    } else if (a.uid && !stillHere && this.t.requests && this.t.requests[a.uid]) {
      await this.apply(a, t => { delete t.requests[a.uid]; }, null, ws); // left before the host answered
    } else if (a.uid) this.broadcast(ws); // (a connection that never said hello changes nothing anyone sees)
    this.reportLobby();
  }

  // Run one action on a copy of the table; keep it only if the rules accepted it.
  async apply(u, run, ws, exclude) {
    if (!this.t) return false; // closed meanwhile (shutdown)
    const { history: oldHistory, ...rest } = this.t;   // the history only ever grows, so it is copied, not deep-cloned
    const t = structuredClone(rest);
    t.history = oldHistory.slice();
    const sigBefore = histSig(oldHistory);
    G.setMe({ id: u.uid || '', name: u.name || '' });
    let r;
    try { r = run(t); } catch (e) { console.error(e); r = false; }
    if (r !== false) announceBoth(t, this.other);
    const err = G.takeError();
    if (r === 'requested' && ws) this.sendTo(ws, { type: 'error', msg: 'The seats are locked, so the host has been asked to seat you.' });
    if (r === false) { if (err && ws) this.sendTo(ws, { type: 'error', msg: err }); return false; }
    tidyPresence(t);
    this.dropStale();
    const here = this.here();
    // A seated player with no open connection is away, even if their close was never reported (a server restart
    // drops connections without telling the table), so their stand-in can come in time.
    t.away = t.away || {};
    for (const s of SEATS) { const o = t.seats[s]; if (o && o.kind === 'human' && !here.has(o.id) && !t.away[s] && o.id !== u.uid) t.away[s] = Date.now(); }
    passHost(t, here);
    // number chat lines so each connection only receives the new ones
    t.chatN = t.chatN || 0;
    for (const m of t.chat) if (!m.n) m.n = ++t.chatN;
    t.version = (t.version || 0) + 1; t.updatedAt = Date.now();
    if (t.history.length > MAX_BOARDS) t.history.splice(0, t.history.length - MAX_BOARDS);
    const prev = this.t;
    this.t = t;
    try { await this.save(); }
    catch (e) { // keep memory and storage in step: the move did not happen
      console.error('save failed', e);
      this.t = prev;
      if (ws) this.sendTo(ws, { type: 'error', msg: 'Could not save that move. Please try again.' });
      return false;
    }
    this.broadcast(exclude);
    this.reportLobby();
    if (t.match && histSig(t.history) !== sigBefore) {
      tableStub(this.env, t.match.otherCode).setOther(t.history).then(h => this.gotOther(h)).catch(e => console.error(e));
    }
    await this.scheduleRobot();
    return true;
  }

  // The people with an open connection that has said hello.
  here() {
    const s = new Set();
    for (const w of this.ctx.getWebSockets()) { const a = w.deserializeAttachment(); if (a && a.uid && w.readyState === 1 && !this.stale(w, a)) s.add(a.uid); }
    return s;
  }

  // Simple flood protection: about 10 actions a second, and 5 chat messages per 10 seconds, per person and per connection.
  // k scales the allowance (per address).
  allow(key, isChat, k = 1) {
    this.rate = this.rate || new Map();
    const now = Date.now();
    let b = this.rate.get(key);
    if (!b) { b = { tokens: 20 * k, at: now, chat: [] }; this.rate.set(key, b); }
    b.tokens = Math.min(20 * k, b.tokens + k * (now - b.at) / 100); b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (isChat) { b.chat = b.chat.filter(x => now - x < 10000); if (b.chat.length >= 5 * k) return false; b.chat.push(now); }
    if (this.rate.size > 400) for (const [k, x] of this.rate) if (now - x.at > 10000) this.rate.delete(k); // forget idle ones only
    if (this.rate.size > 1000) for (const k of [...this.rate.keys()].slice(0, 500)) this.rate.delete(k);
    return true;
  }

  // Every move writes the table itself (a few KB). The finished boards (up to ~200 KB) are written only when
  // one is added, and the chat (up to ~20 KB) only when a line is added (chatN counts the lines), not with every card.
  async save() {
    const t = this.t, { history, chat, ...rest } = t;
    const puts = { t: rest }, sig = histSig(history), cn = t.chatN || 0;
    if (sig !== this.savedSig) puts.h = history;
    if (cn !== this.savedChat) puts.c = chat;
    await this.ctx.storage.put(puts);
    this.savedSig = sig; this.savedChat = cn;
  }

  robotPending() {
    const t = this.t; if (!t || t.claim || t.undoReq) return false;
    const ts = G.turnSeat(t); if (!ts) return false;
    const ctrl = G.controllerOf(t, ts);
    const o = G.occupant(t, ctrl);
    if (t.timeUp && live(t)) return !!o;
    return !!(o && (o.kind === 'robot' || (o.kind === 'human' && t.subs && t.subs[ctrl])));
  }

  async scheduleRobot() {
    if (this.robotPending()) {
      // A robot is already due for this position: keep its time (a chat line or a new watcher mustn't hold it up).
      const mark = progressMark(this.t) + ':' + !!this.t.timeUp, rd = this.robotDue;
      if (rd && rd.mark === mark && Date.now() < rd.due + THINK_MS + 2000) {
        this.askThink(rd.due);
        // the alarm that just fired may have been the robot's own (alarm() handled a silent connection or the host
        // first): arm it again, or the robot would never move
        if (this.alarmAt == null || this.alarmAt < Date.now()) await this.setAlarm(Math.max(Date.now(), rd.due));
        return;
      }
      const tr = this.t.play && this.t.play.tricks[this.t.play.tricks.length - 1];
      const pause = this.t.phase === 'auction' ? 650 : (tr && tr.cards.length === 4 ? 1800 : 1000); // robot card 1 s (was 0.7 s, owner 2026-11-20)
      const scale = Number(this.env.ROBOT_DELAY_SCALE ?? 1); // only changed for automated tests
      const due = Date.now() + pause * (scale >= 0 ? scale : 1);
      this.robotDue = { mark, due };
      this.askThink(due);
      await this.setAlarm(due);
    } else {
      this.robotDue = null;
      await this.planAlarm();
    }
  }
  // No robot to move: wake up when the board's time runs out, when a robot should stand in for an away player
  // the table is waiting for (only if someone else is here to play on), or to delete the table once it is idle.
  async planAlarm() {
    const t = this.t, now = Date.now();
    if (!t) return; // closed while a save was under way
    let at = deadline(t);
    const ab = awayBlocking(t), min = x => { if (x != null) at = at == null ? x : Math.min(at, x); };
    if (ab && this.othersHere(ab.id)) min(ab.at);
    min(this.sweepAt()); // a seated player's connection that may have gone silent
    min(hostDue(t, this.here()));
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm(); // (not known after waking up)
    // An alarm that comes early does no harm (alarm() plans the next one), so it is only moved earlier: no write with every move.
    if (at != null) { at = Math.max(now + 1000, at); if (this.alarmAt == null || this.alarmAt > at || this.alarmAt < now) await this.setAlarm(at); return; }
    // The idle check needs no new write with every move: any alarm already set before the idle time will do,
    // as alarm() works out how long the table has really been idle and sets the next one.
    const idleAt = Math.max(now + 1000, (t.updatedAt || now) + idleLimit(t));
    if (this.alarmAt == null || this.alarmAt > idleAt) await this.setAlarm(idleAt);
  }
  othersHere(uid) {
    return this.ctx.getWebSockets().some(w => { const a = w.deserializeAttachment(); return a && a.uid && a.uid !== uid && w.readyState === 1; });
  }
  async setAlarm(at) { await this.ctx.storage.setAlarm(at); this.alarmAt = at; }

  // Friends mode: the double-dummy solver needs more CPU time than the free plan gives this server, so a
  // player's browser works out the robot's card (js/net.js 'think'). That browser gets the robot's view
  // (its own cards and its partner's if it is declarer). If no answer comes in time, the robot plays its heuristic card.
  askThink(due) {
    const t = this.t, th = this.getThink();
    if (th && t && t.phase === 'play' && th.key === G.playKey(t)) return; // already asked about this position (e.g. a chat line arrived)
    this.think = null;
    if (!t || t.phase !== 'play' || !t.private || !G.friendsMode(t)) return; // never hand a robot's cards to a stranger
    const ts = G.turnSeat(t), o = G.occupant(t, G.controllerOf(t, ts));
    // only a table robot's cards: never a person's (a stand-in for an away player, or the robots finishing when time is up)
    if (!o || o.kind !== 'robot') return;
    let view, prefer;
    try { view = G.ddView(t, ts); if (!G.ddWorthIt(view)) return; prefer = G.botPlayH(t, ts); } // (the heuristic card only: the browser solves the position itself) catch (e) { console.error(e); return; }
    // seated players first (they are likely to stay), taking turns so one slow phone isn't always asked
    const seated = new Set(SEATS.map(s => t.seats[s] && t.seats[s].kind === 'human' ? t.seats[s].id : null).filter(Boolean));
    const socks = this.ctx.getWebSockets().filter(w => { const a = w.deserializeAttachment() || {}; return a.uid && seated.has(a.uid); });
    // (an onlooker only when nobody is seated, and never in a team match: they could pass the cards to the other room)
    let pool = socks.length || t.match ? socks : this.ctx.getWebSockets().filter(w => (w.deserializeAttachment() || {}).uid);
    // a browser that let two requests in a row run out (a phone asleep, a slow device) is asked again only now and then,
    // so the robots don't wait THINK_MS for it on every card
    this.thinkN = (this.thinkN || 0) + 1;
    // (and never a connection that has stopped pinging: a dead one the runtime hasn't noticed yet)
    pool = pool.filter(w => w.readyState === 1 && !this.stale(w));
    const keen = pool.filter(w => ((w.deserializeAttachment() || {}).miss || 0) < 2);
    if (keen.length || this.thinkN % 8) pool = keen;
    if (!pool.length) return;
    const ws = pool[this.thinkN % pool.length];
    const key = G.playKey(t), a = ws.deserializeAttachment() || {};
    // an onlooker who is shown a robot's cards may not then sit down during this board (seatBlock); kept with the next move
    if (!seated.has(a.uid)) t.kibSeen = t.board;
    // Only the browser asked may answer: the position (playKey) is public, so the reply must carry this
    // random nonce (sent only to that browser, as part of the key it echoes) and come from the same person.
    this.think = { key, nonce: hex(12), uid: a.uid, at: Date.now(), due, done: false, card: null };
    // The request is also kept on that connection (free, unlike storage), so it survives the object hibernating.
    try { ws.serializeAttachment({ ...a, th: { key, nonce: this.think.nonce, at: this.think.at, due } }); } catch (e) { }
    this.sendTo(ws, { type: 'think', key: key + '#' + this.think.nonce, view, prefer });
  }
  // A connection that hasn't pinged (js/net.js pings every 25 s; the reply doesn't wake the table) or said
  // anything for STALE_SOCKET_MS. Background tabs ping less often, so this is generous.
  // A phone that goes to sleep, or a network that drops, often leaves the connection open on this side with nobody
  // behind it; the runtime may not notice for a long time. Such a connection doesn't count as being here (here()),
  // and is closed (dropStale), so the player is marked away and a robot can stand in.
  lastSeen(ws, a = ws.deserializeAttachment() || {}) {
    let last = Math.max(a.at || 0, a.helloAt || 0, a.seen || 0);
    try { const p = this.ctx.getWebSocketAutoResponseTimestamp(ws); if (p) last = Math.max(last, +p); } catch (e) { }
    return last;
  }
  stale(ws, a) { return Date.now() - this.lastSeen(ws, a) > staleMs; }
  // Close connections that said hello but have gone silent. Returns true if one was a seated player's.
  dropStale() {
    const t = this.t; let seated = false;
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (!a || !a.uid || w.readyState !== 1 || !this.stale(w, a)) continue;
      try { w.close(1000, 'no ping'); } catch (e) { }
      if (t && SEATS.some(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === a.uid)) seated = true;
    }
    return seated;
  }
  // A seated player who has no live connection but isn't marked away yet.
  unmarkedAway() {
    const t = this.t, here = this.here();
    return SEATS.some(s => { const o = t.seats[s]; return o && o.kind === 'human' && !(t.away && t.away[s]) && !here.has(o.id); });
  }
  // During a board, when the next seated player's connection would count as gone if no ping came (so the
  // alarm can check), only while someone else is here to play on. null if there is nobody to check.
  sweepAt() {
    const t = this.t; if (!t || !live(t)) return null;
    const last = new Map();
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.uid && w.readyState === 1) last.set(a.uid, Math.max(last.get(a.uid) || 0, this.lastSeen(w, a)));
    }
    let at = null;
    for (const s of SEATS) {
      const o = t.seats[s];
      if (!o || o.kind !== 'human' || (t.away && t.away[s]) || ![...last.keys()].some(id => id !== o.id)) continue;
      const x = last.has(o.id) ? last.get(o.id) + staleMs + 100 : Date.now();
      if (at == null || x < at) at = x;
    }
    return at;
  }
  // No answer in time: count it against the connection that was asked (see askThink).
  thinkMissed(th) {
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment() || {};
      if (a.th && a.th.nonce === th.nonce) try { w.serializeAttachment({ ...a, miss: (a.miss || 0) + 1 }); } catch (e) { }
    }
  }
  // The open think request; after the object woke from hibernation it is read back from the connection that was asked.
  getThink() {
    if (this.think !== undefined) return this.think;
    this.think = null;
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment() || {};
      if (a.th && a.uid && (!this.think || a.th.at > this.think.at)) this.think = { done: false, card: null, ...a.th, uid: a.uid };
    }
    return this.think;
  }
  thought(m, u, ws) {
    const th = this.getThink();
    if (!th || th.done || !this.t || u.uid !== th.uid || m.key !== th.key + '#' + th.nonce || G.playKey(this.t) !== th.key) return;
    th.done = true; th.card = typeof m.card === 'string' && m.card.length === 2 ? m.card : null; // legality is checked when it's played
    if (u.th && u.th.nonce === th.nonce) try { ws.serializeAttachment({ ...u, miss: 0, th: { ...u.th, done: true, card: th.card } }); } catch (e) { }
    if (Date.now() >= th.due) this.setAlarm(Date.now()).catch(e => console.error(e)); // the robot's pause is over: play now
  }

  async alarm() {
    this.alarmAt = null; // it fired; whatever runs below sets the next one
    if (!this.t) return;
    const d = deadline(this.t);
    if (d && Date.now() >= d) {
      await this.apply({}, t => {
        t.timeUp = true; t.claim = null; t.undoReq = null;
        G.sysMsg(t, `Time's up (${t.boardLimit} minutes). The robots are finishing this board.`);
      });
      return;
    }
    // connections that went silent: their players are away now (apply marks them), so a stand-in can be planned
    if (this.dropStale() || this.unmarkedAway()) { await this.apply({}, () => { }); return; }
    // a host who has been away long enough hands the job on (passHost, in apply), even if nobody acts
    { const hd = hostDue(this.t, this.here()); if (hd != null && Date.now() >= hd) { await this.apply({}, () => { }); return; } }
    const ab = awayBlocking(this.t);
    if (ab && Date.now() >= ab.at && this.othersHere(ab.id)) {
      await this.apply({}, t => {
        t.subs = { ...(t.subs || {}), [ab.seat]: true };
        G.sysMsg(t, `A robot is playing for ${G.SEAT_NAME[ab.seat]} while ${t.seats[ab.seat].name} is away`);
      });
      return;
    }
    if (this.robotPending()) {
      const th = this.getThink(), key = this.t.phase === 'play' ? G.playKey(this.t) : null;
      if (th && key && th.key === key && !th.done && Date.now() < th.at + THINK_MS) { await this.setAlarm(th.at + THINK_MS); return; } // still thinking
      if (th && key && th.key === key && !th.done) this.thinkMissed(th);
      const hint = th && th.done && th.card && th.key === key ? { key, card: th.card } : null;
      const ok = await this.apply({}, t => {
        const ts = G.turnSeat(t), o = G.occupant(t, G.controllerOf(t, ts));
        if (o.kind === 'robot') return A.robotStep(t, hint);
        // stand-in for an away player: same robot logic, played for that seat
        if (t.phase === 'auction') { const r = G.botCall(t.hands[ts], ts, t.dealer, t.auction, t.vul); return A.call(t, ts, r.call, r.alert); }
        const ok = hint && G.legalPlays(t.hands, t.play, t.contract, ts).includes(hint.card);
        return A.card(t, ts, ok ? hint.card : G.botPlay(t, ts));
      });
      this.botFails = ok ? 0 : (this.botFails || 0) + 1;
      if (!ok) await this.setAlarm(Date.now() + (this.botFails < 5 ? 2000 : IDLE_DELETE_MS)); // retry a few times, then leave it to the players
      return;
    }
    const idle = Date.now() - (this.t.updatedAt || 0);
    if (idle >= idleLimit(this.t)) {
      // someone still has it open: look again in an hour (not every minute, which would wake the table all day)
      if (this.ctx.getWebSockets().length) { await this.setAlarm(Date.now() + 3600e3); return; }
      await this.shutdown(this.t.board ? 'This table was closed after three days without play.' : 'This table was closed as nobody started playing.');
      return;
    }
    await this.planAlarm(); // (a deadline or a stand-in still to come, or the idle check)
  }

  // ----- what each person may see -----
  viewFor(uid) {
    const t = this.t;
    G.setMe({ id: uid });
    const { history, ...rest } = t;
    const v = structuredClone(rest);
    delete v.seed; // the seed would reveal every deal of a team match
    const seated = SEATS.some(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === uid);
    // Someone who stood up (or was removed) during this board still only sees what their seat could see,
    // so they can't stand up, look at all four hands, and sit back down.
    const leftSeat = !seated && live(t) && t.left && Object.hasOwn(t.left, uid) ? t.left[uid] : null;
    const asSeen = leftSeat ? { ...t, seats: { ...t.seats, [leftSeat]: { kind: 'human', id: uid, name: '' } } } : t;
    const onlooker = !seated && !leftSeat;
    const otherHas = b => this.other.some(h => h.board === b);
    // In a team match an onlooker only sees a board once both rooms have played it (also once it is over here).
    const hideBoard = !!(t.match && onlooker && t.board && !otherHas(t.board));
    if (hideBoard) {
      v.phase = 'auction'; v.auction = []; v.contract = null; v.play = { tricks: [] }; v.claim = null; v.undoReq = null; v.masked = true;
    }
    if (v.hands) {
      for (const s of SEATS) {
        if (!hideBoard && G.canSee(asSeen, s)) continue;
        if (hideBoard) { v.hands[s] = Array.from({ length: 13 }, (_, i) => '?' + i); continue; }
        // Keep the cards already played (they're public) and replace the rest with blanks.
        const played = [];
        t.play.tricks.forEach(tr => tr.cards.forEach(pc => { if (pc.seat === s) played.push(pc.card); }));
        const left = (t.phase === 'play' || t.phase === 'done') ? G.remainingHand(t.hands, t.play, s).length : t.hands[s].length;
        v.hands[s] = played.concat(Array.from({ length: left }, (_, i) => '?' + i));
      }
    }
    if (!onlooker) v.chat = v.chat.filter(m => !m.kib);
    else if (t.match) v.chat = v.chat.filter(m => !m.res); // onlookers get the result once both rooms have played (announceBoth)
    // nor the players' talk and the claims during a board the other room hasn't played (only other onlookers' lines)
    if (hideBoard) v.chat = v.chat.filter(m => m.kib || m.ts < t.boardStart);
    if (t.host !== uid) delete v.requests; // only the host sees who asked for a seat
    // finished boards this viewer may see: in a team match, onlookers only get boards both rooms have played
    const hist = t.match && onlooker ? history.filter(h => otherHas(h.board)) : history;
    let other = null;
    if (t.match) { const mine = new Set(history.map(h => h.board)); other = this.other.filter(h => mine.has(h.board)); } // never show a board you haven't played yet
    return { v, hist, other };
  }

  // Everyone with the same role sees the same table, so views are worked out per role, not per person.
  roleOf(uid) {
    const t = this.t;
    const seat = SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === uid);
    const left = !seat && live(t) && t.left && Object.hasOwn(t.left, uid) ? t.left[uid] : null;
    return (seat ? 'seat:' + seat : left ? 'left:' + left : 'onlooker') + (t.host === uid ? ':host' : '');
  }

  sendTo(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) { } }

  broadcast(exclude) {
    if (!this.t) return;
    const sockets = this.ctx.getWebSockets().filter(ws => ws !== exclude);
    const seated = new Set(SEATS.map(s => this.t.seats[s]).filter(o => o && o.kind === 'human').map(o => o.id));
    const viewers = new Set();
    const atts = sockets.map(ws => ws.deserializeAttachment());
    for (const a of atts) if (a && a.uid && !seated.has(a.uid)) viewers.add(a.uid);
    // Each message carries the live board. Finished boards (which only ever get added) are sent
    // once per connection, so messages stay small however long the session runs.
    const cache = new Map(), roles = new Map(), now = Date.now();
    sockets.forEach((ws, i) => {
      const a = atts[i];
      if (!a || !a.uid) return;
      let role = roles.get(a.uid);
      if (!role) roles.set(a.uid, role = this.roleOf(a.uid));
      if (!cache.has(role)) {
        const { v, hist, other } = this.viewFor(a.uid), chat = v.chat; delete v.chat;
        cache.set(role, { head: JSON.stringify({ type: 'state', t: v, watchers: viewers.size, now }).slice(0, -1), chat, hist, other, hj: new Map(), oj: null, cj: new Map() });
      }
      const c = cache.get(role), H = c.hist;
      const cl = a.cl || 0;
      if (!c.cj.has(cl)) c.cj.set(cl, JSON.stringify(c.chat.filter(m => !m.n || m.n > cl)));
      let extra = `,"chat":${c.cj.get(cl)},"chatFull":${cl ? 'false' : 'true'}`;
      const lastN = c.chat.length ? (c.chat[c.chat.length - 1].n || 0) : cl;
      const hl = a.hl || 0, hb = H.length ? H[H.length - 1].board : 0;
      const histChanged = hl !== H.length || (a.hb ?? 0) !== hb;
      if (histChanged) {
        // send only the new boards if this connection's copy still lines up; otherwise resend them all
        const from = hl && hl <= H.length && H[hl - 1].board === a.hb ? hl : 0;
        // (the JSON of the boards is worked out once per role and starting board, not per connection: it can be ~200 KB)
        if (!c.hj.has(from)) c.hj.set(from, JSON.stringify(H.slice(from)));
        extra += `,"histFrom":${from},"hist":${c.hj.get(from)}`;
      }
      const ov = c.other, ob = ov && ov.length ? ov[ov.length - 1].board : 0;
      const otherChanged = !!ov && ((a.ol || 0) !== ov.length || (a.ob ?? 0) !== ob);
      if (otherChanged) extra += `,"other":${c.oj ??= JSON.stringify(ov)}`;
      try {
        ws.send(c.head + extra + '}');
        if (histChanged || otherChanged || lastN !== cl) ws.serializeAttachment({ ...a, hl: H.length, hb, ol: ov ? ov.length : 0, ob, cl: lastN });
      } catch (e) { }
    });
  }

  reportLobby() {
    const t = this.t; if (!t || t.private) return;
    const seats = {};
    for (const s of SEATS) { const o = t.seats[s]; seats[s] = o ? (o.kind === 'robot' ? { kind: 'robot' } : { kind: 'human', name: o.name }) : null; }
    // people: how many are at the table now (seated or watching), so the list can show which tables are alive
    const summary = { code: t.id, name: t.name, phase: t.phase, board: t.board, match: !!t.match, seats, people: this.here().size, locked: !!t.locked, boardLimit: t.boardLimit || 0 };
    const key = JSON.stringify(summary);
    // Only tell the lobby when something it shows has changed, plus a refresh every 10 minutes.
    if (key === this.lobbyKey && Date.now() - (this.lobbyAt || 0) < 600e3) return;
    this.lobbyKey = key; this.lobbyAt = Date.now();
    lobbyStub(this.env).update({ ...summary, updatedAt: t.updatedAt }).catch(e => console.error(e));
  }
}

// Rate limits count an IPv6 address by its /64 network (one user often holds a whole /64); IPv4 and 'local' as they are.
function ipGroup(ip) {
  ip = String(ip || '');
  if (!ip.includes(':') || ip === '::1') return ip;
  const v4 = ip.match(/:(\d+\.\d+\.\d+\.\d+)$/); if (v4) return v4[1]; // IPv4-mapped
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const parts = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return parts.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(':');
}

// ---------------- list of public tables ----------------
export class Lobby extends DurableObject {
  // At most 20 new tables an hour from one address. Kept in storage (under a hash of the address): the lobby
  // sleeps between requests, and a count kept only in memory would start again from zero each time.
  async allowCreate(ip) {
    if (ip === 'local' || ip === '127.0.0.1' || ip === '::1') return true; // local test server
    const now = Date.now(), key = 'ip:' + (await idFromSecret('ip:' + ip));
    const recent = ((await this.ctx.storage.get(key)) || []).filter(x => now - x < 3600e3);
    if (recent.length >= 20) return false;
    recent.push(now);
    await this.ctx.storage.put(key, recent);
    if (Math.random() < 0.05) { // now and then, forget addresses that made nothing in the last hour
      const all = await this.ctx.storage.list({ prefix: 'ip:', limit: 500 });
      const old = [...all].filter(([, v]) => !v.some(x => now - x < 3600e3)).map(([k]) => k).slice(0, 128);
      if (old.length) await this.ctx.storage.delete(old);
    }
    return true;
  }
  /* feature: daily (see dailyRoute) */
  async dailyPost(rec, ipKey) {
    const now = Date.now(), st = this.ctx.storage;
    if (!(await st.get('daily'))) { await st.put('daily', now); await st.setAlarm(now + DAILY_KEEP_MS); }
    const key = 'r:' + rec.board + ':' + rec.uid;
    if (await st.get(key)) return { error: 'already played', status: 409 };
    const ik = 'i:' + ipKey, recent = ((await st.get(ik)) || []).filter(x => now - x < 3600e3);
    if (recent.length >= DAILY_IP_PER_HOUR) return { error: 'too many results, try again later', status: 429 };
    const n = (await st.get('n:' + rec.board)) || 0;
    if (n >= DAILY_MAX_PER_BOARD) return { error: 'board full', status: 503 };
    recent.push(now);
    await st.put({ [ik]: recent, [key]: { ...rec, at: now }, ['n:' + rec.board]: n + 1 });
    this.dailyCache = null;
    return { ok: true };
  }
  async dailyGet(uid) {
    // everyone gets the same table (the "you" flag is added per caller); rebuilt at most every 5 s or after a post
    if (!this.dailyCache || Date.now() - this.dailyCache.at > 5000) this.dailyCache = { at: Date.now(), v: await this.dailyTable() };
    const v = this.dailyCache.v, mark = ({ uid: id, ...r }) => ({ ...r, you: id === uid });
    const boards = {};
    for (const [b, rows] of Object.entries(v.boards)) boards[b] = { count: rows.length, rows: rows.filter((r, i) => i < 100 || r.uid === uid).map(mark) };
    return { boards, overall: v.overall.filter((p, i) => i < 100 || p.uid === uid).map(mark), players: v.overall.length };
  }
  async dailyTable() {
    const all = [...(await this.ctx.storage.list({ prefix: 'r:' })).values()];
    const boards = {}, people = {};
    for (let b = 1; b <= DAILY_BOARDS; b++) {
      const rs = all.filter(r => r.board === b).sort((x, y) => y.score - x.score);
      // matchpoints: 2 for each result beaten, 1 for each tie (N-S scores; everyone sits South); counted, not O(n^2)
      const same = new Map(), below = new Map();
      for (const r of rs) same.set(r.score, (same.get(r.score) || 0) + 1);
      let seen = 0;
      for (const r of rs) if (!below.has(r.score)) { seen += same.get(r.score); below.set(r.score, rs.length - seen); }
      boards[b] = rs.map(r => {
        const mp = 2 * below.get(r.score) + same.get(r.score) - 1;
        const pct = rs.length > 1 ? Math.round(1000 * mp / (2 * (rs.length - 1))) / 10 : 100;
        const p = people[r.uid] || (people[r.uid] = { uid: r.uid, name: r.name, boards: 0, sum: 0 });
        p.boards++; p.sum += pct;
        return { uid: r.uid, name: r.name, contract: r.contract, declTricks: r.declTricks, score: r.score, pct };
      });
    }
    // overall: average matchpoint percentage over the boards played; more boards breaks a tie
    const ranked = Object.values(people).map(p => ({ uid: p.uid, name: p.name, boards: p.boards, pct: Math.round(10 * p.sum / p.boards) / 10 }))
      .sort((x, y) => y.pct - x.pct || y.boards - x.boards);
    ranked.forEach((p, i) => { p.rank = i && ranked[i - 1].pct === p.pct && ranked[i - 1].boards === p.boards ? ranked[i - 1].rank : i + 1; });
    return { boards, overall: ranked };
  }
  async alarm() { if (await this.ctx.storage.get('daily')) await this.ctx.storage.deleteAll(); }
  async update(summary) {
    this.listCache = null;
    if (summary.people === 0) { const old = await this.ctx.storage.get('t:' + summary.code); summary.emptyAt = old && old.people === 0 ? old.emptyAt || Date.now() : Date.now(); }
    await this.ctx.storage.put('t:' + summary.code, summary);
  }
  async remove(code) { this.listCache = null; await this.ctx.storage.delete('t:' + code); }
  async clear() { // delete() takes at most 128 keys at a time
    this.listCache = null;
    const keys = [...(await this.ctx.storage.list({ prefix: 't:' })).keys()];
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }
  async list() {
    if (this.listCache && Date.now() - this.listCache.at < 3000) return this.listCache.v;
    const v = await this.readList();
    this.listCache = { at: Date.now(), v };
    return v;
  }
  async readList() {
    const all = await this.ctx.storage.list({ prefix: 't:' });
    const now = Date.now(), out = [], stale = [];
    const emptyMs = LOBBY_EMPTY_MS * (Number(this.env.TEST_TIME_SCALE) > 0 ? Number(this.env.TEST_TIME_SCALE) : 1);
    for (const v of all.values()) {
      if (now - v.updatedAt >= LOBBY_MAX_AGE_MS) stale.push(v);
      // nobody there and nothing happening: not worth listing (it comes back as soon as someone opens it)
      else if (!(v.people === 0 && now - Math.max(v.updatedAt, v.emptyAt || 0) >= emptyMs)) out.push(v);
    }
    if (stale.length) await this.ctx.storage.delete(stale.map(v => 't:' + v.code).slice(0, 128));
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  }
}

// ---------------- feature: daily deals ----------------
// Everyone plays the same 4 boards each UTC day (dealt in the browser from the seed 'daily:<date>'). After each
// board the page posts its result here. Each day's results live in their own instance of the Lobby class
// (named 'daily:<date>', no new binding), which deletes itself 31 days later with an alarm.
const DAILY_BOARDS = 4;
const DAILY_KEEP_MS = 31 * 24 * 3600e3;
const DAILY_IP_PER_HOUR = 40;            // results one address may post in an hour
const DAILY_MAX_PER_BOARD = 5000;
const DAILY_MAX_BODY = 4000;             // bytes in a posted result (a full auction is well under this)
const utcDate = ms => new Date(ms).toISOString().slice(0, 10);
const dailyStub = (env, date) => env.LOBBY.get(env.LOBBY.idFromName('daily:' + date));

async function dailyRoute(req, env, path) {
  const now = Date.now();
  if (req.method === 'GET') {
    const m = path.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (!m || isNaN(Date.parse(m[1])) || now - Date.parse(m[1]) > DAILY_KEEP_MS || Date.parse(m[1]) > now) return json({ error: 'bad date' }, 400);
    const u = new URL(req.url).searchParams.get('u') || '';
    return json(await dailyStub(env, m[1]).dailyGet(/^u[0-9a-f]{16}$/.test(u) ? u : ''));
  }
  if (req.method !== 'POST' || path !== '/api/daily') return json({ error: 'not found' }, 404);
  if (Number(req.headers.get('content-length')) > DAILY_MAX_BODY) return json({ error: 'too large' }, 413);
  const b = await readJson(req, DAILY_MAX_BODY);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'bad request' }, 400);
  // today, or yesterday for a board started before midnight UTC
  const date = String(b.date || '');
  if (date !== utcDate(now) && date !== utcDate(now - 24 * 3600e3)) return json({ error: 'bad date' }, 400);
  const board = b.board;
  if (!Number.isInteger(board) || board < 1 || board > DAILY_BOARDS) return json({ error: 'bad board' }, 400);
  const secret = String(b.secret || '');
  if (secret.length < 16 || secret.length > 200) return json({ error: 'bad request' }, 400);
  const name = cleanName(b.name) || 'Player';
  // The page sends the whole board: the calls from the dealer, the cards in the order played, and for a board that
  // ended in a claim, how many of the remaining tricks the claim gave declarer's side. The board is dealt here from
  // the same seed and replayed with the shared rules; the contract, tricks and score all come from that replay,
  // never from the page. (Pages from before this sent only a contract and a trick count.)
  if (b.auction == null) return json({ error: 'This page is out of date: reload it to post daily results' }, 400);
  const v = dailyCheck(date, board, b);
  if (v.error) return json({ error: v.error }, 400);
  const { contract, tricks } = v;
  const score = contract ? G.scoreNS(contract, tricks, G.boardVul(board)) : 0;
  const ip = ipGroup(req.headers.get('cf-connecting-ip') || 'local');
  const r = await dailyStub(env, date).dailyPost({ uid: await idFromSecret(secret), name, board, contract, declTricks: tricks, score }, await idFromSecret('ip:' + ip));
  return json(r.error ? { error: r.error } : r, r.status || 200);
}
// Node budget for checking a daily claim (about 0.4 microseconds a node, as for a claim at an online table). Past it
// only a claim within the sure winners counts (claimAccept's fallback); anything more is refused.
const DAILY_CLAIM_NODES = 20000;
const DAILY_RANKS = '23456789TJQKA';
// Replays a posted daily board on the deal from its seed: { auction: ['1S', 'P', ...], play: ['HK', ...], claim }.
// Returns { contract, tricks } (both null when passed out) or { error }. Robots' calls and cards are checked like
// anyone's. A board the page turned round ("rotate so I'm declarer") replays unchanged: the calls and cards are
// the same in the same order, only the seat names moved, and N-S stays N-S.
function dailyCheck(date, board, b) {
  const au = b.auction, cards = b.play == null ? [] : b.play;
  if (!Array.isArray(au) || au.length < 4 || au.length > 320 || !au.every(x => typeof x === 'string' && x.length <= 2)) return { error: 'bad auction' };
  if (!Array.isArray(cards) || cards.length > 52 || !cards.every(x => typeof x === 'string' && x.length === 2)) return { error: 'bad play' };
  const t = G.newTable({ name: 'daily', local: false }); // not local: finishing the board doesn't simulate the robots' own version
  t.seed = 'daily:' + date; t.board = board - 1; G.startBoard(t);
  for (const call of au) if (t.phase !== 'auction' || G.A.call(t, G.turnSeat(t), call) === false) return { error: 'illegal auction' };
  if (t.phase === 'auction') return { error: 'the auction is not over' };
  if (!t.contract) return cards.length || b.claim != null ? { error: 'a passed-out board has no play' } : { contract: null, tricks: null };
  for (const card of cards) if (t.phase !== 'play' || G.A.card(t, G.turnSeat(t), card) === false) return { error: 'illegal card' };
  const c = t.contract, contract = { level: c.level, strain: c.strain, declarer: c.declarer, doubled: c.doubled || 0 };
  if (t.phase === 'done') return b.claim != null ? { error: 'no claim after the last card' } : { contract, tricks: t.history[t.history.length - 1].declTricks };
  // ended in a claim: claim = the tricks declarer's side takes of the remaining ones (the trick in progress included)
  const done = G.completedTricks(t.play), left = 13 - done.length, n = b.claim;
  if (!Number.isInteger(n) || n < 0 || n > left) return { error: 'the play is not finished' };
  const side = s => G.SEATS.indexOf(s) & 1;
  const beats = (x, y) => x[0] === y[0] ? DAILY_RANKS.indexOf(x[1]) > DAILY_RANKS.indexOf(y[1]) : x[0] === c.strain;
  let won = 0;
  for (const tr of done) { let w = tr.cards[0]; for (const pc of tr.cards) if (beats(pc.card, w.card)) w = pc; if (side(w.seat) === side(c.declarer)) won++; }
  // The leaderboard ranks N-S scores, so the claim may give N-S no more of the remaining tricks than they take double
  // dummy, whoever claimed: a claim by N-S is checked as a robot opponent checks one, and an E-W "concession" can't
  // hand N-S tricks they couldn't win. Giving N-S fewer (a concession, an E-W claim that N-S accepted) only lowers
  // their own score, so it stands.
  const ns = side(c.declarer) === 0 ? n : left - n;
  if (!G.claimAccept(t, 'N', ns, DAILY_CLAIM_NODES)) return { error: 'claim refused: more than double dummy allows, or too complex to check' };
  return { contract, tricks: won + n };
}
