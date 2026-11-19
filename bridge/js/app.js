// ======================= App =======================
const UI_SUITS = ['S', 'H', 'C', 'D']; // alternate colours in hand display
const isRed = s => s === 'H' || s === 'D';
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const $ = id => document.getElementById(id);
// display options, kept in this browser
const Prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('bridge-prefs')) || {}; } catch (e) { }
  try { if (p.contrast === undefined && localStorage.getItem('bridge-contrast') === '1') p.contrast = true; } catch (e) { }
  return Object.assign({ contrast: false, deck4: false, confirm: false, confirmBid: false, speed: 'normal', hint: false, autoNext: false }, p);
})();
function savePrefs() { try { localStorage.setItem('bridge-prefs', JSON.stringify(Prefs)); } catch (e) { } }
function applyPrefs() {
  const r = document.documentElement;
  if (Prefs.contrast) r.setAttribute('data-contrast', 'high'); else r.removeAttribute('data-contrast');
  if (Prefs.deck4) r.setAttribute('data-deck', '4'); else r.removeAttribute('data-deck');
}
applyPrefs();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

// ---------- identity (this browser) ----------
const Local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};
async function idFromSecret(secret) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return 'u' + [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Every table action goes through here: practice runs it in this browser, online tables send it to the server,
// which checks it against the rules and tells everyone the result.
const LOCAL_ACTS = {
  card: (s, seat, card) => controllerOf(s, seat) === mySeat(s) ? A.card(s, seat, card) : false,
  call: (s, call, alert) => A.call(s, mySeat(s), call, alert),
  claim: (s, n, seenLeft) => A.claim(s, mySeat(s), n, seenLeft),
  respond: (s, accept) => A.respond(s, mySeat(s), accept),
  cancelClaim: s => A.cancelClaim(s, mySeat(s)),
  undo: s => A.undo(s, mySeat(s)),
};
function doAct(name, ...args) {
  if (!T) return;
  if (T.local) return act(s => (LOCAL_ACTS[name] || A[name])(s, ...args));
  Net.send({ type: 'act', name, args });
}

let me = { id: '', name: '', secret: '' };
let T = null;            // current table state
let tKey = null;         // storage key of current table (null for practice)
let pollTimer = null, lobbyTimer = null, robotTimer = null;
let lastRenderedVersion = -1;
let clockSkew = 0; // server time minus this device's time, for online tables
const serverNow = () => Date.now() + (T && !T.local ? clockSkew : 0);
let selLevel = null;
let selCard = null;     // card picked (confirm-before-play, or keyboard) but not played yet
let actChain = Promise.resolve();

function toast(msg, ms = 2600) {
  const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), ms);
}

async function act(fn) {
  actChain = actChain.then(async () => {
    let base = T;
    const { history, chat, ...rest } = base;
    const s = structuredClone(rest);
    s.history = history.slice(); s.chat = chat.slice();
    const r = fn(s);
    if (r === false) { if (base !== T) { T = base; render(); } return false; }
    s.version = (s.version || 0) + 1; s.updatedAt = Date.now();
    T = s; render(); return true;
  }).catch(e => console.error(e));
  return actChain;
}

// ---------- robots ----------
function amDriver(t) {
  if (t.local) return true;
  return false; // online: the server plays the robots
  const humans = SEATS.map(s => t.seats[s]).filter(o => o && o.kind === 'human').map(o => o.id).sort();
  if (humans[0] === me.id) return true;
  return mySeat(t) && Date.now() - t.updatedAt > 6000; // take over if the driver went quiet
}
function scheduleRobot() {
  // practice: start the solver workers during the auction so the opening lead and first cards aren't cold
  if (T && T.local && T.phase === 'auction' && typeof robotDDWarm === 'function') robotDDWarm();
  if (robotTimer || !T) return;
  const ts = turnSeat(T); if (!ts || T.claim) return;
  const o = occupant(T, controllerOf(T, ts));
  if (!o || o.kind !== 'robot' || !amDriver(T)) return;
  const tr = T.play && T.play.tricks[T.play.tricks.length - 1];
  const m = speedMult(), pause = T.phase === 'auction' ? 650 * m : (tr && tr.cards.length === 4 ? trickHoldMs() + 500 * m : 700 * m);
  // card play: the solver thinks (in a worker, at most ~1.5 s) while the robot's usual pause runs
  const key = T.phase === 'play' ? playKey(T) : null;
  const hint = key ? robotDDCard(T, ts).then(card => card && { key, card }) : null;
  const id = robotTimer = setTimeout(async () => {
    const h = hint ? await hint : null;
    if (robotTimer !== id) return; // left the table meanwhile
    robotTimer = null;
    if (!T || (key && playKey(T) !== key)) { scheduleRobot(); return; } // the position changed (undo): think again
    await act(s => A.robotStep(s, h));
    scheduleRobot();
  }, pause);
}

// ---------- rendering ----------
function orient(t) {
  const base = mySeat(t) || 'S';
  return { bottom: base, left: nextSeat(base), top: partnerOf(base), right: nextSeat(partnerOf(base)) };
}
function currentCards(t, seat) {
  if (!t.hands) return [];
  if (t.phase === 'play' || t.phase === 'done') return remainingHand(t.hands, t.play, seat);
  return t.hands[seat];
}
function myLegal(t, seat) {
  const mine = mySeat(t);
  if (!mine || t.phase !== 'play' || t.claim || t.timeUp) return [];
  const ts = turnSeat(t);
  if (ts !== seat || controllerOf(t, ts) !== mine) return [];
  return legalPlays(t.hands, t.play, t.contract, seat);
}
function cardHTML(c, cls = '', attrs = '') {
  const s = suitOf(c), r = rankLabel(c[1]);
  return `<button class="card ${isRed(s) ? 'red' : ''} s-${s} ${cls}" ${attrs} aria-label="${r} of ${({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[s]}"><span class="cr">${r}</span><span class="cs">${SYM[s]}</span><span class="cb">${SYM[s]}</span></button>`;
}
function rowsHTML(cards, legal = [], seat = '') {
  return `<div class="rows">${UI_SUITS.map(s => {
    const cs = cards.filter(c => suitOf(c) === s).sort((a, b) => rankOf(b) - rankOf(a));
    const ranks = cs.length ? cs.map(c => legal.includes(c)
      ? `<button class="rk play ${c === selCard ? 'sel' : ''} ${isHint(c) ? 'hint' : ''}" data-play="${c}" data-seat="${seat}">${rankLabel(c[1])}</button>`
      : `<button class="rk" disabled>${rankLabel(c[1])}</button>`).join('') : '<span class="void">–</span>';
    return `<div class="r"><span class="s ${isRed(s) ? 'red' : ''} s-${s}">${SYM[s]}</span><span class="rr">${ranks}</span></div>`;
  }).join('')}</div>`;
}
// a hand shown face up on the table: one column of overlapping cards per suit
function colsHTML(cards, legal = [], seat = '', small = false, budget = 0, maxW = 0) {
  const any = legal.length > 0;
  const n = Math.max(1, ...UI_SUITS.map(s => cards.filter(c => suitOf(c) === s).length));
  const ch = cssPx('--ch', 92);
  // a long suit steps its cards closer together, so the hand leaves room for the trick and keeps the plates on the felt
  // never so close that the ranks are hidden, unless the suit would otherwise run off the felt
  let step = 28;
  if (budget && n > 1) {
    step = Math.max(Math.round(cssPx('--cw', 64) * 0.4), Math.min(28, (budget - ch) / (n - 1)));
    const hard = budget + 140; // the most this hand may take (the trick then shrinks)
    if (ch + (n - 1) * step > hard) step = Math.max(14, (hard - ch) / (n - 1));
  }
  // too wide for its room (a narrow phone): the suits overlap sideways a little, the ranks stay readable
  const cols = UI_SUITS.filter(s => cards.some(c => suitOf(c) === s)).length, cw = cssPx('--cw', 64);
  const gap = maxW && cols > 1 ? Math.min(4, (maxW - cols * cw) / (cols - 1)) : 4;
  const dgap = gap < 4 ? `;--dgap:${Math.round(Math.max(-0.45 * cw, gap))}px` : '';
  return `<div class="dhand ${small ? 'sm' : ''}" style="--dstep:${Math.round(step)}px${dgap}">${UI_SUITS.map(s => {
    const cs = cards.filter(c => suitOf(c) === s).sort((a, b) => rankOf(b) - rankOf(a));
    if (!cs.length) return '';
    return `<div class="dcol">${cs.map(c => {
      const ok = legal.includes(c);
      const cls = (any ? (ok ? 'legal' : 'dim') : '') + (ok && c === selCard ? ' sel' : '') + (ok && isHint(c) ? ' hint' : '');
      return cardHTML(c, cls, ok ? `data-play="${c}" data-seat="${seat}"` : 'tabindex="-1"');
    }).join('')}</div>`;
  }).join('')}</div>`;
}
function plateHTML(t, seat) {
  const o = occupant(t, seat);
  const vul = t.board && isVul(t.vul, seat);
  const turn = turnSeat(t) === seat && !t.claim;
  const mine = mySeat(t), you = mine === seat;
  const tag = ''; // dummy is clear from the face-up hand, so no label
  let yt = '';
  if (turn && mine && controllerOf(t, seat) === mine && (t.phase === 'auction' || t.phase === 'play')) {
    const tr = t.phase === 'play' && t.play.tricks[t.play.tricks.length - 1];
    const lead = t.phase === 'play' && (!tr || tr.cards.length === 0 || tr.cards.length === 4);
    yt = t.phase === 'auction' ? 'Your bid' : seat !== mine ? (lead ? 'Lead from dummy' : 'Play from dummy') : lead ? 'Your lead' : 'Your play';
  }
  return `<span class="plate ${vul ? 'vul' : ''} ${turn ? 'turn' : ''} ${yt ? 'act' : ''}"><span class="sl" title="${SEAT_NAME[seat]}${vul ? ', vulnerable' : ''}">${seat}</span><span class="nm">${esc(you ? 'You' : seatLabel(t, seat))}</span>${tag}${yt ? `<span class="sr">${yt}</span>` : ''}${awayTag(t, seat)}${turn && t.phase !== 'done' && (!t.local || t.boardLimit) ? ` <span class="clk" data-since="${t.lastActAt || serverNow()}"></span>` : ''}</span>`;
}
const cssPx = (name, dflt) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || dflt;
// the felt's inner width, height and side-column width as laid out (estimated before the first layout)
function feltGeom() {
  const f = $('felt'), cs = getComputedStyle(f);
  const innerW = (f.clientWidth || 800) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const cols = cs.gridTemplateColumns.split(' ').map(parseFloat).filter(x => x > 0);
  const bx = f.querySelector('.bbx'), boxW = bx ? bx.getBoundingClientRect().width : 92;
  // across the top, the room between the board box and the same margin on the right
  return { innerW, h: f.clientHeight || 530, colW: cols.length === 3 ? cols[0] : (innerW - 12) * 1.5 / 4, topW: innerW - 2 * (boxW + 8) };
}
function seatBlock(t, seat, where) {
  const o = occupant(t, seat);
  const mine = mySeat(t);
  let inner = plateHTML(t, seat);
  const midBoard = !t.local && !mine && (t.phase === 'auction' || t.phase === 'play') && t.kibSee !== false && !(t.left && t.left[me.id]);
  if (!o && midBoard) {
    inner += `<div class="sitbtns"><span class="note" style="color:inherit">Sit after this board</span>${isHost(t) ? `<button class="btn small" data-robot="${seat}">Add robot</button>` : ''}</div>`;
  } else if (!o) {
    inner += `<div class="sitbtns"><button class="btn small" data-sit="${seat}">Sit here</button>${mine || t.local || isHost(t) ? `<button class="btn small" data-robot="${seat}">Add robot</button>` : ''}</div>`;
  } else if (o.kind === 'robot' && !t.local && !mine && !midBoard) {
    inner += `<div class="sitbtns"><button class="btn small" data-sit="${seat}">Take seat</button></div>`;
  }
  // once the board is over the hands go (the hand record has them; the host may move players before the next board)
  if (where !== 'bottom' && t.hands && t.phase !== 'waiting' && t.phase !== 'done') {
    const side = where !== 'top', g = feltGeom(), cwid = cssPx('--cw', 64);
    // room for this hand: its own column at the sides; across the top, the width between the corners
    const room = side ? g.colW : g.topW;
    if (canSee(t, seat)) {
      // a dummy across the top leaves the middle ~200px for the trick; at the sides it sits in the middle row
      const budget = where === 'top' ? g.h - 300 : g.h - 216;
      const cards = currentCards(t, seat), longest = Math.max(0, ...UI_SUITS.map(s => cards.filter(c => suitOf(c) === s).length));
      // a short table (phone held sideways) can't fit a long suit as a column across the top: show suit rows instead
      const tooTall = !side && cssPx('--ch', 92) + (longest - 1) * Math.round(cwid * 0.4) > budget + 100;
      if ((side && room < 4 * cwid + 12) || tooTall) inner += rowsHTML(cards, myLegal(t, seat), seat);
      else inner += colsHTML(currentCards(t, seat), myLegal(t, seat), seat, side, budget, room);
    }
    else {
      const n = currentCards(t, seat).length;
      // overlap the backs more when the hand would not fit its space (narrow felts, phones)
      const step = n > 1 ? Math.max(2, Math.min(cwid * 0.28, (room - cwid - 2) / (n - 1))) : 0;
      inner += `<span class="backs" role="img" aria-label="${n} cards" title="${n} cards" style="--bo:${(step - cwid).toFixed(1)}px">${'<i></i>'.repeat(n)}</span>`;
    }
  }
  const topMax = where === 'top' ? ` style="max-width:${Math.max(160, Math.round(feltGeom().topW))}px"` : ''; // clear of the board box
  return `<div class="seat"${topMax}>${inner}</div>`;
}
// ACBL Alert Procedure, as the robots' explanations map onto it: natural calls and the common conventions
// (Stayman, Blackwood/RKCB and replies, strong 2C and 2D waiting, takeout/negative/responsive/penalty doubles,
// Michaels, Unusual 2NT, cue bids, control bids) are not alerted; a natural 1NT opening, Jacoby transfers and a
// forcing 1NT response are Announced; artificial calls with unexpected meanings are Alerted. Anything else, such
// as an explanation a human typed in, counts as an Alert.
const ALERT_RE = /^(Texas|Transfer to 3♣|Completes the transfer to clubs|Super-accept|Smolen|Lebensohl|Forced reply to lebensohl|New minor forcing|Fourth suit forcing|Second negative|Jacoby 2NT|Shortness|17\+ points, no shortness|14-16 points, no shortness|Minimum, no shortness|Good 6\+ card suit: sets trumps|Splinter|Support (double|redouble)|Jordan 2NT|Maximum with an ace or king|Minimum, or a maximum without a feature|Solid suit \(AKQ\)|Lead-directing|Stayman: 4 cards in an unbid major|To play, (no|with a)|No .* stopper either|Asks for the Michaels bidder|Cue bid: game values, asks for a major)/;
const ANNOUNCE = [[/^15-17 points, balanced/, '15 to 17'], [/^Transfer: 5\+/, 'Transfer'], [/^Forcing one round: 6-12 points/, 'Forcing']];
function alertKind(a, auction, i) {
  if (!a) return null;
  for (const [re, say] of ANNOUNCE) if (re.test(a)) {
    if (say === '15 to 17' && auction.slice(0, i).some(x => bidValue(x.call) >= 0)) return null; // only the opening 1NT is announced
    return { kind: 'announce', say };
  }
  if (ALERT_RE.test(a)) return { kind: 'alert' };
  return isRobotText(a) ? null : { kind: 'alert' };
}
function isRobotText(a) { return /^(Penalty|Takeout|Responsive double|Reopening double|Two lowest|Quantitative|Redouble|Strong and artificial|20-21|22-24|25-27|Limit raise|Two over one|Invites game|Jump shift|Reverse|4 spades|4 hearts|Minimum, no fit|Maximum, no fit|Stayman: asks|Shows 4|No 4-card major|Completes the transfer|Game forcing|Invitational|To play|Positive|Waiting|Support, |Feature ask|Preemptive|Forcing one round|Natural|Balancing|Michaels|15-18 points|Weak jump overcall|Converts the double|Cue bid|Constructive|Strong hand, takeout|Defends their|Wants to defend|[0-9] (or [0-9] )?key cards|[0-9] key cards|Roman Key Card|Asks for the .* queen|Has the|No .* queen|Grand slam try|Control bid|3-card .* support|5 .* and 4 of the other major|Negative double|Unusual 2NT|Weak two|Maximum|Minimum|Lead-directing)/.test(a); }
// A small bubble right under the tapped call; closes on the next tap anywhere, or after 6 seconds.
let explainTimer = null;
function showExplain(el, text) {
  hideExplain();
  const r = el.getBoundingClientRect(), d = document.createElement('div');
  d.className = 'explain'; d.id = 'explainPop'; d.setAttribute('role', 'status'); d.innerHTML = redSym(esc(text));
  document.body.appendChild(d);
  const w = d.offsetWidth, x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 6 + d.offsetHeight < window.innerHeight;
  d.style.left = x + 'px'; d.style.top = (below ? r.bottom + 6 : r.top - d.offsetHeight - 6) + window.scrollY + 'px';
  explainTimer = setTimeout(hideExplain, 6000);
  setTimeout(() => document.addEventListener('pointerdown', hideExplain, { once: true }), 0);
  return d;
}
function hideExplain() { clearTimeout(explainTimer); const p = document.getElementById('explainPop'); if (p) p.remove(); }
// What every call means by the robots' system (bidding.js), worked out once per auction and vulnerability:
// render runs about once a card, so the explanations are cached by the calls made so far.
const callDescCache = new Map();
function callDescriptions(auction, vul) {
  const key = (vul || '') + '|' + auction.map(a => a.by + a.call).join(' ');
  let r = callDescCache.get(key);
  if (r) return r;
  r = auction.map(() => ({ text: null, alert: null }));
  try {
    const metas = auctionMetas(auction, vul);
    r = auction.map((a, i) => ({ text: describeCall(auction, i, vul, metas), alert: (metas[i] && metas[i].alert) || null }));
  } catch (e) { /* no explanations rather than no auction */ }
  if (callDescCache.size > 40) callDescCache.delete(callDescCache.keys().next().value);
  callDescCache.set(key, r);
  return r;
}
// Robots explain their calls openly to everyone, partner included. A human's own alert is shown to everyone but
// their partner. In the live auction only robots' calls are explained by the system; in a finished board's
// record (another auction than the table's) every call is.
function auctionGridHTML(t, auction = t.auction, dealer = t.dealer, vul = t.vul, viewer = mySeat(t)) {
  const order = ['W', 'N', 'E', 'S'];
  const cells = order.map(s => `<div class="h ${isVul(vul, s) ? 'vul' : ''}" title="${SEAT_NAME[s]}${isVul(vul, s) ? ', vulnerable' : ''}">${s}</div>`);
  const off = order.indexOf(dealer);
  for (let i = 0; i < off; i++) cells.push('<div></div>');
  const live = auction === t.auction;
  const isRobot = s => { const o = t.seats && t.seats[s]; return (!!o && o.kind === 'robot') || !!(t.subs && t.subs[s]); };
  const descs = callDescriptions(auction, vul);
  auction.forEach((a, i) => {
    const bySystem = !live || isRobot(a.by), d = descs[i] || {};
    const isBid = bidValue(a.call) >= 0;
    const red = isBid && isRed(a.call[1]);
    let text = null, alertText = null;
    if (bySystem) {
      // a robot's alert opens its explanation; an alert a human typed (in a board's record) is shown as typed
      if (a.alert && !(d.text && d.text.startsWith(a.alert))) text = alertText = a.alert;
      else { text = d.text || a.alert || null; alertText = a.alert || d.alert; }
    } else if (a.alert && !(viewer && partnerOf(a.by) === viewer)) text = alertText = a.alert;
    const ak = text ? alertKind(alertText, auction, i) : null;
    const expl = !text ? '' : ak && ak.kind === 'announce' ? `Announced: "${ak.say}". ${text}` : ak ? `Alert: ${text}` : text;
    const kind = a.call === 'X' ? 'cx' : a.call === 'XX' ? 'cxx' : a.call === 'P' ? 'cp' : 'bid';
    // the level is always black; only the suit symbol takes its suit's colour
    const txt = isBid ? `${a.call[0]}<span class="sy ${a.call[1] !== 'N' ? (red ? 'red' : 'blk') + ' s-' + a.call[1] : ''}">${SYM[a.call[1]]}</span>` : callText(a.call);
    const cls = !text ? '' : ak && ak.kind === 'alert' ? 'alert' : 'expl';
    cells.push(`<div class="c ${kind} ${cls}" ${text ? `role="button" tabindex="0" aria-label="${esc(callText(a.call) + '. ' + expl)}" data-alert="${esc(expl)}" data-ai="${i}" title="${esc(expl)}"` : `aria-label="${callText(a.call)}"`}>${txt}</div>`);
  });
  if (t.phase === 'auction' && auction === t.auction) cells.push('<div class="c">?</div>');
  return `<div class="agrid">${cells.join('')}</div>`;
}
// Red suit symbols in red wherever they appear as text (contracts, chat, results). Only text between tags is
// touched, never attributes; the s-H / s-D classes keep the four-colour deck option working.
const redSym = html => html.replace(/(^|>)([^<]+)/g, (m, a, b) => a + b.replace(/[♥♦]/g, x => `<span class="rs s-${x === '♥' ? 'H' : 'D'}">${x}</span>`));
// A contract as text: the suit in its colour, and a doubled or redoubled contract's X / XX set apart in the
// auction box's colours (X red, XX blue), so "3NTX" reads as 3NT doubled. short: "3NTX E" for tables.
const contractWords = c => c ? `${c.level} ${STRAIN_WORD[c.strain]}${c.doubled === 2 ? ' redoubled' : c.doubled ? ' doubled' : ''} by ${SEAT_NAME[c.declarer]}` : 'Passed out'; // for screen readers
const dblHTML = d => d ? `<span class="xd${d === 2 ? ' xx' : ''}" title="${d === 2 ? 'Redoubled' : 'Doubled'}">${d === 2 ? 'XX' : 'X'}</span>` : '';
const contractHTML = (c, short) => !c ? (short ? 'Pass' : 'Passed out')
  : `<span class="ct">${c.level}${c.strain === 'N' ? 'NT' : `<span class="${isRed(c.strain) ? 'rs ' : ''}s-${c.strain}">${SYM[c.strain]}</span>`}${dblHTML(c.doubled)}</span> ${short ? c.declarer : 'by ' + SEAT_NAME[c.declarer]}`;
// Board indicator: one edge per seat as seen at this table (red = that side vulnerable), D on the dealer's edge, board number inside.
function boardBoxHTML(t, o) {
  const edge = { [o.top]: 'top', [o.right]: 'right', [o.bottom]: 'bottom', [o.left]: 'left' };
  const cols = SEATS.map(s => `--${edge[s]}:${isVul(t.vul, s) ? '#c0281c' : '#f4f4f4'}`).join(';');
  const dPos = edge[t.dealer];
  return `<div class="bbx" style="${cols}" role="img" aria-label="Board ${t.board}, dealer ${SEAT_NAME[t.dealer]}, ${vulText(t.vul)}"><span class="dl ${dPos} ${isVul(t.vul, t.dealer) ? 'onred' : ''}">D</span><b>${t.board}</b></div>`;
}
// Trick count: a standing card for our side's tricks, a lying card for theirs, and the contract.
function trickBoxHTML(t) {
  const c = t.contract; if (!c || t.phase === 'auction') return '';
  const side = mySeat(t) || c.declarer;
  const done = completedTricks(t.play);
  let ours = done.filter(tr => sameSide(trickWinner(tr, c.strain), side)).length, theirs = done.length - ours;
  const last = t.phase === 'done' && t.history[t.history.length - 1];
  if (last && last.contract && last.declTricks != null && ours + theirs !== 13) { // claim or concession: only the totals are known
    ours = sameSide(side, c.declarer) ? last.declTricks : 13 - last.declTricks; theirs = 13 - ours;
  }
  return `<div class="tbx" role="img" aria-label="${contractWords(c)}. Tricks: ${mySeat(t) ? 'your side' : 'declarer\'s side'} ${ours}, opponents ${theirs}"><div class="us" title="${mySeat(t) ? 'Your side' : 'Declarer\'s side'}">${ours}</div><div class="them" title="Opponents">${theirs}</div></div>`;
}
function vulText(v) { return v === 'None' ? 'Nobody vulnerable' : v === 'Both' ? 'Both vulnerable' : v === 'NS' ? 'N-S vulnerable' : 'E-W vulnerable'; }

function renderFelt() {
  const t = T, o = orient(t), mine = mySeat(t);
  let html = '';
  if (t.board) html += `<div class="corner tl">${boardBoxHTML(t, o)}${t.match ? `<div class="room">${t.match.room}</div>` : ''}${t.timeUp && t.phase !== 'done' ? '<br><span class="bclk over">Time\'s up: robots are finishing</span>' : t.phase !== 'done' && t.boardStart && t.boardLimit ? `<br><span class="bclk" data-start="${t.boardStart}" data-limit="${t.boardLimit || 0}"></span>` : ''}</div>`;
  html += `<div class="pos-top">${seatBlock(t, o.top, 'top')}</div>`;
  html += `<div class="pos-left">${seatBlock(t, o.left, 'left')}</div>`;
  html += `<div class="pos-right">${seatBlock(t, o.right, 'right')}</div>`;
  html += `<div class="pos-bottom">${seatBlock(t, o.bottom, 'bottom')}</div>`;

  let center = '', bn = '';
  if (t.phase === 'waiting') {
    const open = SEATS.filter(s => !t.seats[s]).map(s => SEAT_NAME[s]);
    center = `<div class="waitmsg">${mine ? 'Waiting for ' + open.join(', ') + '.<br><span class="note" style="color:inherit;opacity:.8">Invite friends with code ' + t.id + ' or this page\'s link, or add robots.</span>' : 'Choose a seat to play, or watch from here.'}</div>`;
  } else if (t.masked) { // team-match onlooker: the board is hidden until both rooms have played it
    center = `<div class="waitmsg">${t.phase === 'done' ? 'Waiting for the other room to finish this board.' : 'A board is in progress.'}<br><span class="note" style="color:inherit;opacity:.85">In a team match, onlookers see each board once both rooms have played it.</span></div>`;
  } else if (t.phase === 'auction') {
    center = auctionGridHTML(t);
  } else if (t.phase === 'play' || t.phase === 'done') {
    const tricks = t.play.tricks;
    const tr = tricks[tricks.length - 1];
    const full = tr && tr.cards.length === 4;
    const win = full ? trickWinner(tr, t.contract.strain) : null;
    // a finished trick stays up for a moment (tap to clear it sooner), then the table clears for the next lead
    let cleared = false;
    if (full && t.phase === 'play') {
      const key = t.id + ':' + t.board + ':' + tricks.length + ':' + tr.cards.map(pc => pc.card).join('');
      if (trickHold.key !== key) { trickHold.key = key; trickHold.until = Date.now() + trickHoldMs(); clearTimeout(trickHold.timer); trickHold.timer = setTimeout(() => { if (T) renderFelt(); }, trickHoldMs() + 20); }
      cleared = Date.now() >= trickHold.until;
    }
    if (tr && !cleared && t.phase !== 'done') { // once the board is over the result panel takes the middle (the play is in the hand record)
      center = `<div class="trick ${full && t.phase === 'play' ? 'full' : ''}" ${full && t.phase === 'play' ? 'data-cleartrick="1" title="Tap to clear"' : ''}>${tr.cards.map(pc => {
        const pos = Object.keys(o).find(k => o[k] === pc.seat);
        return `<div class="tslot ${pos}">${cardHTML(pc.card, pc.seat === win ? 'win' : '', 'tabindex="-1"')}</div>`;
      }).join('')}</div>`;
    } else if (t.phase === 'play') {
      if (!tricks.some(x => x.cards.length)) {
        const ld = nextSeat(t.contract.declarer);
        center = `<div class="announce"><div class="note">The contract is</div><div class="ac">${contractHTML(t.contract)}</div><div>${ld === mine ? '<b>You</b> lead' : SEAT_NAME[ld] + ' leads'}</div></div>`;
      } else center = `<div class="waitmsg">${SEAT_NAME[win || nextSeat(t.contract.declarer)]} to lead</div>`;
    }
    const ts = turnSeat(t);
    if (t.phase === 'play' && !t.claim && ts && !occupant(t, controllerOf(t, ts))) bn += `<div class="banner"><h3>Game paused</h3>${SEAT_NAME[controllerOf(t, ts)]} is empty. Sit there or add a robot.</div>`;
    if (t.claim) bn += claimBanner(t);
    bn += awayBanner(t) + undoBanner(t);
    if (t.phase === 'done' && !drawerMode.matches) bn += resultBanner(t);
  }
  if (t.phase === 'auction') {
    const ts = turnSeat(t);
    if (t.masked) { /* nothing to show */ }
    else if (!occupant(t, ts)) bn += `<div class="banner"><h3>Game paused</h3>${SEAT_NAME[ts]} is empty. Sit there or add a robot.</div>`;
    else bn += awayBanner(t);
    bn += undoBanner(t);
  }
  const lastOK = t.phase === 'play' && completedTricks(t.play).length > 0;
  html += `<div class="pos-center" ${lastOK ? 'data-lasttrick="1" title="Tap to see the last trick"' : ''}>${center}${bn ? `<div class="bwrap ${t.phase === 'done' ? 'done' : ''}">${bn}</div>` : ''}</div>`;
  $('felt').innerHTML = html;
  renderPlayInfo(t, t.phase === 'done' && drawerMode.matches && !t.masked && t.history.length ? `<div class="bwrap done">${resultBanner(t)}</div>` : '');
  fitTrick();
  const g = $('felt').querySelector('.agrid'); if (g) g.scrollTop = g.scrollHeight; // a long auction scrolls; show the latest calls
}
// Shrink the trick's cards when the middle of the table is too small for them, so they never cover the hands or plates.
function fitTrick() {
  const tr = $('felt').querySelector('.trick'), pc = tr && tr.parentElement;
  if (!tr || !pc.clientWidth) return;
  const cs = getComputedStyle(tr), v = n => parseFloat(cs.getPropertyValue(n)) || 0;
  const tw = v('--tw'), th = v('--th'), tg = v('--tg');
  if (!tw || !th) return;
  const k = Math.max(0.5, Math.min(1, (pc.clientWidth - 2) / (2 * (tw + tg)), (pc.clientHeight - 2) / (2 * th + 8)));
  tr.style.setProperty('--tk', k.toFixed(3));
}
const TRICK_HOLD_MS = 1200;
const speedMult = () => ({ slow: 1.6, normal: 1, fast: 0.45 })[Prefs.speed] || 1;
const trickHoldMs = () => T && T.local ? Math.round(TRICK_HOLD_MS * speedMult()) : TRICK_HOLD_MS;
const trickHold = { key: null, until: 0, timer: null };
// Tricks as on a real table: a trick your side won is an upright card, one the other side won lies sideways.
// Seated players count for their own side, spectators for the declaring side. No target is shown.
function tricksHTML(t) {
  const c = t.contract; if (!c || !t.play) return '';
  const side = mySeat(t) || c.declarer;
  const done = completedTricks(t.play);
  let seq = done.map(tr => sameSide(trickWinner(tr, c.strain), side));
  const last = t.phase === 'done' && t.history[t.history.length - 1];
  if (last && last.contract && last.declTricks != null && last.declTricks + (13 - last.declTricks) !== seq.length) { // claim or concession: only the totals are known
    const mineWon = sameSide(side, c.declarer) ? last.declTricks : 13 - last.declTricks;
    seq = Array.from({ length: 13 }, (_, i) => i < mineWon);
  }
  if (!seq.length) return '';
  const won = seq.filter(Boolean).length;
  return `<div class="tricks" role="img" aria-label="Tricks: ${won} won, ${seq.length - won} lost">${seq.map(w => `<i class="tk ${w ? 'won' : 'lost'}"></i>`).join('')}</div>`;
}
function claimBanner(t) {
  const c = t.claim, mine = mySeat(t);
  const left = 13 - completedTricks(t.play).length;
  let btns = '';
  if (mine && c.need.includes(mine) && !c.acc[mine]) btns = `<div class="row"><button class="btn primary" data-claim="yes">Accept</button><button class="btn" data-claim="no">Reject</button></div>`;
  else if (mine === c.by) btns = `<div class="row"><button class="btn" data-claim="cancel">Withdraw claim</button></div>`;
  else btns = '<p class="note">Waiting for the opponents to respond.</p>';
  return `<div class="banner"><h3>${SEAT_NAME[c.by]} claims</h3><div class="big">${c.tricks} of ${left}</div><p class="note">The claimer's cards are shown to the opponents.</p>${btns}</div>`;
}
function resultBanner(t) {
  const h = t.history[t.history.length - 1];
  if (!h) return '';
  const mine = mySeat(t);
  const sideScore = !mine ? h.scoreNS : (sideOf(mine) === 'NS' ? h.scoreNS : -h.scoreNS);
  const label = mine ? 'Your side' : 'N-S';
  const i = t.history.length - 1, next = mine || t.local || isHost(t);
  // online: a board can't start with an empty seat, so offer a robot for it instead of Next
  const empty = t.local ? [] : SEATS.filter(s => !t.seats[s]);
  const seatsBtn = movesOK(t) ? '<button class="btn small" data-seats="1" title="Move players before the next board">Seats</button>' : '';
  const go = !next ? '' : empty.length ? `<p class="note" style="margin:4px 0 0">${empty.map(s => SEAT_NAME[s]).join(' and ')} ${empty.length > 1 ? 'are' : 'is'} empty.</p><div class="row">${empty.map(s => `<button class="btn primary" data-robot="${s}">${empty.length > 1 ? 'Robot ' + s : 'Add robot'}</button>`).join('')}${seatsBtn}</div>`
    : `<div class="row"><button class="btn primary" data-next="1">Next board</button>${seatsBtn}</div>`;
  // one compact panel: contract and result, tricks and score, then the buttons (it must fit the middle of a phone's table)
  return `<div class="banner result"><h3>${h.contract ? `${contractHTML(h.contract)} <span class="res">${resultText(h.contract, h.declTricks)}</span>` : 'Passed out'}</h3>
    <div>${h.contract ? `${h.declTricks} trick${h.declTricks === 1 ? '' : 's'} for declarer<br>` : ''}${label} <b class="sc">${sideScore > 0 ? '+' : ''}${sideScore}</b>${h.vs ? `<br>${vsText(h)}` : ''}</div>
    ${go}
    <div class="row sub"><button class="btn small" data-record="${i}">Hand record</button>${h.tricks && h.tricks.length ? `<button class="btn small" data-review="${i}" aria-label="Review the play">Review</button>` : ''}</div></div>`;
}
// a deal played again: N-S here against N-S on the board it repeats
const vsText = h => `Board ${h.vs.board} again: ${h.vs.imps ? `N-S ${h.vs.imps > 0 ? '+' : ''}${h.vs.imps} IMP${Math.abs(h.vs.imps) === 1 ? '' : 's'}` : 'no swing'}`;
// the host can move players between boards (not in a team match, where the rooms' seats make the teams)
const movesOK = t => !t.local && !t.match && isHost(t) && (t.phase === 'done' || t.phase === 'waiting');
// Phones: the contract and the trick count sit under your hand (the sidebar is out of sight there); a phone held
// sideways also shows the end-of-board panel there, in the room the bidding box leaves, rather than over the table.
const phoneInfo = window.matchMedia('(max-width: 560px), (orientation: landscape) and (max-height: 520px)');
const pinfoHTML = t => t.contract && t.phase !== 'auction' ? `<div class="pinfo"><p class="pc">${contractHTML(t.contract)}</p>${trickBoxHTML(t)}</div>` : '';
function renderPlayInfo(t, banner) { $('playInfo').innerHTML = !phoneInfo.matches || t.masked ? '' : banner || pinfoHTML(t); }
function renderHand() {
  const t = T, el = $('myHand'), mine = mySeat(t);
  const seat = mine || orient(t).bottom; // spectators see the bottom seat here when allowed
  if (!t.hands || t.phase === 'waiting' || t.phase === 'done' || (!mine && !canSee(t, seat))) { el.innerHTML = ''; return; }
  const cards = currentCards(t, seat).slice().sort((a, b) => UI_SUITS.indexOf(suitOf(a)) - UI_SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a));
  const legal = mine ? myLegal(t, mine) : [];
  const myTurn = legal.length > 0;
  const w = el.clientWidth || 360;
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 64;
  const step = cards.length > 1 ? Math.min(cw * 0.5, (w - cw - 4) / (cards.length - 1)) : 0;
  // the bidding box below is as wide as a full 13-card hand
  document.documentElement.style.setProperty('--handW', Math.round(cw + 12 * Math.min(cw * 0.5, (w - cw - 4) / 12)) + 'px');
  el.innerHTML = `<div class="fan">${cards.map((c, i) => cardHTML(c, (myTurn ? (legal.includes(c) ? 'legal' : 'dim') : '') + (legal.includes(c) && c === selCard ? ' sel' : '') + (legal.includes(c) && isHint(c) ? ' hint' : ''), `style="margin-left:${i ? step - cw : 0}px" ${legal.includes(c) ? `data-play="${c}" data-seat="${seat}"` : 'tabindex="-1"'}`)).join('')}</div>`;
}
const STRAIN_WORD = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades', N: 'notrump' };
let bidFocus = null; // the bidding-box button that last had the focus
let kbdNav = false;  // the last input was the keyboard: when your turn to bid comes back, the focus returns to the box
document.addEventListener('keydown', e => { if (['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) kbdNav = true; }, true);
document.addEventListener('pointerdown', () => { kbdNav = false; }, true);
const bidSeated = t => !!(t.phase === 'auction' && mySeat(t) && !t.timeUp && !t.masked);
const bidActive = () => !$('bidArea').classList.contains('hidden') && !$('bidArea').classList.contains('idle');
function renderBidBox() {
  const t = T, mine = mySeat(t);
  // While you sit in the auction the box stays in place (greyed out between your turns), so the page doesn't jump.
  const seated = bidSeated(t);
  const show = seated && turnSeat(t) === mine;
  const area = $('bidArea'), ae = document.activeElement;
  // the button that had the focus (keyboard users), to put it back after the box is redrawn
  let keep = ae && area.contains(ae) && ['level', 'strain', 'call', 'confirmcall', 'cancelcall'].find(k => ae.dataset[k] !== undefined);
  keep = keep ? `[data-${keep}="${ae.dataset[keep]}"]` : null;
  if (keep) bidFocus = keep;
  area.classList.toggle('hidden', !seated);
  area.classList.toggle('idle', !!seated && !show);
  if (!show) { selLevel = null; pendingCall = null; $('bbConfirm').classList.add('hidden'); }
  if (!seated) return;
  const legal = show ? legalCalls(t.dealer, t.auction) : [];
  const minLevel = [1, 2, 3, 4, 5, 6, 7].find(l => STRAINS.some(s => legal.includes(l + s)));
  if (selLevel && !STRAINS.some(s => legal.includes(selLevel + s))) selLevel = null;
  const hc = show && hint && hint.call && hint.key === hintKey(t) ? hint.call : null;
  $('bbLevels').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(l => `<button class="bcard ${selLevel === l ? 'sel' : ''} ${hc && hc[0] === String(l) ? 'hint' : ''}" data-level="${l}" aria-pressed="${selLevel === l}" ${!minLevel || l < minLevel ? 'disabled' : ''}>${l}</button>`).join('');
  $('bbStrains').innerHTML = STRAINS.map(s => {
    const ok = selLevel && legal.includes(selLevel + s);
    return `<button class="bcard ${isRed(s) ? 'red' : ''} s-${s} ${ok && pendingCall === selLevel + s ? 'sel' : ''} ${hc && hc[1] === s && (!selLevel || selLevel === +hc[0]) ? 'hint' : ''}" data-strain="${s}" aria-label="${selLevel ? selLevel + ' ' : ''}${STRAIN_WORD[s]}" ${ok ? '' : 'disabled'}>${SYM[s]}</button>`;
  }).join('');
  const ps = c => (pendingCall === c ? 'sel' : '') + (hc === c ? ' hint' : '');
  $('bbSpecial').innerHTML = `<button class="bcard pass ${ps('P')}" data-call="P" ${show ? '' : 'disabled'}>Pass</button><button class="bcard dbl ${ps('X')}" data-call="X" aria-label="Double" ${legal.includes('X') ? '' : 'disabled'}>X</button><button class="bcard rdbl ${ps('XX')}" data-call="XX" aria-label="Redouble" ${legal.includes('XX') ? '' : 'disabled'}>XX</button>`;
  if (show && bidFocus && (keep || (kbdNav && (!document.activeElement || document.activeElement === document.body)))) {
    const el = area.querySelector(bidFocus);
    (el && !el.disabled ? el : area.querySelector('[data-call="P"]')).focus({ preventScroll: true }); // e.g. a strain that is no longer open: Pass
  }
  if (!show) return;
  if (pendingCall && !legal.includes(pendingCall)) pendingCall = null;
  const cf = $('bbConfirm');
  cf.classList.toggle('hidden', !pendingCall);
  cf.innerHTML = pendingCall ? `<button class="btn primary" data-confirmcall="1">${pendingCall === 'P' ? 'Pass' : pendingCall === 'X' ? 'Double' : pendingCall === 'XX' ? 'Redouble' : 'Bid ' + callText(pendingCall)}</button><button class="btn" data-cancelcall="1">Cancel</button>` : '';
}
let sideSig = { a: '', c: '', r: '' }, ddVersion = 0;
function renderSide(force) {
  const t = T;
  const aSig = [t.id, t.board, t.phase, t.auction.length, t.contract ? contractText(t.contract) : '', completedTricks(t.play).length, !!t.masked].join('|');
  if (force || aSig !== sideSig.a) { sideSig.a = aSig; renderAuctionPane(t); }
  const lc = t.chat[t.chat.length - 1];
  const cSig = [t.id, t.chat.length, lc ? (lc.n || lc.ts) + lc.text : ''].join('|');
  if (force || cSig !== sideSig.c) { sideSig.c = cSig; renderChatPane(t); }
  const lh = t.history[t.history.length - 1];
  const rSig = [t.id, t.history.length, lh ? lh.board : 0, otherRoom ? otherRoom.history.length : 0, ddVersion, DD.failed].join('|');
  if (force || rSig !== sideSig.r) { sideSig.r = rSig; renderResultsPane(t); }
}
function renderAuctionPane(t) {
  if (t.masked) { $('pane-auction').innerHTML = '<p class="empty">In a team match, onlookers see each board once both rooms have played it.</p>'; return; }
  $('pane-auction').innerHTML = t.board ? auctionGridHTML(t) + pinfoHTML(t) + (t.phase === 'auction' ? '<p class="note">Calls with a red outline are alerted; gold-outlined calls are explained. Tap any to read it.</p>' : '') : '<p class="empty">The auction appears here once the board is dealt.</p>';
}
function renderChatPane(t) {
  const log = $('chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.innerHTML = redSym(t.chat.length ? t.chat.map(m => m.sys ? `<div class="msg sys">${esc(m.text)}</div>` : `<div class="msg"><span class="who">${esc(t.local && m.from === me.id && m.name === 'Player' ? 'You' : m.name)}${m.seat ? ' (' + m.seat + ')' : m.kib ? ' (spectators)' : ''}:</span> ${esc(m.text)}</div>`).join('') : '');
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function renderResultsPane(t) {
  let ns = 0, ew = 0, imps = 0, impN = 0;
  t.history.forEach(h => { if (h.scoreNS > 0) ns += h.scoreNS; else ew -= h.scoreNS; requestDD(h.hands, false); });
  const sgn = v => (v > 0 ? '+' : '') + v;
  let head, rowsR, summary = '', note = 'Tap a board to see its hand record.';
  if (t.local) {
    // your table against a table of four robots playing the same deals, board by board, in IMPs
    head = '<th>Bd</th><th>You</th><th class="num">N-S</th><th>Robots</th><th class="num">N-S</th><th class="num">IMPs</th>';
    const res = c => c ? cShort(c.contract) + (c.contract ? ' ' + resultText(c.contract, c.declTricks) : '') : '';
    rowsR = t.history.map((h, i) => {
      const o = h.other; const im = o ? toImps(h.scoreNS - o.scoreNS) : null;
      if (im !== null) { imps += im; impN++; }
      return `<tr class="click" data-record="${i}" tabindex="0" aria-label="Board ${h.board}: hand record"><td>${h.board}</td><td>${res(h)}</td><td class="num">${h.scoreNS}</td><td>${o ? res(o) : ''}</td><td class="num">${o ? o.scoreNS : ''}</td><td class="num"><b>${im === null ? '' : im ? sgn(im) : '0'}</b></td></tr>`;
    }).reverse().join('');
    note = 'IMPs against four robots playing the same deals. Tap a board to see its hand record.';
  } else if (t.match) {
    const other = otherRoom && otherRoom.history || [];
    const openNS = (bd) => (t.match.room === 'Open' ? t.history : other).find(h => h.board === bd);
    const closedNS = (bd) => (t.match.room === 'Open' ? other : t.history).find(h => h.board === bd);
    head = `<th>Bd</th><th>Open</th><th class="num">N-S</th><th>Closed</th><th class="num">N-S</th><th class="num">IMPs</th>`;
    const boards = [...new Set([...t.history, ...other].map(h => h.board))].sort((x, y) => y - x);
    let t1 = 0, t2 = 0;
    rowsR = boards.map(bd => {
      const o = openNS(bd), c = closedNS(bd);
      const im = o && c ? toImps(o.scoreNS - c.scoreNS) : null;
      if (im !== null) { if (im > 0) t1 += im; else t2 -= im; }
      const i = t.history.findIndex(h => h.board === bd);
      return `<tr ${i >= 0 ? `class="click" data-record="${i}" tabindex="0"` : ''}><td>${bd}</td><td>${o ? cShort(o.contract) + (o.contract ? ' ' + resultText(o.contract, o.declTricks) : '') : '…'}</td><td class="num">${o ? o.scoreNS : ''}</td><td>${c ? cShort(c.contract) + (c.contract ? ' ' + resultText(c.contract, c.declTricks) : '') : '…'}</td><td class="num">${c ? c.scoreNS : ''}</td><td class="num">${im === null ? '' : im > 0 ? im + ' T1' : im < 0 ? -im + ' T2' : '0'}</td></tr>`;
    }).join('');
    summary = `<div class="totals"><span>Team 1: ${t1} IMPs</span><span>Team 2: ${t2} IMPs</span></div><p class="note" style="margin:-4px 0 8px">Team 1 sits N-S in the Open room and E-W in the Closed room.</p>`;
    note = 'A board is scored once both rooms have finished it.';
  } else {
    head = '<th>Bd</th><th>Contract</th><th>Res</th><th class="num">N-S</th><th class="num">Par</th><th class="num">IMPs</th>';
    rowsR = t.history.map((h, i) => {
      const par = parFor(h);
      const im = par ? toImps(h.scoreNS - par.scoreNS) : null;
      if (im !== null) { imps += im; impN++; }
      return `<tr class="click" data-record="${i}" tabindex="0"><td>${h.board}</td><td>${cShort(h.contract)}</td><td>${h.contract ? resultText(h.contract, h.declTricks) : ''}</td><td class="num">${h.scoreNS}</td><td class="num">${par ? par.scoreNS : DD.failed ? '–' : '…'}</td><td class="num">${im === null ? '' : sgn(im)}</td></tr>`;
    }).reverse().join('');
    if (impN) summary = `<p class="note" style="margin:-4px 0 8px">N-S ${sgn(imps)} IMPs against par over ${impN} board${impN === 1 ? '' : 's'}.</p>`;
    // each person over the boards they played (people may change seats between boards); E-W's sign is flipped
    const per = new Map();
    t.history.forEach(h => {
      const par = parFor(h); if (!par || !h.players) return;
      const im = toImps(h.scoreNS - par.scoreNS);
      for (const s of SEATS) {
        const p = h.players[s]; if (!p || p.kind !== 'human') continue;
        const e = per.get(p.id) || { name: p.name, imps: 0, n: 0 }; e.name = p.name;
        e.imps += sideOf(s) === 'NS' ? im : -im; e.n++; per.set(p.id, e);
      }
    });
    if (per.size) summary += `<table class="reslist people"><tr><th>Player</th><th class="num">Boards</th><th class="num">IMPs</th></tr>${[...per.entries()].sort((a, b) => b[1].imps - a[1].imps).map(([id, e]) => `<tr><td>${esc(id === me.id ? 'You' : e.name)}</td><td class="num">${e.n}</td><td class="num">${e.imps ? sgn(e.imps) : '0'}</td></tr>`).join('')}</table>`;
    if (!DD.failed) note += ' Par fills in once the analysis finishes.';
  }
  const any = t.history.length || (t.match && otherRoom && otherRoom.history.length);
  const totals = t.match ? '' : t.local ? `<div class="totals"><span>${t.history.length} board${t.history.length === 1 ? '' : 's'}</span><span>${impN ? sgn(imps) + ' IMP' + (Math.abs(imps) === 1 ? '' : 's') : ''}</span></div>` : `<div class="totals"><span>N-S ${ns}</span><span>E-W ${ew}</span></div>`;
  $('pane-results').innerHTML = redSym(any ? `${totals}${summary}
    <table class="reslist"><tr>${head}</tr>${rowsR}</table><p class="note">${note}</p>
    ${t.history.length ? '<div class="row"><button class="btn small" id="pbnAll">Download all boards (PBN)</button></div>' : ''}` : '<p class="empty">Finished boards appear here.</p>');
  const pa = $('pbnAll'); if (pa) pa.addEventListener('click', () => downloadText(`bridge-${t.id}.pbn`, t.history.map(h => pbnBoard(h, t)).join('\n\n') + '\n'));
}
const cShort = c => contractHTML(c, true);
function renderTop() {
  const t = T, mine = mySeat(t);
  $('tName').textContent = t.name;
  $('tCode').textContent = t.local ? '' : (t.private ? 'Private, code ' : 'Code ') + t.id;
  $('lastTrickBtn').disabled = !(t.play && completedTricks(t.play).length);
  $('lastTrickBtn').classList.toggle('hidden', $('lastTrickBtn').disabled);
  const probe = { ...t, play: { ...t.play }, chat: [] };
  $('undoBtn').disabled = !(mine && !t.undoReq && (t.local || t.allowUndo !== false) && doUndo(probe, mine) !== false && (t.phase === 'auction' || t.phase === 'play'));
  $('settingsBtn').classList.toggle('hidden', !isHost(t));
  $('roomBtn').classList.toggle('hidden', !t.match);
  if (t.match) $('roomBtn').textContent = `Go to ${t.match.room === 'Open' ? 'Closed' : 'Open'} room`;
  $('undoBtn').classList.toggle('hidden', $('undoBtn').disabled || (!t.local && t.allowUndo === false));
  $('claimBtn').disabled = !(mine && t.phase === 'play' && !t.claim && mine !== dummySeat(t) && t.play.tricks.length > 0);
  $('claimBtn').classList.toggle('hidden', $('claimBtn').disabled);
  $('hintBtn').classList.toggle('hidden', !hintOK(t));
}
function render() {
  if (!T) return;
  autoTab(T);
  if (hint && hint.key !== hintKey(T)) { hint = null; if ($('explainPop') && $('explainPop').dataset.hint) hideExplain(); }
  if (selCard) { const ts = turnSeat(T); if (T.phase !== 'play' || !ts || !myLegal(T, ts).includes(selCard)) selCard = null; }
  const ae = document.activeElement; let keep = null;
  if (ae && ae !== document.body && ae.dataset) for (const a of ['play', 'level', 'strain', 'call', 'confirmcall', 'cancelcall', 'claim', 'next', 'record', 'review', 'ai']) {
    if (ae.dataset[a] !== undefined) { const box = ae.closest('#felt, #myHand, #bidArea, #side'); keep = `${box ? '#' + box.id + ' ' : ''}[data-${a}="${ae.dataset[a]}"]`; break; }
  }
  // the table is shorter while the bidding box is below it (set before drawing, since the felt measures itself)
  $('tableView').classList.toggle('bidding', bidSeated(T));
  renderTop(); showWatchers(); renderOnline(); renderFelt(); renderHand(); renderBidBox(); renderSide(); tick();
  if (keep && (!document.activeElement || document.activeElement === document.body)) { const el = document.querySelector(keep); if (el) el.focus({ preventScroll: true }); }
  lastRenderedVersion = T.version;
  refreshOtherRoom();
  if (T.hands && T.phase === 'done' && SEATS.every(s => T.hands[s].every(c => c[0] !== '?'))) requestDD(T.hands, true, T.contract ? T.contract.strain : null);
  const mt = isMyTurn(T);
  if (mt && !wasMyTurn) {
    beep();
    // your turn to bid: bring the bidding box into view (laptops and phones may have it below the fold)
    if (T.phase === 'auction' && bidActive() && !$('modalRoot').firstChild) $('bidArea').scrollIntoView({ block: 'nearest' });
  }
  wasMyTurn = mt;
  claimFeedback(T); chatUnread(T); refreshSeats();
  updateTitle();
  scheduleRobot();
  autoNext(T); savePractice();
}

// ---------- modals ----------
let modalReturn = null;
function setBackgroundInert(on) { for (const id of ['home', 'tableView']) { const el = $(id); if (el) el.inert = on; } }
function closeModal() {
  $('modalRoot').innerHTML = ''; openRecord = null; replayDraw = null; setBackgroundInert(false);
  const r = modalReturn; modalReturn = null;
  if (r && r.isConnected) r.focus({ preventScroll: true });
}
function modal(html, bare) { // bare: a question with its own answer buttons (one of them cancels), so no ✕
  if (!$('modalRoot').firstChild) modalReturn = document.activeElement;
  // one close button, ✕ at the top right, which stays in view while a long window (the hand record) scrolls
  $('modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="box">${bare ? '' : '<div class="mtop"><button class="btn small mclose" data-close="1" aria-label="Close">✕</button></div>'}${html}</div></div>`;
  const m = $('modalRoot').firstChild;
  setBackgroundInert(true);
  m.addEventListener('click', e => { if (e.target === m || e.target.dataset.close) closeModal(); });
  m.addEventListener('keydown', e => { // Tab and Shift+Tab cycle within the dialog
    if (e.key !== 'Tab') return;
    const f = [...m.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
  openRecord = null; replayDraw = null;
  const b = m.querySelector('button:not(.mclose):not(:disabled)') || m.querySelector('button'); if (b) b.focus({ preventScroll: true });
  return m;
}
function showLastTrick() {
  const done = completedTricks(T.play); if (!done.length) return;
  const tr = done[done.length - 1], o = orient(T), win = trickWinner(tr, T.contract.strain);
  const cell = pos => { const pc = tr.cards.find(x => x.seat === o[pos]); return pc ? `<div>${cardHTML(pc.card, pc.seat === win ? 'win' : '', 'tabindex="-1"')}<div class="lbl">${SEAT_NAME[pc.seat]}${pc.seat === tr.leader ? ', led' : ''}</div></div>` : ''; };
  modal(`<h3>Trick ${done.length}</h3><div class="diagram"><div></div>${cell('top')}<div></div>${cell('left')}<div></div>${cell('right')}<div></div>${cell('bottom')}<div></div></div><p class="note">Won by ${SEAT_NAME[win]}.</p>`);
}
function showRecord(i) {
  const h = T.history[i]; if (!h) return;
  const hand = s => `<div><div class="lbl">${SEAT_NAME[s]}</div>${rowsHTML(h.hands[s])}</div>`;
  const tt = h.tricks && h.tricks.length ? `<h3 style="font-size:16px;margin-top:12px">Play</h3><div id="playBox">${playTableHTML(h)}</div>` : '';
  modal(`<h3>Board ${h.board}</h3><p class="note" style="margin-top:-6px">Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
    <div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}<div class="lbl">${h.contract ? contractHTML(h.contract) + '<br>' + resultText(h.contract, h.declTricks) + ', N-S ' + h.scoreNS : 'Passed out'}</div>${hand('E')}<div></div>${hand('S')}<div></div></div>
    ${auctionGridHTML(T, h.auction, h.dealer, h.vul, null)}
    ${otherLine(h)}${h.vs ? `<p>${vsText(h)}.</p>` : ''}
    <h3 style="font-size:16px;margin-top:12px">Double-dummy analysis</h3><div id="ddBox">${ddHTML(h)}</div>${tt}
    <div class="row" style="margin-top:10px"><span class="note">Save this board:</span><button class="btn small" data-export="pdf">PDF</button><button class="btn small" data-export="doc">Word (.doc)</button><button class="btn small" data-export="pbn">PBN file</button><button class="btn small" id="pbnOne">Copy PBN</button>${h.tricks && h.tricks.length ? '<button class="btn small" id="replayBtn">Replay the play</button>' : ''}${T.phase === 'done' && !T.match && (T.local || isHost(T)) ? '<button class="btn small" id="playAgain">Play this deal again</button>' : ''}</div><div id="replayBox"></div>`);
  openRecord = i;
  $('pbnOne').addEventListener('click', () => copyText(pbnBoard(h, T)));
  $('modalRoot').querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportRecord(h, b.dataset.export)));
  if ($('replayBtn')) $('replayBtn').addEventListener('click', () => startReplay(h));
  if ($('playAgain')) $('playAgain').addEventListener('click', () => { closeModal(); if (T.local) act(s => A.next(s, s.history.find(x => x.board === h.board))); else doAct('next', { replay: h.board }); });
}
// the cards that kept the double-dummy result: "any ♣" for a whole suit of the legal cards, else the cards themselves
function betterText(r) {
  const out = [];
  for (const su of UI_SUITS) {
    const b = r.best.filter(c => suitOf(c) === su); if (!b.length) continue;
    const all = (r.legal || []).filter(c => suitOf(c) === su).length === b.length && b.length > 1;
    if (all) out.push(`any <span class="${isRed(su) ? 'red' : ''} s-${su}">${SYM[su]}</span>`); else out.push(...sortForHand(b).map(cardText));
  }
  return out.length > 1 ? out.slice(0, -1).join(', ') + ' or ' + out[out.length - 1] : out.join('');
}
const cardText = c => `<span class="${isRed(suitOf(c)) ? 'red' : ''} s-${suitOf(c)}">${SYM[suitOf(c)]}${rankLabel(c[1])}</span>`;
// The play, trick by trick. Once the review (js/analysis.js playReview) has checked a card double dummy, a card
// that cost tricks carries a small −1 (or −2...), and the list under the table says what would have kept them.
function playTableHTML(h) {
  const rv = playReview(h), flat = reviewFlat(h), loss = {};
  if (rv) flat.forEach((pc, i) => { const r = rv.res[i]; if (r && r.loss > 0) loss[pc.trick + pc.seat] = r.loss; });
  const table = `<table class="ttable"><tr><td></td>${SEATS.map(s => `<td>${s}</td>`).join('')}</tr>${h.tricks.map((tr, k) => {
    const w = tr.cards.length === 4 ? trickWinner(tr, h.contract.strain) : null;
    return `<tr><td>${k + 1}</td>${SEATS.map(s => { const pc = tr.cards.find(x => x.seat === s), l = loss[k + s]; return `<td class="${s === w ? 'w' : ''} ${pc && isRed(suitOf(pc.card)) ? 'red' : ''} ${pc ? 's-' + suitOf(pc.card) : ''}">${pc ? SYM[suitOf(pc.card)] + rankLabel(pc.card[1]) : ''}${l ? `<sup class="cost" title="Cost ${l} trick${l > 1 ? 's' : ''} double dummy">−${l}</sup>` : ''}</td>`; }).join('')}</tr>`;
  }).join('')}</table>`;
  let review = '';
  if (rv && !rv.done) review = `<p class="note">Checking each card double dummy… ${rv.n} of ${rv.res.length}</p>`;
  else if (rv) {
    const bad = flat.map((pc, i) => ({ pc, r: rv.res[i] })).filter(x => x.r && x.r.loss > 0);
    if (!bad.length) review = '<p class="note">Double dummy, no card played cost a trick.</p>';
    else {
      const decl = h.contract.declarer, dummy = partnerOf(decl), side = { d: 0, o: 0 };
      bad.forEach(x => { side[sameSide(x.pc.seat, decl) ? 'd' : 'o'] += x.r.loss; });
      const tr = n => n + ' trick' + (n === 1 ? '' : 's');
      review = `<p class="note" style="margin-bottom:2px">Double dummy, ${[side.d ? 'declarer gave away ' + tr(side.d) : '', side.o ? 'the defence gave away ' + tr(side.o) : ''].filter(Boolean).join(' and ')}:</p><ul class="costs">${bad.map(x => `<li>Trick ${x.pc.trick + 1}, ${SEAT_NAME[x.pc.seat]}${x.pc.seat === dummy ? ' (dummy)' : ''} played ${cardText(x.pc.card)} <span class="cost">−${x.r.loss}</span>${x.r.best.length ? `. Better: ${betterText(x.r)}` : ''}</li>`).join('')}</ul>`;
    }
  }
  return table + review + '<p class="note">The underlined card won each trick. Use Replay the play to step through it card by card.</p>';
}
// called by js/analysis.js as the review of the open hand record comes in
function redrawReview() {
  if (!T || openRecord === null) return;
  const h = T.history[openRecord], box = $('playBox');
  if (h && box) box.innerHTML = playTableHTML(h);
  if (replayDraw) replayDraw();
}
function otherLine(h) {
  let o = h.other, label = 'Robot table';
  if (!o && T.match && otherRoom) { o = otherRoom.history.find(x => x.board === h.board); label = T.match.room === 'Open' ? 'Closed room' : 'Open room'; }
  if (!o) return '';
  const im = T.match ? toImps((T.match.room === 'Open' ? h.scoreNS - o.scoreNS : o.scoreNS - h.scoreNS)) : toImps(h.scoreNS - o.scoreNS);
  return `<p><b>${label}:</b> ${o.contract ? contractHTML(o.contract) + ' ' + resultText(o.contract, o.declTricks) : 'Passed out'}, N-S ${o.scoreNS}. ${T.match ? (im ? `${Math.abs(im)} IMP${Math.abs(im) === 1 ? "" : "s"} to Team ${im > 0 ? 1 : 2}` : 'No swing') : (im ? `${im > 0 ? '+' : ''}${im} IMP${Math.abs(im) === 1 ? '' : 's'} to you` : 'No swing')}.</p>
    ${o.auction ? `<details><summary class="note">Their auction</summary>${auctionGridHTML(T, o.auction, h.dealer, h.vul, null)}</details>` : ''}`;
}
function showClaimDialog() {
  if (!T || T.phase !== 'play' || T.claim) return;
  const left = 13 - completedTricks(T.play).length;
  let pick = left;
  const m = modal(`<h3>Claim</h3><p>How many of the remaining ${left} tricks will your side take?</p><div class="numgrid">${Array.from({ length: left + 1 }, (_, n) => `<button class="btn ${n === left ? 'sel' : ''}" data-n="${n}" aria-pressed="${n === left}">${n}</button>`).join('')}</div><div class="row"><button class="btn primary" id="doClaim">Claim ${left}</button><span class="note">Choosing 0 concedes the rest.</span></div>`);
  m.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    pick = +b.dataset.n; m.querySelectorAll('[data-n]').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', x === b); }); $('doClaim').textContent = 'Claim ' + pick;
  }));
  $('doClaim').addEventListener('click', () => {
    closeModal();
    if (!T || T.phase !== 'play' || T.claim) { toast('The board moved on, so there is nothing to claim.'); return; }
    // a trick finished while the dialog was open: ask again with the new number rather than send a claim that can't fit
    if (13 - completedTricks(T.play).length !== left) { toast('A trick was completed meanwhile. Choose again.'); showClaimDialog(); return; }
    const lc = T.chat[T.chat.length - 1];
    claimWatch = { id: T.id, board: T.board, mark: lc ? chatKey(lc) : '' };
    doAct('claim', pick, left); // the count shown, so a claim made against a stale count is refused
  });
}
// Tell the claimer when a claim is turned down (otherwise it's only a line in the chat).
let claimWatch = null;
const chatKey = m => (m.n || m.ts || 0) + '|' + m.text;
function claimFeedback(t) {
  const mine = mySeat(t);
  if (t.claim && mine && t.claim.by === mine && !claimWatch) claimWatch = { id: t.id, board: t.board, mark: '' };
  if (!claimWatch || t.claim) return;
  const w = claimWatch; claimWatch = null;
  if (w.id !== t.id || w.board !== t.board || t.phase !== 'play') return; // accepted (board over), or another table
  for (let i = t.chat.length - 1; i >= Math.max(0, t.chat.length - 10); i--) {
    const m = t.chat[i];
    if (w.mark && chatKey(m) === w.mark) return; // nothing new about the claim
    if (!m.sys) continue;
    if (/rejected the claim|claim lapsed/.test(m.text)) { toast(m.text.replace('rejected the claim', 'rejected your claim'), 4500); return; }
    if (/withdrew the claim| claims \d+ of /.test(m.text)) return;
  }
}
// An unread mark on the Chat tab (and the sidebar button) when someone writes while the chat is out of sight.
let chatSeen = { id: null, n: 0, last: '' };
function chatVisible() {
  if (document.hidden || currentTab() !== 'chat' || $('tableView').classList.contains('hidden')) return false;
  if (drawerMode.matches && !$('side').classList.contains('open')) return false;
  const r = $('chatLog').getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}
function chatUnread(t) {
  const lc = t.chat[t.chat.length - 1], last = lc ? chatKey(lc) : '';
  if (chatSeen.id !== t.id) chatSeen = { id: t.id, n: 0, last }; // a table you just opened: its old chat counts as read
  if (last !== chatSeen.last) {
    let fresh = 0;
    for (let i = t.chat.length - 1; i >= 0; i--) { const m = t.chat[i]; if (chatKey(m) === chatSeen.last) break; if (!m.sys && m.from !== me.id) fresh++; }
    chatSeen.last = last;
    if (fresh && !chatVisible()) chatSeen.n += fresh;
  }
  if (chatSeen.n && chatVisible()) chatSeen.n = 0;
  const on = chatSeen.n > 0;
  const tab = document.querySelector('.tabs [data-tab="chat"]');
  tab.classList.toggle('unread', on); $('sideBtn').classList.toggle('unread', on);
  tab.setAttribute('aria-label', on ? `Chat, ${chatSeen.n} unread` : 'Chat');
}
const recheckUnread = () => { if (T && chatSeen.n && chatVisible()) chatUnread(T); };
window.addEventListener('scroll', recheckUnread, { passive: true });


// ---------- turn sound ----------
let soundOn = false, audioCtx = null, wasMyTurn = false;
function beep() {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 740; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.26);
  } catch (e) { }
  if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { }
}
function isMyTurn(t) {
  const mine = mySeat(t), ts = turnSeat(t);
  if (!mine || !ts || t.claim) return false;
  return controllerOf(t, ts) === mine;
}

// ---------- spectators ----------
let watchTimer = null;
// ----- presence: who is connected, who is away, robot stand-ins -----
function seatAway(t, seat) {
  const o = t.seats[seat];
  return !t.local && o && o.kind === 'human' && t.away && t.away[seat] ? t.away[seat] : 0;
}
function awayTag(t, seat) {
  if (t.local) return '';
  if (t.subs && t.subs[seat]) return ' <span class="away">robot playing</span>';
  return seatAway(t, seat) ? ' <span class="away">away</span>' : '';
}
function awayBanner(t) {
  if (t.local || t.claim) return '';
  const ts = turnSeat(t); if (!ts) return '';
  const ctrl = controllerOf(t, ts);
  if (!seatAway(t, ctrl) || (t.subs && t.subs[ctrl])) return '';
  const mine = mySeat(t);
  const btn = mine && mine !== ctrl ? `<div class="row"><button class="btn primary" data-sub="${ctrl}">Let a robot play for ${SEAT_NAME[ctrl]}</button></div>` : '';
  return `<div class="banner"><h3>${esc(seatLabel(t, ctrl))} is away</h3><p class="note">${SEAT_NAME[ctrl]} lost their connection. When they open this table again, they take over from any robot straight away.</p>${btn}</div>`;
}
function renderOnline() { $('inviteBtn').classList.toggle('hidden', !!T.local); renderSeatRequests(); renderChatHint(); ensureWakeLock(); }
$('inviteBtn').addEventListener('click', () => { if (T && !T.local) copyText(`${location.origin}${location.pathname}#${T.id}`); });

// ----- recent tables on this device -----
function rememberTable(t) {
  const list = (Local.get('bt:recent') || []).filter(x => x.code !== t.id);
  list.unshift({ code: t.id, name: t.name, at: Date.now() });
  Local.set('bt:recent', list.slice(0, 6));
}
function forgetTable(code) { Local.set('bt:recent', (Local.get('bt:recent') || []).filter(x => x.code !== code)); renderRecent(); }
function renderRecent() {
  const list = (Local.get('bt:recent') || []).filter(x => Date.now() - x.at < 3 * 24 * 3600e3);
  $('recentBox').classList.toggle('hidden', !list.length);
  $('recentList').innerHTML = list.map(x => `<div class="trow"><div><div class="tname">${esc(x.name)}</div><div class="tmeta">Code ${esc(x.code)}</div></div><button class="btn" data-rejoin="${esc(x.code)}">Return to table</button></div>`).join('');
  $('recentList').querySelectorAll('[data-rejoin]').forEach(b => b.addEventListener('click', () => { if (needName()) openOnline(b.dataset.rejoin); }));
}

window.addEventListener('pagehide', flushPractice);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPractice(); });

// ----- tell people in another tab or app that it's their turn -----
const BASE_TITLE = document.title;
function updateTitle() { document.title = T && isMyTurn(T) && document.hidden ? 'Your turn: ' + BASE_TITLE : BASE_TITLE; }
document.addEventListener('visibilitychange', updateTitle);

// ----- seat requests (tables with locked seats) -----
function renderSeatRequests() {
  const el = $('seatReqs');
  const reqs = !T.local && isHost(T) && T.requests ? Object.entries(T.requests) : [];
  el.classList.toggle('hidden', !reqs.length);
  el.innerHTML = reqs.map(([uid, r]) => {
    const free = !T.seats[r.seat] || T.seats[r.seat].kind !== 'human';
    return `<div class="row"><span>${esc(r.name)} would like to sit ${SEAT_NAME[r.seat]}</span><span class="row" style="gap:6px">${free ? `<button class="btn small primary" data-grant="${esc(uid)}">Seat ${esc(r.name)}</button>` : ''}<button class="btn small" data-decline="${esc(uid)}">Decline</button></span></div>`;
  }).join('');
  el.querySelectorAll('[data-grant]').forEach(b => b.addEventListener('click', () => doAct('grant', b.dataset.grant)));
  el.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => doAct('decline', b.dataset.decline)));
}

// ----- spectators chat among themselves while a board is in play -----
function renderChatHint() {
  const inPlay = T.phase === 'auction' || T.phase === 'play';
  $('chatInput').placeholder = !T.local && !mySeat(T) && inPlay ? 'Message the other spectators' : 'Table talk';
}

// ----- play under the same name on a second device -----
$('otherDeviceBtn').addEventListener('click', () => {
  if (!needName()) return;
  const link = `${location.origin}${location.pathname}#key=${me.secret}&name=${encodeURIComponent(me.name)}`;
  copyText(link);
  modal(`<h3>Play as ${esc(me.name)} on another device</h3><p>The link is copied. Open it on your other phone or computer, and that device will play as you, in the same seats.</p><p class="note">Anyone who opens this link can play as you, so send it only to yourself.</p>`);
});
async function adoptIdentityFromLink() {
  const m = /^#key=([0-9a-f]{32,64})(?:&name=([^&]*))?$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  if (m[1] === me.secret) return;
  if (me.secret && !confirm('This link will make this device play as a different player, and you will lose your current seats and recent tables on this device. Continue?')) return;
  me.secret = m[1]; me.id = await idFromSecret(me.secret);
  if (m[2]) { try { me.name = decodeURIComponent(m[2]).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20); } catch (e) { /* keep the old name */ } }
  saveMe(); $('nameInput').value = me.name || '';
  toast(`This device now plays as ${me.name || 'you'}`);
}

// ----- keep the phone's screen on while you're seated at a table -----
let wakeLock = null, wakeWanted = false, wakePending = false;
async function ensureWakeLock() {
  wakeWanted = !!(T && mySeat(T) && T.phase !== 'waiting');
  if (!wakeWanted) return releaseWakeLock();
  if (wakeLock || wakePending || document.hidden || !navigator.wakeLock) return;
  wakePending = true;
  try {
    const l = await navigator.wakeLock.request('screen');
    if (!wakeWanted) { l.release().catch(() => { }); return; } // left the table while waiting
    wakeLock = l; l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; });
  } catch (e) { wakeLock = null; } finally { wakePending = false; }
}
function releaseWakeLock() { wakeWanted = false; if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && wakeWanted) ensureWakeLock(); });

// ----- installable app and offline practice -----
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
  // a new version was installed while this page was open: offer to reload (it loads by itself next time anyway)
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'updated' || document.querySelector('.toast.update')) return;
    const d = document.createElement('div'); d.className = 'toast update'; d.setAttribute('role', 'status');
    d.innerHTML = 'A new version of the app is ready. <button class="btn small">Reload</button>';
    d.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(d); setTimeout(() => d.remove(), 15000);
  });
}

// ----- "More" menu on phones -----
const drawerMode = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
function syncSideInert() { $('side').inert = drawerMode.matches && !$('side').classList.contains('open'); }
function setSide(open) { $('side').classList.toggle('open', open); $('sideBtn').setAttribute('aria-expanded', open); syncSideInert(); if (open) { const t = $('side').querySelector('[aria-selected=true]'); if (t) t.focus(); } else $('sideBtn').focus(); recheckUnread(); }
drawerMode.addEventListener('change', syncSideInert); syncSideInert();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('side').classList.contains('open') && !$('modalRoot').firstChild) setSide(false); });
$('sideBtn').addEventListener('click', () => {
  if (drawerMode.matches) { if (!$('side').classList.contains('open') && $('sideBtn').classList.contains('unread')) { tabAuto = false; selectTab('chat'); } setSide(!$('side').classList.contains('open')); return; }
  // phone held upright: the sidebar is below the table, so the button takes you to the chat
  tabAuto = false; selectTab('chat'); $('side').scrollIntoView({ block: 'start' }); recheckUnread();
});
$('sideClose').addEventListener('click', () => setSide(false));
$('moreBtn').addEventListener('click', () => {
  const bar = document.querySelector('.topbar'), open = !bar.classList.contains('open');
  bar.classList.toggle('open', open); $('moreBtn').setAttribute('aria-expanded', open);
});
$('moreBox').addEventListener('click', e => { if (e.target.closest('button')) { document.querySelector('.topbar').classList.remove('open'); $('moreBtn').setAttribute('aria-expanded', 'false'); } });

// ----- undo requests when the host requires the opponents' agreement -----
function undoBanner(t) {
  const r = !t.local && t.undoReq; if (!r) return '';
  const mine = mySeat(t);
  let body;
  if (mine && r.need.includes(mine)) body = `<p>${SEAT_NAME[r.by]} would like to take back their last call or card.</p><div class="row"><button class="btn primary" data-undoreply="yes">Allow</button><button class="btn" data-undoreply="no">Decline</button></div>`;
  else if (mine === r.by) body = `<p class="note">Waiting for the opponents to agree.</p><div class="row"><button class="btn" data-undocancel="1">Withdraw request</button></div>`;
  else body = `<p class="note">Waiting for the opponents to agree.</p>`;
  return `<div class="banner"><h3>Undo requested</h3>${body}</div>`;
}

// ----- replay a finished board card by card -----
let replayDraw = null; // updates the open replay's note when the play review comes in
function startReplay(h) {
  const flat = [];
  h.tricks.forEach((tr, k) => tr.cards.forEach((pc, j) => flat.push({ ...pc, trick: k, pos: j })));
  let step = flat.length; // number of cards shown as played
  const box = $('replayBox');
  // the line under the replay: the card just played, what it cost double dummy (once the review has it), the tricks so far
  const note = () => {
    const cur = step ? flat[step - 1] : null;
    if (!cur) return 'Before the opening lead.';
    const tw = { decl: 0, def: 0 };
    h.tricks.slice(0, cur.pos === 3 ? cur.trick + 1 : cur.trick).forEach(tr => {
      if (tr.cards.length === 4) (sameSide(trickWinner(tr, h.contract.strain), h.contract.declarer) ? tw.decl++ : tw.def++);
    });
    const rv = playReview(h), r = rv && rv.res[step - 1];
    const cost = r && r.loss > 0 ? ` It cost ${r.loss} trick${r.loss > 1 ? 's' : ''} double dummy${r.best.length ? ` (better: ${betterText(r)})` : ''}.` : '';
    return `Trick ${cur.trick + 1}, card ${cur.pos + 1}: ${SEAT_NAME[cur.seat]} played ${cardText(cur.card)}.${cost} Declarer ${tw.decl}, defence ${tw.def}.`;
  };
  replayDraw = () => { const el = box.querySelector('.rpnote'); if (el && box.isConnected) el.innerHTML = note(); };
  const draw = () => {
    const played = new Set(flat.slice(0, step).map(x => x.card));
    const cur = step ? flat[step - 1] : null;
    const trickNo = cur ? cur.trick : 0;
    const inTrick = cur ? flat.slice(0, step).filter(x => x.trick === trickNo) : [];
    const shown = inTrick; // a finished trick stays visible until the next lead
    const winner = shown.length === 4 ? trickWinner({ cards: shown }, h.contract.strain) : null;
    const hand = s => `<div><div class="lbl">${SEAT_NAME[s]}</div>${rowsHTML(h.hands[s].filter(c => !played.has(c)))}</div>`;
    const centre = `<div class="tr">${shown.map(x => `<div style="text-align:center">${cardHTML(x.card, x.seat === winner ? 'win' : '', 'tabindex="-1"')}<div class="lbl">${x.seat}</div></div>`).join('') || '<span class="lbl">Opening lead next</span>'}</div>`;
    box.innerHTML = `<div class="replay"><div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}${centre}${hand('E')}<div></div>${hand('S')}<div></div></div>
      <p class="note rpnote" style="text-align:center" aria-live="polite">${note()}</p>
      <div class="row ctl"><button class="btn small" data-rp="start" aria-label="Back to the start">Start</button><button class="btn small" data-rp="trickback">Previous trick</button><button class="btn small" data-rp="back" aria-label="Previous card">Back</button><button class="btn small primary" data-rp="fwd" aria-label="Next card">Next</button><button class="btn small" data-rp="trickfwd">Next trick</button><button class="btn small" data-rp="end">End</button></div></div>`;
    box.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.rp;
      if (a === 'start') step = 0; else if (a === 'end') step = flat.length;
      else if (a === 'fwd') step = Math.min(flat.length, step + 1); else if (a === 'back') step = Math.max(0, step - 1);
      else if (a === 'trickfwd') step = Math.min(flat.length, (Math.floor(step / 4) + 1) * 4);
      else if (a === 'trickback') step = Math.max(0, (Math.ceil(step / 4) - 1) * 4);
      draw(); const nb = box.querySelector(`[data-rp="${a}"]`); if (nb) nb.focus();
    }));
  };
  step = 0; draw();
  box.scrollIntoView({ block: 'nearest' });
}
// where the game stands: a queued move is only sent if nobody has bid or played since
function playMark(t) { return [t.board, t.phase, t.auction.length, t.play.tricks.reduce((n, tr) => n + tr.cards.length, 0), !!t.claim].join(':'); }

function showWatchers() { $('watchers').textContent = watchers ? `${watchers} watching` : ''; }

// ---------- hints (practice only, an option) ----------
// What the robot would do in your seat: its call with the system's meaning of it, or its card (the solver's
// choice, as the robots pick theirs, else the heuristic's). The suggestion gets a thin gold outline until you act.
let hint = null; // { key, call } or { key, card }
const hintKey = t => [t.id, t.board, t.phase, t.auction.length, t.play.tricks.reduce((n, tr) => n + tr.cards.length, 0)].join(':');
const hintOK = t => !!(Prefs.hint && t && t.local && isMyTurn(t) && !t.timeUp && (t.phase === 'auction' || t.phase === 'play'));
const isHint = c => !!(hint && hint.card === c && T && hint.key === hintKey(T));
async function showHint() {
  if (!hintOK(T)) return;
  const key = hintKey(T), btn = $('hintBtn'), say = text => { const d = showExplain(btn, text); d.dataset.hint = '1'; };
  if (T.phase === 'auction') {
    const mine = mySeat(T), r = botCall(T.hands[mine], mine, T.dealer, T.auction, T.vul);
    let why = null;
    try { why = describeCall(T.auction.concat([{ call: r.call, by: mine }]), T.auction.length, T.vul); } catch (e) { }
    hint = { key, call: r.call }; renderBidBox();
    say(`${r.call === 'P' ? 'Pass' : r.call === 'X' ? 'Double' : r.call === 'XX' ? 'Redouble' : 'Bid ' + callText(r.call)}${why ? '. ' + why : ''}`);
    return;
  }
  const ts = turnSeat(T);
  if (hint && hint.key === key && hint.card) { say(`Play ${SYM[suitOf(hint.card)]}${rankLabel(hint.card[1])}`); return; }
  say('Thinking…');
  let card = null;
  try { card = typeof robotDDCard === 'function' ? await robotDDCard(T, ts) : null; } catch (e) { card = null; }
  if (!T || hintKey(T) !== key) return; // you played meanwhile
  if (!card || !myLegal(T, ts).includes(card)) { try { card = botPlay(T, ts); } catch (e) { card = null; } }
  if (!card) { hideExplain(); return; }
  hint = { key, card }; renderHand(); renderFelt();
  say(`Play ${SYM[suitOf(card)]}${rankLabel(card[1])}${ts !== mySeat(T) ? ' from dummy' : ''}`);
}
$('hintBtn').addEventListener('click', showHint);

// ---------- practice: kept on this device, so leaving or reloading the page doesn't lose it ----------
let practiceSaved = -1, practiceSaveTimer = null;
function savePractice() {
  if (!T || !T.local || T.version === practiceSaved) return;
  clearTimeout(practiceSaveTimer);
  practiceSaveTimer = setTimeout(() => {
    if (!T || !T.local) return;
    practiceSaved = T.version;
    Local.set('bt:practice', { ...T, history: T.history.slice(-60), chat: T.chat.slice(-60), claim: null, savedAt: Date.now() });
  }, 400);
}
function flushPractice() { if (T && T.local) { practiceSaved = -1; clearTimeout(practiceSaveTimer); Local.set('bt:practice', { ...T, history: T.history.slice(-60), chat: T.chat.slice(-60), claim: null, savedAt: Date.now() }); } }
function savedPractice() {
  const t = Local.get('bt:practice');
  return t && t.local && t.seats && t.hands && Array.isArray(t.history) && Array.isArray(t.chat) && t.play ? t : null;
}
function renderPracticeBtn() {
  const t = savedPractice();
  $('practiceBtn').textContent = t ? 'Continue practice' : 'Practice with robots';
  $('practiceNew').classList.toggle('hidden', !t);
  $('practiceNote').textContent = t ? `Board ${t.board}${t.history.length ? `, ${t.history.length} played` : ''}. You sit South with three robots. Nothing is shared.` : 'You sit South with three robots. Nothing is shared.';
}
// practice: the next board starts by itself a few seconds after the last one ends (an option)
let autoNextAt = null;
function autoNext(t) {
  if (!Prefs.autoNext || !t.local || t.phase !== 'done') return;
  const key = t.id + ':' + t.board;
  if (autoNextAt === key) return;
  autoNextAt = key;
  setTimeout(() => {
    if (!T || !Prefs.autoNext || T.phase !== 'done' || T.id + ':' + T.board !== key || $('modalRoot').firstChild || !$('tableView').querySelector('[data-next]')) return;
    doAct('next');
  }, Math.round(5000 * speedMult()));
}

// ---------- display options ----------
function showOptions() {
  const opt = (k, label, note) => `<label class="row" style="gap:8px;margin-bottom:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-pref="${k}" ${Prefs[k] ? 'checked' : ''} style="margin-top:4px"> <span>${label}${note ? `<br><span class="note">${note}</span>` : ''}</span></label>`;
  const m = modal(`<h3>Options</h3>
    ${opt('contrast', 'High contrast', 'Black outlines and stronger colours.')}
    ${opt('deck4', 'Four-colour deck', 'Clubs green and diamonds orange, so every suit has its own colour.')}
    ${opt('confirm', 'Confirm before playing a card', 'The first tap raises a card, the second tap plays it.')}
    ${opt('confirmBid', 'Confirm before bidding', 'Pick a call, then press the Bid button (or Enter) to make it.')}
    ${opt('hint', 'Hints in practice', 'A Hint button shows what the robot would bid or play in your seat.')}
    ${opt('autoNext', 'Next board automatically in practice', 'The next board starts a few seconds after a board ends, unless a window such as the hand record is open.')}
    <label class="row" style="gap:8px;margin:4px 0 8px">Robot speed in practice <select id="optSpeed">${['slow', 'normal', 'fast'].map(v => `<option value="${v}" ${Prefs.speed === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    <div class="kbdhelp"><h3 style="font-size:16px;margin-top:14px">Keyboard shortcuts</h3>
    <table class="reslist"><tr><td>Bidding</td><td><b>1</b>–<b>7</b> then <b>C D H S N</b> to bid, <b>P</b> pass, <b>X</b> double or redouble, <b>Enter</b> to confirm</td></tr>
    <tr><td>Playing</td><td><b>←</b> <b>→</b> choose a card, <b>Enter</b> to play it</td></tr>
    <tr><td>Anytime</td><td><b>L</b> last trick, <b>H</b> hint (when hints are on), <b>N</b> next board, <b>?</b> this window, <b>Esc</b> close a window</td></tr>
    <tr><td>Replay</td><td><b>←</b> <b>→</b> step through the play</td></tr></table></div>`);
  m.querySelectorAll('[data-pref]').forEach(cb => cb.addEventListener('change', () => {
    Prefs[cb.dataset.pref] = cb.checked; savePrefs(); applyPrefs(); if (cb.dataset.pref === 'confirm') selCard = null; if (cb.dataset.pref === 'confirmBid') pendingCall = null; if (T) render();
  }));
  $('optSpeed').addEventListener('change', e => { Prefs.speed = e.target.value; savePrefs(); });
}
document.addEventListener('click', e => { if (e.target.closest('[data-options]')) showOptions(); });

// ---------- keyboard ----------
// results rows and explained calls act like buttons for the keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('explainPop')) { hideExplain(); e.stopImmediatePropagation(); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest && e.target.closest('tr[data-record], .agrid [data-alert]');
  if (!el || el !== e.target) return;
  if (e.key === 'Enter' && pendingCall && bidActive() && !$('modalRoot').firstChild) return; // Enter confirms the call you picked
  e.preventDefault(); e.stopImmediatePropagation();
  if (el.dataset.alert) { if ($('explainPop')) hideExplain(); else showExplain(el, el.dataset.alert); }
  else showRecord(+el.dataset.record);
}, true);
const sortForHand = cards => cards.slice().sort((a, b) => UI_SUITS.indexOf(suitOf(a)) - UI_SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a));
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ($('modalRoot').firstChild) {
    const rb = k === 'ArrowRight' ? 'fwd' : k === 'ArrowLeft' ? 'back' : null;
    const btn = rb && document.querySelector(`#replayBox [data-rp="${rb}"]`);
    if (btn) { btn.click(); e.preventDefault(); }
    return;
  }
  if (!T) return;
  const onButton = tag === 'button' && (k === 'Enter' || k === ' ') && (e.target.matches('[data-play]') || (!pendingCall && !selCard));
  if (T.phase === 'auction' && bidActive()) {
    const legal = legalCalls(T.dealer, T.auction);
    if (k === 'Enter' && pendingCall && !onButton) { sendCall(pendingCall, true); e.preventDefault(); return; }
    if (k === 'Escape' && pendingCall) { pendingCall = null; renderBidBox(); e.preventDefault(); return; }
    if (/^[1-7]$/.test(k)) { if (STRAINS.some(s => legal.includes(k + s))) { selLevel = +k; pendingCall = null; renderBidBox(); } e.preventDefault(); return; }
    const st = { c: 'C', d: 'D', h: 'H', s: 'S', n: 'N' }[k];
    if (st && selLevel && legal.includes(selLevel + st)) { sendCall(selLevel + st); e.preventDefault(); return; }
    if (k === 'p') { sendCall('P'); e.preventDefault(); return; }
    if (k === 'x') { const c = legal.includes('X') ? 'X' : legal.includes('XX') ? 'XX' : null; if (c) sendCall(c); e.preventDefault(); return; }
  }
  if (T.phase === 'play' && !onButton) {
    const ts = turnSeat(T), legal = ts ? myLegal(T, ts) : [];
    if (legal.length && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      const order = sortForHand(legal);
      let i = order.indexOf(selCard);
      i = i < 0 ? (k === 'ArrowRight' ? 0 : order.length - 1) : (i + (k === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
      selCard = order[i]; renderHand(); renderFelt(); e.preventDefault(); return;
    }
    if (legal.length && (k === 'Enter' || k === ' ') && legal.includes(selCard)) { const c = selCard; selCard = null; doAct('card', ts, c); e.preventDefault(); return; }
  }
  if (k === 'Escape' && selCard) { selCard = null; renderHand(); renderFelt(); }
  if (k === 'l' && !$('lastTrickBtn').disabled) showLastTrick();
  else if (k === 'h' && hintOK(T)) { showHint(); e.preventDefault(); }
  else if (k === 'n' && T.phase === 'done' && $('felt').querySelector('[data-next]')) { doAct('next'); e.preventDefault(); }
  else if (k === '?') { showOptions(); e.preventDefault(); }
});

// ---------- host settings ----------
function showSettings() {
  const t = T;
  const people = SEATS.filter(s => t.seats[s] && !(t.seats[s].kind === 'human' && t.seats[s].id === me.id));
  const m = modal(`<h3>Table settings</h3>
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setLock" ${t.locked ? 'checked' : ''}> Lock seats, so only you can seat people</label>
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setUndo" ${t.allowUndo !== false ? 'checked' : ''}> Allow undo</label>
    ${t.local ? '' : `<label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setUndoAsk" ${t.undoAsk ? 'checked' : ''}> Opponents must agree to an undo</label>`}
    ${t.local || !t.private ? '' : `<label class="row" style="gap:8px;margin-bottom:4px"><input type="checkbox" id="setFriends" ${friendsMode(t) ? 'checked' : ''}> Friends mode: stronger robot card play</label>
    <p class="note" style="margin:0 0 12px">The robots work out their cards in a player's browser, so their hands reach that browser. Turn it off when playing with strangers.</p>`}
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setKib" ${t.kibSee !== false ? 'checked' : ''} ${t.match ? 'disabled' : ''}> Spectators see all four hands${t.match ? ' (never in a team match)' : ' (they then can\'t sit down mid-board)'}</label>
    <label class="row" style="gap:8px;margin-bottom:4px">Time per board <select id="setTime">${[0, 5, 7, 10, 15].map(m => `<option value="${m}" ${(t.boardLimit || 0) === m ? 'selected' : ''}>${m ? m + ' minutes' : 'No limit'}</option>`).join('')}</select></label>
    <p class="note" style="margin:0 0 12px">When the time runs out, the robots finish the board.</p>
    <h3 style="font-size:16px">Seats</h3>
    ${people.length ? people.map(s => `<div class="row" style="justify-content:space-between;margin-bottom:6px"><span>${SEAT_NAME[s]}: ${esc(seatLabel(t, s))}</span><span class="row" style="gap:6px">${!t.local && t.seats[s].kind === 'human' ? `<button class="btn small" data-mkhost="${s}">Make host</button>` : ''}<button class="btn small" data-kick="${s}">Remove</button></span></div>`).join('') : '<p class="note">Nobody else is seated.</p>'}
    ${movesOK(t) ? '<div class="row" style="margin-top:10px"><button class="btn" data-seats="1">Move players</button></div>' : ''}
    ${t.phase === 'auction' ? '<div class="row" style="margin-top:10px"><button class="btn" id="setRedeal">Redeal this board</button></div>' : ''}
    ${t.local ? '' : '<div class="row" style="margin-top:10px"><button class="btn" id="setClose">Close the table</button></div>'}`);
  const bind = (id, key) => $(id).addEventListener('change', e => doAct('settings', { [key]: e.target.checked }));
  bind('setLock', 'locked'); bind('setUndo', 'allowUndo'); bind('setKib', 'kibSee'); if ($('setUndoAsk')) bind('setUndoAsk', 'undoAsk'); if ($('setFriends')) bind('setFriends', 'friends');
  $('setTime').addEventListener('change', e => doAct('settings', { boardLimit: +e.target.value }));
  m.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => { doAct('kick', b.dataset.kick); b.closest('.row').remove(); }));
  if ($('setRedeal')) $('setRedeal').addEventListener('click', () => { closeModal(); doAct('redeal'); });
  m.querySelectorAll('[data-mkhost]').forEach(b => b.addEventListener('click', () => { closeModal(); doAct('makeHost', b.dataset.mkhost); }));
  if ($('setClose')) $('setClose').addEventListener('click', () => {
    const c = modal('<h3>Close the table?</h3><p>Everyone here is sent back to the lobby and the table is deleted.</p><div class="row"><button class="btn primary" id="closeYes">Close the table</button><button class="btn" data-close="1">Keep it</button></div>', true);
    c.querySelector('#closeYes').addEventListener('click', () => { closeModal(); doAct('close'); });
  });
}

// Host, between boards: swap two seats, or move everyone one seat clockwise.
function seatsListHTML(t) { return SEATS.map(s => `<div><b>${SEAT_NAME[s]}</b> ${esc(t.seats[s] ? (mySeat(t) === s ? 'You' : seatLabel(t, s)) : 'Empty')}</div>`).join(''); }
function showSeats() {
  const t = T; if (!t || !movesOK(t)) return;
  const opt = sel => SEATS.map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${SEAT_NAME[s]}</option>`).join('');
  const m = modal(`<h3>Seats</h3><div class="seatlist" id="seatList">${seatsListHTML(t)}</div>
    <div class="row" style="margin-top:10px"><label class="row" style="gap:6px">Swap <select id="swapA" aria-label="First seat">${opt('N')}</select></label><label class="row" style="gap:6px">and <select id="swapB" aria-label="Second seat">${opt('E')}</select></label><button class="btn" id="swapGo">Swap</button></div>
    <div class="row" style="margin-top:10px"><button class="btn" id="rotateGo">Rotate seats</button><span class="note">Everyone moves one seat clockwise.</span></div>`);
  $('swapGo').addEventListener('click', () => { const a = $('swapA').value, b = $('swapB').value; if (a === b) { toast('Choose two different seats'); return; } doAct('swap', a, b); });
  $('rotateGo').addEventListener('click', () => doAct('swap', 'rotate'));
  return m;
}
// keep the open Seats window up to date; close it once a board starts
function refreshSeats() {
  const el = $('seatList'); if (!el) return;
  if (!movesOK(T)) closeModal(); else el.innerHTML = seatsListHTML(T);
}

// ---------- clocks ----------
const mmss = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function tick() {
  const now = serverNow();
  // a player's thinking time shows only once they have been thinking a while, so the plates don't tick all the time
  document.querySelectorAll('.clk[data-since]').forEach(el => { const ms = now - +el.dataset.since; el.textContent = ms >= 20000 ? mmss(ms) : ''; });
  document.querySelectorAll('.bclk[data-start]').forEach(el => {
    const lim = +el.dataset.limit * 60000, used = now - +el.dataset.start;
    el.textContent = lim ? `Time ${mmss(used)} of ${mmss(lim)}` : `Time ${mmss(used)}`;
    el.classList.toggle('over', !!lim && used > lim);
  });
}
setInterval(tick, 1000);

// ---------- team match: the other room ----------
let otherRoom = null, otherRoomAt = 0;
function refreshOtherRoom() { }

// ---------- event wiring ----------
document.addEventListener('click', e => {
  const b = e.target.closest('button, [data-alert], tr[data-record], [data-cleartrick], [data-lasttrick]'); if (!b || !T && !b.closest('#home')) return;
  const d = b.dataset;
  if (d.sit) doAct('sit', d.sit);
  else if (d.robot) doAct('robot', d.robot);
  else if (d.play) {
    const seat = d.seat, card = d.play;
    if (Prefs.confirm && selCard !== card) { selCard = card; renderHand(); renderFelt(); }
    else { selCard = null; doAct('card', seat, card); }
  }
  else if (d.cleartrick) { trickHold.until = 0; renderFelt(); }
  else if (d.lasttrick) { if (!e.target.closest('.bwrap, .announce')) showLastTrick(); }
  else if (d.level) { selLevel = +d.level; pendingCall = null; renderBidBox(); }
  else if (d.confirmcall) { if (pendingCall) sendCall(pendingCall, true); }
  else if (d.cancelcall) { pendingCall = null; renderBidBox(); }
  else if (d.strain) sendCall(selLevel + d.strain);
  else if (d.call) sendCall(d.call);
  else if (d.claim === 'yes') doAct('respond', true);
  else if (d.claim === 'no') doAct('respond', false);
  else if (d.claim === 'cancel') doAct('cancelClaim');
  else if (d.next) doAct('next');
  else if (d.review !== undefined) { const h = T.history[+d.review]; showRecord(+d.review); if (h && h.tricks && h.tricks.length) startReplay(h); }
  else if (d.record !== undefined) showRecord(+d.record);
  else if (d.alert) showExplain(b, d.alert);
  else if (d.sub) doAct('sub', d.sub);
  else if (d.seats) showSeats();
  else if (d.quick) doAct('chat', d.quick);
  else if (d.undoreply) doAct('undoReply', d.undoreply === 'yes');
  else if (d.undocancel) doAct('undoCancel');
});
let pendingCall = null; // call picked but not yet confirmed (confirm-bid option)
function sendCall(call, confirmed) {
  if (Prefs.confirmBid && !confirmed) { pendingCall = call; renderBidBox(); return; }
  pendingCall = null;
  const alert = $('alertChk').checked ? ($('alertText').value.trim() || 'Alerted, no explanation given') : null;
  selLevel = null; $('alertChk').checked = false; $('alertText').value = ''; $('alertText').classList.add('hidden');
  doAct('call', call, alert);
}
$('alertChk').addEventListener('change', () => { $('alertText').classList.toggle('hidden', !$('alertChk').checked); if ($('alertChk').checked) $('alertText').focus(); });
$('lastTrickBtn').addEventListener('click', showLastTrick);
$('undoBtn').addEventListener('click', () => doAct('undo'));
$('claimBtn').addEventListener('click', showClaimDialog);
$('leaveBtn').addEventListener('click', leaveTable);
$('settingsBtn').addEventListener('click', showSettings);
$('roomBtn').addEventListener('click', () => {
  if (!T || !T.match) return;
  const code = T.match.otherCode;
  if (mySeat(T)) doAct('standUp');
  setTimeout(() => openOnline(code), 150);
});
$('soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('soundBtn').textContent = soundOn ? 'Sound on' : 'Sound off'; $('soundBtn').setAttribute('aria-pressed', soundOn); if (soundOn) beep(); });
$('chatSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function sendChat() { const v = $('chatInput').value.trim(); if (!v) return; $('chatInput').value = ''; doAct('chat', v); }
function selectTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === name));
  ['auction', 'chat', 'results'].forEach(n => $('pane-' + n).classList.toggle('hidden', n !== name));
  recheckUnread();
}
const currentTab = () => (document.querySelector('.tabs button[aria-selected=true]') || {}).dataset?.tab;
let tabAuto = true, tabPhaseKey = null;
function autoTab(t) {
  const key = t.id + ':' + t.board + ':' + t.phase;
  if (key === tabPhaseKey) return;
  if (!tabPhaseKey || !tabPhaseKey.startsWith(t.id + ':' + t.board + ':')) tabAuto = true; // new board
  tabPhaseKey = key;
  if (!tabAuto) return;
  const want = t.phase === 'auction' ? 'chat' : t.phase === 'play' ? 'auction' : null;
  if (want && currentTab() !== 'results') selectTab(want);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tabAuto = false; selectTab(b.dataset.tab); }));
let resizeFrame = 0;
window.addEventListener('resize', () => { if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; if (T) { renderFelt(); renderHand(); } }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modalRoot').firstChild) closeModal(); });

// ---------- lobby ----------
async function loadMe() {
  const saved = Local.get('bt:me');
  if (saved && saved.secret) me = saved;
  else { me.secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join(''); }
  me.id = await idFromSecret(me.secret);
  saveMe();
  $('nameInput').value = me.name || '';
  $('storageNote').textContent = '';
}
function saveMe() { Local.set('bt:me', { name: me.name, secret: me.secret }); }
$('saveName').addEventListener('click', () => {
  me.name = $('nameInput').value.trim().slice(0, 20); saveMe(); toast(me.name ? 'Name saved' : 'Name cleared');
  if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify({ type: 'hello', secret: me.secret, name: me.name }));
});
function needName() {
  if (!me.name) { const v = $('nameInput').value.trim(); if (v) { me.name = v.slice(0, 20); saveMe(); } }
  if (!me.name) { toast('Enter your name first'); $('nameInput').focus(); return false; }
  return true;
}
function startPractice(fresh) {
  // a name typed in the box counts (the chat uses it too), even if Save name wasn't pressed
  const typed = $('nameInput').value.trim().slice(0, 20);
  if (typed && typed !== me.name) { me.name = typed; saveMe(); }
  const nm = me.name || 'You';
  const saved = !fresh && savedPractice();
  if (saved) { // carry on where you left off (this device may have taken another identity meanwhile)
    saved.seats.S = { kind: 'human', id: me.id, name: nm };
    for (const m of saved.chat) if (!m.sys && m.seat === 'S') m.from = me.id;
    try { openTable(saved); return; } catch (e) { console.error(e); }
  }
  const t = newTable({ name: 'Practice', local: true });
  t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: nm }, W: { kind: 'robot' } };
  startBoard(t);
  openTable(t);
}
$('practiceBtn').addEventListener('click', () => startPractice(false));
$('practiceNew').addEventListener('click', () => startPractice(true));
async function api(path, body) {
  const r = await fetch(API_BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
$('createBtn').addEventListener('click', async () => {
  if (!needName()) return;
  const btn = $('createBtn'); btn.disabled = true;
  try {
    const r = await api('/api/tables', { secret: me.secret, name: me.name, tableName: $('tableName').value.trim(), priv: $('privateChk').checked, match: $('matchChk').checked });
    openOnline(r.code);
  } catch (e) { toast('Could not open the table. Check your connection and try again.'); }
  finally { btn.disabled = false; }
});
$('joinCodeBtn').addEventListener('click', () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(code)) { toast('Table codes have 5 letters'); return; }
  if (!needName()) return;
  openOnline(code);
});
$('refreshBtn').addEventListener('click', loadLobby);
async function loadLobby() {
  renderRecent();
  const el = $('tableList');
  let tables;
  try { tables = (await api('/api/tables')).tables; }
  catch (e) { el.innerHTML = navigator.onLine === false ? '<div class="empty">You\'re offline. Practice with robots still works; the table list comes back when you reconnect.</div>' : '<div class="empty">Couldn\'t load the table list. Check your connection, then tap Refresh.</div>'; return; }
  if (!tables.length) { el.innerHTML = '<div class="empty">No open tables right now. Open one and invite your friends.</div>'; return; }
  // tables with a free seat (empty or robot) first, then the busiest
  const free = t => SEATS.filter(s => !t.seats[s] || t.seats[s].kind === 'robot').length;
  tables.sort((x, y) => (free(y) > 0) - (free(x) > 0) || ((y.people || 0) > 0) - ((x.people || 0) > 0) || y.updatedAt - x.updatedAt);
  el.innerHTML = tables.map(t => {
    const humans = SEATS.filter(s => t.seats[s] && t.seats[s].kind === 'human').length;
    const open = free(t);
    const st0 = (t.match ? 'Team match, ' : '') + (t.phase === 'waiting' ? 'waiting for players' : `board ${t.board}`);
    const status = st0[0].toUpperCase() + st0.slice(1);
    return `<div class="trow"><div><div class="tname">${esc(t.name)}</div><div class="tmeta">${status}, ${humans} ${humans === 1 ? 'person' : 'people'} seated${open ? `, ${open} seat${open === 1 ? '' : 's'} free` : ''}${t.people ? `, ${t.people} here` : ''}${t.boardLimit ? `, ${t.boardLimit} min a board` : ''}${t.locked ? ', seats locked' : ''}</div>
      <div class="seatmini">${SEATS.map(s => { const o = t.seats[s]; return `<span class="${o ? '' : 'open'}">${s} ${o ? (o.kind === 'robot' ? 'Robot' : esc(o.name)) : 'open'}</span>`; }).join('')}</div></div>
      <button class="btn ${open ? 'primary' : ''}" data-open="${esc(t.code)}">${open ? 'Go to table' : 'Watch'}</button></div>`;
  }).join('');
  el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { if (needName()) openOnline(b.dataset.open); }));
}

// ---------- navigation ----------
// a window (hand record, options...) or call explanation left open must not stay over the next screen
function leaveModals() { modalReturn = null; closeModal(); hideExplain(); claimWatch = null; setJoinState(null); }
function showTableView() {
  $('home').classList.add('hidden'); $('tableView').classList.remove('hidden');
  clearInterval(lobbyTimer);
}
function openTable(t) { // practice
  leaveModals(); Net.close();
  T = t; tKey = null; lastRenderedVersion = -1; otherRoom = null; watchers = 0; wasMyTurn = false; clockSkew = 0;
  showTableView(); render();
  history.replaceState(null, '', location.pathname);
}
function openOnline(code) {
  clearTimeout(robotTimer); robotTimer = null; leaveModals();
  if (T && !T.local) { // leaving another online table, e.g. switching team-match rooms
    T = null; selCard = null; pendingCall = null; selLevel = null;
    $('felt').innerHTML = '<div class="pos-center"><div class="waitmsg">Connecting…</div></div>';
    $('myHand').innerHTML = ''; $('bidArea').classList.add('hidden'); closeModal();
  }
  wasMyTurn = false; $('alertChk').checked = false; $('alertText').classList.add('hidden');
  setTimeout(() => { if (Net.code === code && !Net.gotState) toast('Still trying to reach the table. Check your connection.', 4000); }, 5000);
  // from the lobby: say that something is happening (the table opens once it answers), with a way to give up
  if (!$('home').classList.contains('hidden')) setJoinState(code);
  Net.open(code, () => {
    setJoinState(null); lastRenderedVersion = -1; showTableView();
    history.replaceState(null, '', '#' + code);
  });
}
function setJoinState(code) {
  const el = $('joinState');
  el.classList.toggle('hidden', !code);
  el.innerHTML = code ? `Connecting to table ${esc(code)}… <button class="btn small" id="joinCancel">Cancel</button>` : '';
  if (code) $('joinCancel').addEventListener('click', () => { Net.close(); setJoinState(null); });
}
function goHome() {
  releaseWakeLock(); leaveModals();
  Net.close(); clearTimeout(robotTimer); robotTimer = null;
  T = null; tKey = null; DD.queue.length = 0; // stop analysing the table you left
  for (const [k, en] of DD.cache) if (!en.done) DD.cache.delete(k); // ...and let it start again if you come back
  wasMyTurn = false; clockSkew = 0;
  $('tableView').classList.add('hidden'); $('home').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
  renderPracticeBtn();
  loadLobby(); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000);
}
function leaveTable() {
  // leaving an online board you're playing in empties your seat and stops the game: ask first
  if (T && !T.local && mySeat(T) && (T.phase === 'auction' || T.phase === 'play') && !T.masked && !$('modalRoot').firstChild) {
    const m = modal(`<h3>Leave during the board?</h3><p>Your seat will be empty, and the game stops until someone sits there or adds a robot.</p><div class="row"><button class="btn primary" id="leaveYes">Leave</button><button class="btn" data-close="1">Stay</button></div>`, true);
    m.querySelector('#leaveYes').addEventListener('click', () => { closeModal(); leaveNow(); });
    return;
  }
  leaveNow();
}
function leaveNow() {
  flushPractice();
  if (T && !T.local && mySeat(T)) {
    if (Net.ws && Net.ws.readyState === 1) doAct('standUp');
    else toast('You are offline, so your seat stays reserved until you reconnect or the table notices you are away.');
  }
  setTimeout(goHome, T && !T.local ? 150 : 0);
}

window.addEventListener('hashchange', async () => {
  await adoptIdentityFromLink();
  const code = location.hash.slice(1).toUpperCase();
  if (/^[A-Z]{5}$/.test(code) && me.name && Net.code !== code) openOnline(code);
});
(async function init() {
  await loadMe();
  renderPracticeBtn();
  await adoptIdentityFromLink();
  const code = location.hash.slice(1).toUpperCase();
  if (/^[A-Z]{5}$/.test(code) && me.name) openOnline(code);
  else if (/^[A-Z]{5}$/.test(code)) $('codeInput').value = code;
  loadLobby();
  lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000);
})();
