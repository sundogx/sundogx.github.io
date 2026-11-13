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
const MAX_BOARDS = 100;                  // finished boards kept per table (keeps the stored record far below the size limit)
const histSig = h => h.length + ':' + (h.length ? h[h.length - 1].board : 0);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
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

    if (path === '/api/tables' && req.method === 'GET') {
      return json({ tables: await lobbyStub(env).list() });
    }

    if (path === '/api/tables' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
      if (!body || typeof body !== 'object') return json({ error: 'bad request' }, 400);
      const ip = req.headers.get('cf-connecting-ip') || 'local';
      if (!(await lobbyStub(env).allowCreate(ip))) return json({ error: 'too many tables, try again later' }, 429);
      const secret = String(body.secret || '');
      const name = cleanName(body.name);
      if (secret.length < 16 || !name) return json({ error: 'name required' }, 400);
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
        const okC = await tableStub(env, closed.id).init(closed);
        const okO = await tableStub(env, open.id).init(open);
        if (!okC || !okO) return json({ error: 'code clash, try again' }, 503);
        return json({ code: open.id });
      }

      const t = await make(() => {
        const t = G.newTable({ name: tableName, priv });
        t.seats.S = { kind: 'human', id: uid, name };
        G.sysMsg(t, `${name} opened the table`);
        return t;
      });
      return json({ code: t.id });
    }

    const m = path.match(/^\/api\/table\/([A-Z]{5})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return tableStub(env, m[1]).fetch(req);
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
const mayTake = (t, uid, seat) => {
  if (!live(t)) return true;
  const mine = SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === uid);
  if (mine && mine !== seat) return false;
  const prev = t.left && Object.hasOwn(t.left, uid) ? t.left[uid] : null;
  return !prev || prev === seat;
};
const markLeft = (t, uid, seat) => { if (live(t) && uid) t.left = { ...(t.left || {}), [uid]: seat }; };
const MAX_REQUESTS = 20;
const MAX_SOCKETS = 200;
const ACTIONS = {
  sit: (t, u, seat) => {
    if (!SEATS.includes(seat)) return false;
    if (!mayTake(t, u.uid, seat)) return G.fail('A board is in progress. You can only sit in your own seat until it ends.');
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
    if (!mayTake(t, uid, r.seat)) return G.fail('A board is in progress. That player can only take their own seat until it ends.');
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
    if (r !== false && o && o.kind === 'human') markLeft(t, o.id, seat);
    return r;
  },
  settings: (t, u, patch) => {
    if (!patch || typeof patch !== 'object') return false;
    const p = {};
    for (const k of ['locked', 'allowUndo', 'kibSee', 'undoAsk']) if (k in patch) p[k] = !!patch[k];
    if (t.match && p.kibSee) delete p.kibSee; // onlookers could pass on hands the other room is about to play
    if ('boardLimit' in patch) { const v = +patch.boardLimit; if ([0, 5, 7, 10, 15].includes(v)) p.boardLimit = v; }
    if (!Object.keys(p).length) return false;
    const r = A.settings(t, p);
    if (r !== false && 'undoAsk' in p) G.sysMsg(t, p.undoAsk ? 'Undo now needs the opponents\' agreement' : 'Undo no longer needs the opponents\' agreement');
    return r;
  },
  // A redeal is only for a board nobody has bid on, and never in a team match (its deals are fixed).
  redeal: t => (t.seed || t.auction.length) ? false : A.redeal(t),
  call: (t, u, call, alert) => {
    const s = G.mySeat(t); if (!s || typeof call !== 'string') return false;
    return A.call(t, s, call, alert ? String(alert).slice(0, 60) : null);
  },
  card: (t, u, seat, card) => {
    const s = G.mySeat(t);
    if (!s || !SEATS.includes(seat) || typeof card !== 'string' || G.controllerOf(t, seat) !== s) return false;
    return A.card(t, seat, card);
  },
  claim: (t, u, n) => { const s = G.mySeat(t); return s && Number.isInteger(n) ? A.claim(t, s, n) : false; },
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
  next: (t, u) => (G.mySeat(t) || t.host === u.uid) ? A.next(t) : false,
  undo: t => {
    const s = G.mySeat(t); if (!s) return false;
    if (t.undoReq) return false;
    if (!t.undoAsk) return A.undo(t, s);
    // "Opponents must agree": check the undo is possible, then ask the human opponents.
    const probe = structuredClone(t);
    if (A.undo(probe, s) === false) return false;
    const humans = SEATS.filter(x => !sameSideSeat(x, s) && t.seats[x] && t.seats[x].kind === 'human' && !(t.subs && t.subs[x]));
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
const rankIx = c => '23456789TJQKA'.indexOf(c[1]);

// A robot declarer claims the rest when every card in the hand on lead is a sure winner:
// nothing higher is out in its suit, and the defenders can't ruff it.
function robotClaim(t) {
  if (t.phase !== 'play' || t.claim) return false;
  const tr = t.play.tricks[t.play.tricks.length - 1];
  if (tr && tr.cards.length < 4) return false;
  const leader = G.turnSeat(t), decl = t.contract.declarer;
  if (!sameSideSeat(leader, decl)) return false;
  const done = G.completedTricks(t.play).length, left = 13 - done;
  const lastAt = t.robotClaimAt && t.robotClaimAt.b === t.board ? t.robotClaimAt.d : -9;
  if (left < 2 || done < lastAt + 2) return false;
  const trump = t.contract.strain === 'N' ? null : t.contract.strain;
  const o1 = SEATS[(SEATS.indexOf(leader) + 1) % 4], o2 = SEATS[(SEATS.indexOf(leader) + 3) % 4];
  const opp = [...G.remainingHand(t.hands, t.play, o1), ...G.remainingHand(t.hands, t.play, o2)];
  const oppTrumps = trump ? opp.some(c => c[0] === trump) : false;
  const mine = G.remainingHand(t.hands, t.play, leader);
  const sure = mine.every(c => !opp.some(x => x[0] === c[0] && rankIx(x) > rankIx(c)) && (c[0] === trump || !oppTrumps));
  if (!sure) return false;
  t.robotClaimAt = { b: t.board, d: done };
  return A.claim(t, decl, left) !== false;
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
  // A claim lapses if the claimer's seat is empty; a robot (table robot or stand-in) answers for its seat.
  if (t.claim && !t.seats[G.controllerOf(t, t.claim.by)]) { t.claim = null; G.sysMsg(t, 'The claim lapsed because the claimer left. Play continues.'); }
  const c = t.claim;
  if (c) for (const s of c.need) {
    const ctrl = G.controllerOf(t, s), o = t.seats[ctrl];
    if ((t.subs[ctrl] || (o && o.kind === 'robot')) && !c.acc[s] && t.claim) {
      const ok = c.tricks === 0 || c.tricks <= G.sureTricks(t, c.by);
      G.setMe({ id: '' });
      A.respond(t, s, ok);
      if (!ok) t.chat[t.chat.length - 1].text = `The robot ${t.subs[ctrl] ? 'playing for' : 'at'} ${G.SEAT_NAME[s]} rejected the claim. Play continues.`;
    }
  }
}

export class TableRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.t = null; this.other = []; this.lobbyKey = '';
    ctx.blockConcurrencyWhile(async () => {
      this.t = (await ctx.storage.get('t')) || null;
      if (this.t && !this.t.history) this.t.history = (await ctx.storage.get('h')) || [];
      this.savedSig = this.t ? histSig(this.t.history) : '';
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
    await this.ctx.storage.setAlarm(Date.now() + IDLE_DELETE_MS);
    return true;
  }

  // The other room of a team match sends its finished boards here.
  async setOther(history) {
    if (!this.t) return;
    this.other = Array.isArray(history) ? history : [];
    await this.ctx.storage.put('other', this.other);
    this.broadcast();
  }

  async fetch(req) {
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('This table is full of onlookers. Try again later.', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid: null, name: '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!this.t) { this.sendTo(ws, { type: 'notfound' }); try { ws.close(1000, 'not found'); } catch (e) { } return; }

    if (m.type === 'hello') {
      const secret = String(m.secret || '');
      if (secret.length < 16) return;
      const prev = ws.deserializeAttachment() || {};
      const now = Date.now();
      if (prev.helloAt && now - prev.helloAt < 2000) return; // one hello every 2 seconds per connection
      const att = { uid: await idFromSecret(secret), name: cleanName(m.name) || 'Player', helloAt: now };
      if (prev.uid && prev.uid !== att.uid) { att.hl = 0; att.ol = 0; att.cl = 0; } // a new identity starts its sync from scratch
      else { att.hl = prev.hl || 0; att.hb = prev.hb; att.ol = prev.ol || 0; att.ob = prev.ob; att.cl = prev.cl || 0; }
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
      this.broadcast(); // new viewer gets the table; everyone gets the new watcher count
      return;
    }

    const u = ws.deserializeAttachment() || {};
    if (!u.uid || m.type !== 'act') return;
    if (!this.allow(u.uid, m.name === 'chat')) { this.sendTo(ws, { type: 'error', msg: 'Slow down a little, then try again.' }); return; }
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
    const stillHere = a.uid && this.ctx.getWebSockets().some(x => x !== ws && (x.deserializeAttachment() || {}).uid === a.uid);
    if (seat && !stillHere && !(this.t.away && this.t.away[seat])) {
      await this.apply(a, t => { t.away = { ...(t.away || {}), [seat]: Date.now() }; }, null, ws);
    } else if (a.uid && !stillHere && this.t.requests && this.t.requests[a.uid]) {
      await this.apply(a, t => { delete t.requests[a.uid]; }, null, ws); // left before the host answered
    } else this.broadcast(ws);
  }

  // Run one action on a copy of the table; keep it only if the rules accepted it.
  async apply(u, run, ws, exclude) {
    const { history: oldHistory, ...rest } = this.t;   // the history only ever grows, so it is copied, not deep-cloned
    const t = structuredClone(rest);
    t.history = oldHistory.slice();
    const sigBefore = histSig(oldHistory);
    G.setMe({ id: u.uid || '', name: u.name || '' });
    let r;
    try { r = run(t); } catch (e) { console.error(e); r = false; }
    const err = G.takeError();
    if (r === 'requested' && ws) this.sendTo(ws, { type: 'error', msg: 'The seats are locked, so the host has been asked to seat you.' });
    if (r === false) { if (err && ws) this.sendTo(ws, { type: 'error', msg: err }); return false; }
    tidyPresence(t);
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
      tableStub(this.env, t.match.otherCode).setOther(t.history).catch(e => console.error(e));
    }
    await this.scheduleRobot();
    return true;
  }

  // Simple flood protection: about 10 actions a second per person, and 5 chat messages per 10 seconds.
  allow(uid, isChat) {
    this.rate = this.rate || new Map();
    const now = Date.now();
    let b = this.rate.get(uid);
    if (!b) { b = { tokens: 20, at: now, chat: [] }; this.rate.set(uid, b); }
    b.tokens = Math.min(20, b.tokens + (now - b.at) / 100); b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (isChat) { b.chat = b.chat.filter(x => now - x < 10000); if (b.chat.length >= 5) return false; b.chat.push(now); }
    if (this.rate.size > 200) for (const k of [...this.rate.keys()].slice(0, 100)) this.rate.delete(k);
    return true;
  }

  // The finished boards are written only when one is added; the rest of the table is small.
  async save() {
    const t = this.t, { history, ...rest } = t;
    const puts = { t: rest }, sig = histSig(history);
    if (sig !== this.savedSig) puts.h = history;
    await this.ctx.storage.put(puts);
    this.savedSig = sig;
  }

  robotPending() {
    const t = this.t; if (!t || t.claim || t.undoReq) return false;
    const ts = G.turnSeat(t); if (!ts) return false;
    const ctrl = G.controllerOf(t, ts);
    const o = G.occupant(t, ctrl);
    return !!(o && (o.kind === 'robot' || (o.kind === 'human' && t.subs && t.subs[ctrl])));
  }

  async scheduleRobot() {
    if (this.robotPending()) {
      const tr = this.t.play && this.t.play.tricks[this.t.play.tricks.length - 1];
      const pause = this.t.phase === 'auction' ? 650 : (tr && tr.cards.length === 4 ? 1300 : 700);
      const scale = Number(this.env.ROBOT_DELAY_SCALE ?? 1); // only changed for automated tests
      await this.ctx.storage.setAlarm(Date.now() + pause * (scale >= 0 ? scale : 1));
    } else {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_DELETE_MS);
    }
  }

  async alarm() {
    if (!this.t) return;
    if (this.robotPending()) {
      const ok = await this.apply({}, t => {
        const ts = G.turnSeat(t), o = G.occupant(t, G.controllerOf(t, ts));
        if (robotClaim(t)) return;
        if (o.kind === 'robot') return A.robotStep(t);
        // stand-in for an away player: same robot logic, played for that seat
        if (t.phase === 'auction') { const r = G.botCall(t.hands[ts], ts, t.dealer, t.auction); return A.call(t, ts, r.call, r.alert); }
        return A.card(t, ts, G.botPlay(t, ts));
      });
      this.botFails = ok ? 0 : (this.botFails || 0) + 1;
      if (!ok) await this.ctx.storage.setAlarm(Date.now() + (this.botFails < 5 ? 2000 : IDLE_DELETE_MS)); // retry a few times, then leave it to the players
      return;
    }
    const idle = Date.now() - (this.t.updatedAt || 0);
    if (idle >= IDLE_DELETE_MS && this.ctx.getWebSockets().length === 0) {
      const code = this.t.id;
      this.t = null; this.other = [];
      await this.ctx.storage.deleteAll();
      lobbyStub(this.env).remove(code).catch(() => { });
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + Math.max(60e3, IDLE_DELETE_MS - idle));
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
    // In a team match an onlooker only sees a board once both rooms have played it.
    const hideBoard = t.match && onlooker && t.board && !otherHas(t.board);
    if (hideBoard && live(t)) {
      v.phase = 'auction'; v.auction = []; v.contract = null; v.play = { tricks: [] }; v.claim = null; v.undoReq = null; v.masked = true;
    }
    if (v.hands) {
      for (const s of SEATS) {
        if (!hideBoard && G.canSee(asSeen, s)) continue;
        if (hideBoard && live(t)) { v.hands[s] = Array.from({ length: 13 }, (_, i) => '?' + i); continue; }
        // Keep the cards already played (they're public) and replace the rest with blanks.
        const played = [];
        t.play.tricks.forEach(tr => tr.cards.forEach(pc => { if (pc.seat === s) played.push(pc.card); }));
        const left = (t.phase === 'play' || t.phase === 'done') ? G.remainingHand(t.hands, t.play, s).length : t.hands[s].length;
        v.hands[s] = played.concat(Array.from({ length: left }, (_, i) => '?' + i));
      }
    }
    if (!onlooker) v.chat = v.chat.filter(m => !m.kib);
    if (t.host !== uid) delete v.requests; // only the host sees who asked for a seat
    // finished boards this viewer may see: in a team match, onlookers only get boards both rooms have played
    const hist = t.match && onlooker ? history.filter(h => otherHas(h.board)) : history;
    let other = null;
    if (t.match) { const mine = new Set(history.map(h => h.board)); other = this.other.filter(h => mine.has(h.board)); } // never show a board you haven't played yet
    return { v, hist, other };
  }

  sendTo(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) { } }

  broadcast(exclude) {
    if (!this.t) return;
    const sockets = this.ctx.getWebSockets().filter(ws => ws !== exclude);
    const seated = new Set(SEATS.map(s => this.t.seats[s]).filter(o => o && o.kind === 'human').map(o => o.id));
    const viewers = new Set();
    for (const ws of sockets) { const a = ws.deserializeAttachment(); if (a && a.uid && !seated.has(a.uid)) viewers.add(a.uid); }
    // Each message carries the live board. Finished boards (which only ever get added) are sent
    // once per connection, so messages stay small however long the session runs.
    const cache = new Map();
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (!a || !a.uid) continue;
      if (!cache.has(a.uid)) {
        const { v, hist, other } = this.viewFor(a.uid), chat = v.chat; delete v.chat;
        cache.set(a.uid, { head: JSON.stringify({ type: 'state', t: v, watchers: viewers.size, now: Date.now() }).slice(0, -1), chat, hist, other });
      }
      const c = cache.get(a.uid), H = c.hist;
      const cl = a.cl || 0, newChat = c.chat.filter(m => !m.n || m.n > cl);
      let extra = `,"chat":${JSON.stringify(newChat)},"chatFull":${cl ? 'false' : 'true'}`;
      const lastN = c.chat.length ? (c.chat[c.chat.length - 1].n || 0) : cl;
      const hl = a.hl || 0, hb = H.length ? H[H.length - 1].board : 0;
      const histChanged = hl !== H.length || (a.hb ?? 0) !== hb;
      if (histChanged) {
        // send only the new boards if this connection's copy still lines up; otherwise resend them all
        const from = hl && hl <= H.length && H[hl - 1].board === a.hb ? hl : 0;
        extra += `,"histFrom":${from},"hist":${JSON.stringify(H.slice(from))}`;
      }
      const ov = c.other, ob = ov && ov.length ? ov[ov.length - 1].board : 0;
      const otherChanged = !!ov && ((a.ol || 0) !== ov.length || (a.ob ?? 0) !== ob);
      if (otherChanged) extra += `,"other":${JSON.stringify(ov)}`;
      try {
        ws.send(c.head + extra + '}');
        if (histChanged || otherChanged || lastN !== cl) ws.serializeAttachment({ ...a, hl: H.length, hb, ol: ov ? ov.length : 0, ob, cl: lastN });
      } catch (e) { }
    }
  }

  reportLobby() {
    const t = this.t; if (!t || t.private) return;
    const seats = {};
    for (const s of SEATS) { const o = t.seats[s]; seats[s] = o ? (o.kind === 'robot' ? { kind: 'robot' } : { kind: 'human', name: o.name }) : null; }
    const summary = { code: t.id, name: t.name, phase: t.phase, board: t.board, match: !!t.match, seats };
    const key = JSON.stringify(summary);
    // Only tell the lobby when something it shows has changed, plus a refresh every 10 minutes.
    if (key === this.lobbyKey && Date.now() - (this.lobbyAt || 0) < 600e3) return;
    this.lobbyKey = key; this.lobbyAt = Date.now();
    lobbyStub(this.env).update({ ...summary, updatedAt: t.updatedAt }).catch(e => console.error(e));
  }
}

// ---------------- list of public tables ----------------
export class Lobby extends DurableObject {
  // At most 20 new tables an hour from one address.
  allowCreate(ip) {
    this.made = this.made || new Map();
    const now = Date.now();
    const recent = (this.made.get(ip) || []).filter(x => now - x < 3600e3);
    if (recent.length >= 20) { this.made.set(ip, recent); return false; }
    recent.push(now); this.made.set(ip, recent);
    if (this.made.size > 500) for (const [k, v] of this.made) if (!v.some(x => now - x < 3600e3)) this.made.delete(k);
    return true;
  }
  async update(summary) { this.listCache = null; await this.ctx.storage.put('t:' + summary.code, summary); }
  async remove(code) { this.listCache = null; await this.ctx.storage.delete('t:' + code); }
  async list() {
    if (this.listCache && Date.now() - this.listCache.at < 3000) return this.listCache.v;
    const v = await this.readList();
    this.listCache = { at: Date.now(), v };
    return v;
  }
  async readList() {
    const all = await this.ctx.storage.list({ prefix: 't:' });
    const now = Date.now(), out = [], stale = [];
    for (const v of all.values()) (now - v.updatedAt < LOBBY_MAX_AGE_MS ? out : stale).push(v);
    if (stale.length) await this.ctx.storage.delete(stale.map(v => 't:' + v.code).slice(0, 128));
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  }
}
