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
  return Object.assign({ contrast: false, deck4: false, confirm: false, confirmBid: false, speed: 'normal' }, p);
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
  claim: (s, n) => A.claim(s, mySeat(s), n),
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
  if (robotTimer || !T) return;
  const ts = turnSeat(T); if (!ts || T.claim) return;
  const o = occupant(T, controllerOf(T, ts));
  if (!o || o.kind !== 'robot' || !amDriver(T)) return;
  const tr = T.play && T.play.tricks[T.play.tricks.length - 1];
  const m = speedMult(), pause = T.phase === 'auction' ? 650 * m : (tr && tr.cards.length === 4 ? trickHoldMs() + 500 * m : 700 * m);
  robotTimer = setTimeout(async () => { robotTimer = null; await act(s => A.robotStep(s)); }, pause);
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
  if (!mine || t.phase !== 'play' || t.claim) return [];
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
      ? `<button class="rk play ${c === selCard ? 'sel' : ''}" data-play="${c}" data-seat="${seat}">${rankLabel(c[1])}</button>`
      : `<button class="rk" disabled>${rankLabel(c[1])}</button>`).join('') : '<span class="void">–</span>';
    return `<div class="r"><span class="s ${isRed(s) ? 'red' : ''} s-${s}">${SYM[s]}</span>${ranks}</div>`;
  }).join('')}</div>`;
}
// a hand shown face up on the table: one column of overlapping cards per suit
function colsHTML(cards, legal = [], seat = '', small = false) {
  const any = legal.length > 0;
  return `<div class="dhand ${small ? 'sm' : ''}">${UI_SUITS.map(s => {
    const cs = cards.filter(c => suitOf(c) === s).sort((a, b) => rankOf(b) - rankOf(a));
    if (!cs.length) return '';
    return `<div class="dcol">${cs.map(c => {
      const ok = legal.includes(c);
      const cls = (any ? (ok ? 'legal' : 'dim') : '') + (ok && c === selCard ? ' sel' : '');
      return cardHTML(c, cls, ok ? `data-play="${c}" data-seat="${seat}"` : 'tabindex="-1"');
    }).join('')}</div>`;
  }).join('')}</div>`;
}
function plateHTML(t, seat) {
  const o = occupant(t, seat);
  const vul = t.board && isVul(t.vul, seat);
  const turn = turnSeat(t) === seat && !t.claim;
  const mine = mySeat(t), you = mine === seat;
  const tag = seat === dummySeat(t) && t.phase === 'play' ? ' <span class="bot">dummy</span>' : '';
  let yt = '';
  if (turn && mine && controllerOf(t, seat) === mine && (t.phase === 'auction' || t.phase === 'play')) {
    const tr = t.phase === 'play' && t.play.tricks[t.play.tricks.length - 1];
    const lead = t.phase === 'play' && (!tr || tr.cards.length === 0 || tr.cards.length === 4);
    yt = t.phase === 'auction' ? 'Your bid' : seat !== mine ? (lead ? 'Lead from dummy' : 'Play from dummy') : lead ? 'Your lead' : 'Your play';
  }
  return `<span class="plate ${vul ? 'vul' : ''} ${turn ? 'turn' : ''} ${yt ? 'act' : ''}"><span class="sl" title="${SEAT_NAME[seat]}${vul ? ', vulnerable' : ''}">${seat}</span><span class="nm">${esc(you ? 'You' : seatLabel(t, seat))}</span>${tag}${yt ? `<span class="yt">${yt}</span>` : ''}${awayTag(t, seat)}${turn && t.phase !== 'done' && (!t.local || t.boardLimit) ? ` <span class="clk" data-since="${t.lastActAt || serverNow()}"></span>` : ''}</span>`;
}
function seatBlock(t, seat, where) {
  const o = occupant(t, seat);
  const mine = mySeat(t);
  let inner = plateHTML(t, seat);
  if (!o) {
    inner += `<div class="sitbtns"><button class="btn small" data-sit="${seat}">Sit here</button>${mine || t.local || isHost(t) ? `<button class="btn small" data-robot="${seat}">Add robot</button>` : ''}</div>`;
  } else if (o.kind === 'robot' && !t.local && (!mine)) {
    inner += `<div class="sitbtns"><button class="btn small" data-sit="${seat}">Take seat</button></div>`;
  }
  if (where !== 'bottom' && t.hands && t.phase !== 'waiting') {
    if (canSee(t, seat)) {
      const side = where !== 'top';
      const fw = $('felt').clientWidth || 800;
      const cwid = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 64;
      if (side && (fw - 36) * 1.5 / 4 < 4 * cwid + 12) inner += rowsHTML(currentCards(t, seat), myLegal(t, seat), seat);
      else inner += colsHTML(currentCards(t, seat), myLegal(t, seat), seat, side);
    }
    else { const n = currentCards(t, seat).length; inner += `<span class="backs" role="img" aria-label="${n} cards" title="${n} cards">${'<i></i>'.repeat(n)}</span>`; }
  }
  return `<div class="seat">${inner}</div>`;
}
function auctionGridHTML(t, auction = t.auction, dealer = t.dealer, vul = t.vul, viewer = mySeat(t)) {
  const order = ['W', 'N', 'E', 'S'];
  const cells = order.map(s => `<div class="h ${isVul(vul, s) ? 'vul' : ''}">${SEAT_NAME[s]}</div>`);
  const off = order.indexOf(dealer);
  for (let i = 0; i < off; i++) cells.push('<div></div>');
  auction.forEach((a, i) => {
    const hideAlert = viewer && partnerOf(a.by) === viewer;
    const isBid = bidValue(a.call) >= 0;
    const red = isBid && isRed(a.call[1]);
    const al = a.alert && !hideAlert;
    const kind = (a.call === 'X' ? 'cx' : a.call === 'XX' ? 'cxx' : a.call === 'P' ? 'cp' : red ? 'red' : 'blk') + (isBid ? ' s-' + a.call[1] : '');
    cells.push(`<div class="c ${kind} ${al ? 'alert' : ''}" ${al ? `data-alert="${esc(a.alert)}" title="${esc(a.alert)}"` : ''}>${callText(a.call)}</div>`);
  });
  if (t.phase === 'auction' && auction === t.auction) cells.push('<div class="c">?</div>');
  return `<div class="agrid">${cells.join('')}</div>`;
}
function vulText(v) { return v === 'None' ? 'Nobody vulnerable' : v === 'Both' ? 'Both vulnerable' : v === 'NS' ? 'N-S vulnerable' : 'E-W vulnerable'; }

function renderFelt() {
  const t = T, o = orient(t), mine = mySeat(t);
  let html = '';
  if (t.board) html += `<div class="corner tl"><b>Board ${t.board}</b>${t.match ? ' ' + t.match.room : ''}<br>Dealer ${SEAT_NAME[t.dealer]}<br>${vulText(t.vul)}${t.phase !== 'done' && t.boardStart && (!t.local || t.boardLimit) ? `<br><span class="bclk" data-start="${t.boardStart}" data-limit="${t.boardLimit || 0}"></span>` : ''}</div>`;
  if (t.contract && t.phase !== 'auction') {
    html += `<div class="corner tr"><b>${contractText(t.contract)}</b></div>`;
  }
  html += `<div class="pos-top">${seatBlock(t, o.top, 'top')}</div>`;
  html += `<div class="pos-left">${seatBlock(t, o.left, 'left')}</div>`;
  html += `<div class="pos-right">${seatBlock(t, o.right, 'right')}</div>`;
  html += `<div class="pos-bottom">${seatBlock(t, o.bottom, 'bottom')}</div>`;

  let center = '', bn = '';
  if (t.phase === 'waiting') {
    const open = SEATS.filter(s => !t.seats[s]).map(s => SEAT_NAME[s]);
    center = `<div class="waitmsg">${mine ? 'Waiting for ' + open.join(', ') + '.<br><span class="note" style="color:inherit;opacity:.8">Invite friends with code ' + t.id + ' or this page\'s link, or add robots.</span>' : 'Choose a seat to play, or watch from here.'}</div>`;
  } else if (t.phase === 'auction') {
    center = t.masked ? '<div class="waitmsg">A board is in progress.<br><span class="note" style="color:inherit;opacity:.85">In a team match, onlookers see each board once both rooms have played it.</span></div>' : auctionGridHTML(t);
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
    if (tr && !cleared) {
      center = `<div class="trick ${full && t.phase === 'play' ? 'full' : ''}" ${full && t.phase === 'play' ? 'data-cleartrick="1" title="Tap to clear"' : ''}>${tr.cards.map(pc => {
        const pos = Object.keys(o).find(k => o[k] === pc.seat);
        return `<div class="tslot ${pos}">${cardHTML(pc.card, pc.seat === win ? 'win' : '', 'tabindex="-1"')}</div>`;
      }).join('')}</div>`;
    } else if (t.phase === 'play') {
      if (!tricks.some(x => x.cards.length)) {
        const ld = nextSeat(t.contract.declarer);
        center = `<div class="announce"><div class="note">The contract is</div><div class="ac">${contractText(t.contract)}</div><div>${ld === mine ? '<b>You</b> lead' : SEAT_NAME[ld] + ' leads'}</div></div>`;
      } else center = `<div class="waitmsg">${SEAT_NAME[win || nextSeat(t.contract.declarer)]} to lead</div>`;
    }
    const ts = turnSeat(t);
    if (t.phase === 'play' && !t.claim && ts && !occupant(t, controllerOf(t, ts))) bn += `<div class="banner"><h3>Game paused</h3>${SEAT_NAME[controllerOf(t, ts)]} is empty. Sit there or add a robot.</div>`;
    if (t.claim) bn += claimBanner(t);
    bn += awayBanner(t) + undoBanner(t);
    if (t.phase === 'done') bn += resultBanner(t);
  }
  if (t.phase === 'auction') {
    const ts = turnSeat(t);
    if (t.masked) { /* nothing to show */ }
    else if (!occupant(t, ts)) bn += `<div class="banner"><h3>Game paused</h3>${SEAT_NAME[ts]} is empty. Sit there or add a robot.</div>`;
    else bn += awayBanner(t);
    bn += undoBanner(t);
  }
  const lastOK = t.phase === 'play' && completedTricks(t.play).length > 0;
  html += `<div class="pos-center" ${lastOK ? 'data-lasttrick="1" title="Tap to see the last trick"' : ''}>${center}${bn ? `<div class="bwrap">${bn}</div>` : ''}</div>`;
  $('felt').innerHTML = html;
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
  return `<div class="banner"><h3>${h.contract ? contractText(h.contract) : 'Passed out'}</h3>
    ${h.contract ? `<div class="big">${resultText(h.contract, h.declTricks)}</div><div>${h.declTricks} tricks for declarer</div>` : ''}
    <div style="margin-top:4px">${label}: <b>${sideScore > 0 ? '+' : ''}${sideScore}</b></div>
    <div class="row">${mine || t.local || isHost(t) ? '<button class="btn primary" data-next="1">Next board</button>' : ''}<button class="btn" data-record="${t.history.length - 1}">Hand record</button>${h.tricks && h.tricks.length ? `<button class="btn" data-review="${t.history.length - 1}">Review play</button>` : ''}</div></div>`;
}
function renderHand() {
  const t = T, el = $('myHand'), mine = mySeat(t);
  const seat = mine || orient(t).bottom; // spectators see the bottom seat here when allowed
  if (!t.hands || t.phase === 'waiting' || (!mine && !canSee(t, seat))) { el.innerHTML = ''; return; }
  const cards = currentCards(t, seat).slice().sort((a, b) => UI_SUITS.indexOf(suitOf(a)) - UI_SUITS.indexOf(suitOf(b)) || rankOf(b) - rankOf(a));
  const legal = mine ? myLegal(t, mine) : [];
  const myTurn = legal.length > 0;
  const w = el.clientWidth || 360;
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 64;
  const step = cards.length > 1 ? Math.min(cw * 0.5, (w - cw - 4) / (cards.length - 1)) : 0;
  el.innerHTML = `<div class="fan">${cards.map((c, i) => cardHTML(c, (myTurn ? (legal.includes(c) ? 'legal' : 'dim') : '') + (legal.includes(c) && c === selCard ? ' sel' : ''), `style="margin-left:${i ? step - cw : 0}px" ${legal.includes(c) ? `data-play="${c}" data-seat="${seat}"` : 'tabindex="-1"'}`)).join('')}</div>`;
}
function renderBidBox() {
  const t = T, mine = mySeat(t);
  const show = t.phase === 'auction' && mine && turnSeat(t) === mine;
  $('bidArea').classList.toggle('hidden', !show);
  if (!show) { selLevel = null; pendingCall = null; $('bbConfirm').classList.add('hidden'); return; }
  const legal = legalCalls(t.dealer, t.auction);
  const minLevel = [1, 2, 3, 4, 5, 6, 7].find(l => STRAINS.some(s => legal.includes(l + s)));
  if (selLevel && !STRAINS.some(s => legal.includes(selLevel + s))) selLevel = null;
  $('bbLevels').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(l => `<button class="bcard ${selLevel === l ? 'sel' : ''}" data-level="${l}" ${!minLevel || l < minLevel ? 'disabled' : ''}>${l}</button>`).join('');
  $('bbStrains').innerHTML = STRAINS.map(s => {
    const ok = selLevel && legal.includes(selLevel + s);
    return `<button class="bcard ${isRed(s) ? 'red' : ''} s-${s} ${ok && pendingCall === selLevel + s ? 'sel' : ''}" data-strain="${s}" ${ok ? '' : 'disabled'}>${SYM[s]}</button>`;
  }).join('');
  const ps = c => pendingCall === c ? 'sel' : '';
  $('bbSpecial').innerHTML = `<button class="bcard pass ${ps('P')}" data-call="P">Pass</button><button class="bcard dbl ${ps('X')}" data-call="X" ${legal.includes('X') ? '' : 'disabled'}>X</button><button class="bcard rdbl ${ps('XX')}" data-call="XX" ${legal.includes('XX') ? '' : 'disabled'}>XX</button>`;
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
  $('pane-auction').innerHTML = t.board ? auctionGridHTML(t) + (t.contract ? `<p style="margin:10px 0 0">${contractText(t.contract)}</p>${tricksHTML(t)}` : '') + (t.phase === 'auction' ? '<p class="note">Calls with a yellow outline are alerted. Tap one to read the explanation.</p>' : '') : '<p class="empty">The auction appears here once the board is dealt.</p>';
}
function renderChatPane(t) {
  const log = $('chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.innerHTML = t.chat.length ? t.chat.map(m => m.sys ? `<div class="msg sys">${esc(m.text)}</div>` : `<div class="msg"><span class="who">${esc(m.name)}${m.seat ? ' (' + m.seat + ')' : m.kib ? ' (spectators)' : ''}:</span> ${esc(m.text)}</div>`).join('') : '<div class="empty">No messages yet.</div>';
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function renderResultsPane(t) {
  let ns = 0, ew = 0, imps = 0, impN = 0;
  t.history.forEach(h => { if (h.scoreNS > 0) ns += h.scoreNS; else ew -= h.scoreNS; requestDD(h.hands, false); });
  const sgn = v => (v > 0 ? '+' : '') + v;
  let head, rowsR, summary = '', note = 'Tap a board to see its hand record.';
  if (t.local) {
    head = '<th>Bd</th><th>You</th><th>Res</th><th class="num">N-S</th><th>Robots</th><th class="num">IMPs</th>';
    rowsR = t.history.map((h, i) => {
      const o = h.other; const im = o ? toImps(h.scoreNS - o.scoreNS) : null;
      if (im !== null) { imps += im; impN++; }
      return `<tr class="click" data-record="${i}"><td>${h.board}</td><td>${cShort(h.contract)}</td><td>${h.contract ? resultText(h.contract, h.declTricks) : ''}</td><td class="num">${h.scoreNS}</td><td>${o ? cShort(o.contract) + (o.contract ? ' ' + resultText(o.contract, o.declTricks) : '') : ''}</td><td class="num">${im === null ? '' : sgn(im)}</td></tr>`;
    }).reverse().join('');
    if (impN) summary = `<p class="note" style="margin:-4px 0 8px">Against a table of four robots playing the same deals, N-S ${imps >= 0 ? 'won' : 'lost'} ${Math.abs(imps)} IMP${Math.abs(imps) === 1 ? '' : 's'} over ${impN} board${impN === 1 ? '' : 's'}.</p>`;
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
      return `<tr ${i >= 0 ? `class="click" data-record="${i}"` : ''}><td>${bd}</td><td>${o ? cShort(o.contract) + (o.contract ? ' ' + resultText(o.contract, o.declTricks) : '') : '…'}</td><td class="num">${o ? o.scoreNS : ''}</td><td>${c ? cShort(c.contract) + (c.contract ? ' ' + resultText(c.contract, c.declTricks) : '') : '…'}</td><td class="num">${c ? c.scoreNS : ''}</td><td class="num">${im === null ? '' : im > 0 ? im + ' T1' : im < 0 ? -im + ' T2' : '0'}</td></tr>`;
    }).join('');
    summary = `<div class="totals"><span>Team 1: ${t1} IMPs</span><span>Team 2: ${t2} IMPs</span></div><p class="note" style="margin:-4px 0 8px">Team 1 sits N-S in the Open room and E-W in the Closed room.</p>`;
    note = 'A board is scored once both rooms have finished it.';
  } else {
    head = '<th>Bd</th><th>Contract</th><th>Res</th><th class="num">N-S</th><th class="num">Par</th><th class="num">IMPs</th>';
    rowsR = t.history.map((h, i) => {
      const par = parFor(h);
      const im = par ? toImps(h.scoreNS - par.scoreNS) : null;
      if (im !== null) { imps += im; impN++; }
      return `<tr class="click" data-record="${i}"><td>${h.board}</td><td>${cShort(h.contract)}</td><td>${h.contract ? resultText(h.contract, h.declTricks) : ''}</td><td class="num">${h.scoreNS}</td><td class="num">${par ? par.scoreNS : DD.failed ? '–' : '…'}</td><td class="num">${im === null ? '' : sgn(im)}</td></tr>`;
    }).reverse().join('');
    if (impN) summary = `<p class="note" style="margin:-4px 0 8px">N-S ${sgn(imps)} IMPs against par over ${impN} board${impN === 1 ? '' : 's'}.</p>`;
    if (!DD.failed) note += ' Par fills in once the analysis finishes.';
  }
  const any = t.history.length || (t.match && otherRoom && otherRoom.history.length);
  $('pane-results').innerHTML = any ? `${t.match ? '' : `<div class="totals"><span>N-S ${ns}</span><span>E-W ${ew}</span></div>`}${summary}
    <table class="reslist"><tr>${head}</tr>${rowsR}</table><p class="note">${note}</p>
    ${t.history.length ? '<div class="row"><button class="btn small" id="pbnAll">Download all boards (PBN)</button></div>' : ''}` : '<p class="empty">Finished boards appear here.</p>';
  const pa = $('pbnAll'); if (pa) pa.addEventListener('click', () => downloadText(`bridge-${t.id}.pbn`, t.history.map(h => pbnBoard(h, t)).join('\n\n') + '\n'));
}
const cShort = c => c ? `${c.level}${SYM[c.strain]}${c.doubled ? 'X'.repeat(c.doubled) : ''} ${c.declarer}` : 'Pass';
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
}
function render() {
  if (!T) return;
  autoTab(T);
  if (selCard) { const ts = turnSeat(T); if (T.phase !== 'play' || !ts || !myLegal(T, ts).includes(selCard)) selCard = null; }
  const ae = document.activeElement; let keep = null;
  if (ae && ae !== document.body && ae.dataset) for (const a of ['play', 'level', 'strain', 'call', 'confirmcall', 'cancelcall', 'claim', 'next', 'record', 'review']) {
    if (ae.dataset[a] !== undefined) { keep = `[data-${a}="${ae.dataset[a]}"]`; break; }
  }
  renderTop(); showWatchers(); renderOnline(); renderFelt(); renderHand(); renderBidBox(); renderSide(); tick();
  if (keep && (!document.activeElement || document.activeElement === document.body)) { const el = document.querySelector(keep); if (el) el.focus({ preventScroll: true }); }
  lastRenderedVersion = T.version;
  refreshOtherRoom();
  if (T.hands && T.phase === 'done' && SEATS.every(s => T.hands[s].every(c => c[0] !== '?'))) requestDD(T.hands, true, T.contract ? T.contract.strain : null);
  const mt = isMyTurn(T); if (mt && !wasMyTurn) beep(); wasMyTurn = mt;
  updateTitle();
  scheduleRobot();
}

// ---------- modals ----------
let modalReturn = null;
function closeModal() {
  $('modalRoot').innerHTML = ''; openRecord = null;
  const r = modalReturn; modalReturn = null;
  if (r && r.isConnected) r.focus({ preventScroll: true });
}
function modal(html) {
  if (!$('modalRoot').firstChild) modalReturn = document.activeElement;
  $('modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="box">${html}<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close="1">Close</button></div></div></div>`;
  const m = $('modalRoot').firstChild;
  m.addEventListener('click', e => { if (e.target === m || e.target.dataset.close) closeModal(); });
  openRecord = null;
  const b = m.querySelector('button'); if (b) b.focus();
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
  let tt = '';
  if (h.tricks && h.tricks.length) {
    tt = `<h3 style="font-size:16px;margin-top:12px">Play</h3><table class="ttable"><tr><td></td>${SEATS.map(s => `<td>${s}</td>`).join('')}</tr>${h.tricks.map((tr, k) => {
      const w = tr.cards.length === 4 ? trickWinner(tr, h.contract.strain) : null;
      return `<tr><td>${k + 1}</td>${SEATS.map(s => { const pc = tr.cards.find(x => x.seat === s); return `<td class="${s === w ? 'w' : ''} ${pc && isRed(suitOf(pc.card)) ? 'red' : ''} ${pc ? 's-' + suitOf(pc.card) : ''}">${pc ? SYM[suitOf(pc.card)] + rankLabel(pc.card[1]) : ''}</td>`; }).join('')}</tr>`;
    }).join('')}</table><p class="note">The underlined card won each trick. Use Replay the play to step through it card by card.</p>`;
  }
  modal(`<h3>Board ${h.board}</h3><p class="note" style="margin-top:-6px">Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
    <div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}<div class="lbl">${h.contract ? contractText(h.contract) + '<br>' + resultText(h.contract, h.declTricks) + ', N-S ' + h.scoreNS : 'Passed out'}</div>${hand('E')}<div></div>${hand('S')}<div></div></div>
    ${auctionGridHTML(T, h.auction, h.dealer, h.vul, null)}
    ${otherLine(h)}
    <h3 style="font-size:16px;margin-top:12px">Double-dummy analysis</h3><div id="ddBox">${ddHTML(h)}</div>${tt}
    <div class="row" style="margin-top:10px"><button class="btn small" id="pbnOne">Copy PBN</button>${h.tricks && h.tricks.length ? '<button class="btn small" id="replayBtn">Replay the play</button>' : ''}</div><div id="replayBox"></div>`);
  openRecord = i;
  $('pbnOne').addEventListener('click', () => copyText(pbnBoard(h, T)));
  if ($('replayBtn')) $('replayBtn').addEventListener('click', () => startReplay(h));
}
function otherLine(h) {
  let o = h.other, label = 'Robot table';
  if (!o && T.match && otherRoom) { o = otherRoom.history.find(x => x.board === h.board); label = T.match.room === 'Open' ? 'Closed room' : 'Open room'; }
  if (!o) return '';
  const im = T.match ? toImps((T.match.room === 'Open' ? h.scoreNS - o.scoreNS : o.scoreNS - h.scoreNS)) : toImps(h.scoreNS - o.scoreNS);
  return `<p><b>${label}:</b> ${o.contract ? contractText(o.contract) + ' ' + resultText(o.contract, o.declTricks) : 'Passed out'}, N-S ${o.scoreNS}. ${T.match ? (im ? `${Math.abs(im)} IMPs to Team ${im > 0 ? 1 : 2}` : 'No swing') : (im ? `${im > 0 ? '+' : ''}${im} IMPs to you` : 'No swing')}.</p>
    ${o.auction ? `<details><summary class="note">Their auction</summary>${auctionGridHTML(T, o.auction, h.dealer, h.vul, null)}</details>` : ''}`;
}
function showClaimDialog() {
  const left = 13 - completedTricks(T.play).length;
  let pick = left;
  const m = modal(`<h3>Claim</h3><p>How many of the remaining ${left} tricks will your side take?</p><div class="numgrid">${Array.from({ length: left + 1 }, (_, n) => `<button class="btn ${n === left ? 'sel' : ''}" data-n="${n}">${n}</button>`).join('')}</div><div class="row"><button class="btn primary" id="doClaim">Claim ${left}</button><span class="note">Choosing 0 concedes the rest.</span></div>`);
  m.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    pick = +b.dataset.n; m.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('sel', x === b)); $('doClaim').textContent = 'Claim ' + pick;
  }));
  $('doClaim').addEventListener('click', () => { $('modalRoot').innerHTML = ''; doAct('claim', pick); });
}


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
  $('chatInput').placeholder = !T.local && !mySeat(T) && inPlay ? 'Message the other spectators' : 'Message the table';
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
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });

// ----- "More" menu on phones -----
function setSide(open) { $('side').classList.toggle('open', open); $('sideBtn').setAttribute('aria-expanded', open); }
$('sideBtn').addEventListener('click', () => setSide(!$('side').classList.contains('open')));
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
function startReplay(h) {
  const flat = [];
  h.tricks.forEach((tr, k) => tr.cards.forEach((pc, j) => flat.push({ ...pc, trick: k, pos: j })));
  let step = flat.length; // number of cards shown as played
  const box = $('replayBox');
  const draw = () => {
    const played = new Set(flat.slice(0, step).map(x => x.card));
    const cur = step ? flat[step - 1] : null;
    const trickNo = cur ? cur.trick : 0;
    const inTrick = cur ? flat.slice(0, step).filter(x => x.trick === trickNo) : [];
    const shown = inTrick; // a finished trick stays visible until the next lead
    const winner = shown.length === 4 ? trickWinner({ cards: shown }, h.contract.strain) : null;
    const hand = s => `<div><div class="lbl">${SEAT_NAME[s]}</div>${rowsHTML(h.hands[s].filter(c => !played.has(c)))}</div>`;
    const tw = { decl: 0, def: 0 };
    h.tricks.slice(0, cur ? (cur.pos === 3 ? trickNo + 1 : trickNo) : 0).forEach(tr => {
      if (tr.cards.length === 4) (sameSide(trickWinner(tr, h.contract.strain), h.contract.declarer) ? tw.decl++ : tw.def++);
    });
    const centre = `<div class="tr">${shown.map(x => `<div style="text-align:center">${cardHTML(x.card, x.seat === winner ? 'win' : '', 'tabindex="-1"')}<div class="lbl">${x.seat}</div></div>`).join('') || '<span class="lbl">Opening lead next</span>'}</div>`;
    box.innerHTML = `<div class="replay"><div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}${centre}${hand('E')}<div></div>${hand('S')}<div></div></div>
      <p class="note" style="text-align:center">${step ? `Trick ${trickNo + 1}, card ${cur.pos + 1}: ${SEAT_NAME[cur.seat]} played ${rankLabel(cur.card[1])}${SYM[cur.card[0]]}.` : 'Before the opening lead.'} Declarer ${tw.decl}, defence ${tw.def}.</p>
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

// ---------- display options ----------
function showOptions() {
  const opt = (k, label, note) => `<label class="row" style="gap:8px;margin-bottom:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-pref="${k}" ${Prefs[k] ? 'checked' : ''} style="margin-top:4px"> <span>${label}${note ? `<br><span class="note">${note}</span>` : ''}</span></label>`;
  const m = modal(`<h3>Options</h3>
    ${opt('contrast', 'High contrast', 'Black outlines and stronger colours.')}
    ${opt('deck4', 'Four-colour deck', 'Clubs green and diamonds orange, so every suit has its own colour.')}
    ${opt('confirm', 'Confirm before playing a card', 'The first tap raises a card, the second tap plays it.')}
    ${opt('confirmBid', 'Confirm before bidding', 'Pick a call, then press the Bid button (or Enter) to make it.')}
    <label class="row" style="gap:8px;margin:4px 0 8px">Robot speed in practice <select id="optSpeed">${['slow', 'normal', 'fast'].map(v => `<option value="${v}" ${Prefs.speed === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    <h3 style="font-size:16px;margin-top:14px">Keyboard shortcuts</h3>
    <table class="reslist"><tr><td>Bidding</td><td><b>1</b>–<b>7</b> then <b>C D H S N</b> to bid, <b>P</b> pass, <b>X</b> double or redouble, <b>Enter</b> to confirm</td></tr>
    <tr><td>Playing</td><td><b>←</b> <b>→</b> choose a card, <b>Enter</b> to play it</td></tr>
    <tr><td>Anytime</td><td><b>L</b> last trick, <b>Esc</b> close a window</td></tr>
    <tr><td>Replay</td><td><b>←</b> <b>→</b> step through the play</td></tr></table>`);
  m.querySelectorAll('[data-pref]').forEach(cb => cb.addEventListener('change', () => {
    Prefs[cb.dataset.pref] = cb.checked; savePrefs(); applyPrefs(); if (cb.dataset.pref === 'confirm') selCard = null; if (cb.dataset.pref === 'confirmBid') pendingCall = null; if (T) render();
  }));
  $('optSpeed').addEventListener('change', e => { Prefs.speed = e.target.value; savePrefs(); });
}
document.addEventListener('click', e => { if (e.target.closest('[data-options]')) showOptions(); });

// ---------- keyboard ----------
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
  if (T.phase === 'auction' && !$('bidArea').classList.contains('hidden')) {
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
});

// ---------- host settings ----------
function showSettings() {
  const t = T;
  const people = SEATS.filter(s => t.seats[s] && !(t.seats[s].kind === 'human' && t.seats[s].id === me.id));
  const m = modal(`<h3>Table settings</h3>
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setLock" ${t.locked ? 'checked' : ''}> Lock seats, so only you can seat people</label>
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setUndo" ${t.allowUndo !== false ? 'checked' : ''}> Allow undo</label>
    ${t.local ? '' : `<label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setUndoAsk" ${t.undoAsk ? 'checked' : ''}> Opponents must agree to an undo</label>`}
    <label class="row" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="setKib" ${t.kibSee !== false ? 'checked' : ''}> Spectators see all four hands</label>
    <label class="row" style="gap:8px;margin-bottom:12px">Time per board <select id="setTime">${[0, 5, 7, 10, 15].map(m => `<option value="${m}" ${(t.boardLimit || 0) === m ? 'selected' : ''}>${m ? m + ' minutes' : 'No limit'}</option>`).join('')}</select></label>
    <h3 style="font-size:16px">Seats</h3>
    ${people.length ? people.map(s => `<div class="row" style="justify-content:space-between;margin-bottom:6px"><span>${SEAT_NAME[s]}: ${esc(seatLabel(t, s))}</span><button class="btn small" data-kick="${s}">Remove</button></div>`).join('') : '<p class="note">Nobody else is seated.</p>'}
    ${t.phase === 'auction' ? '<div class="row" style="margin-top:10px"><button class="btn" id="setRedeal">Redeal this board</button></div>' : ''}`);
  const bind = (id, key) => $(id).addEventListener('change', e => doAct('settings', { [key]: e.target.checked }));
  bind('setLock', 'locked'); bind('setUndo', 'allowUndo'); bind('setKib', 'kibSee'); if ($('setUndoAsk')) bind('setUndoAsk', 'undoAsk');
  $('setTime').addEventListener('change', e => doAct('settings', { boardLimit: +e.target.value }));
  m.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => { doAct('kick', b.dataset.kick); b.closest('.row').remove(); }));
  if ($('setRedeal')) $('setRedeal').addEventListener('click', () => { $('modalRoot').innerHTML = ''; doAct('redeal'); });
}

// ---------- clocks ----------
const mmss = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function tick() {
  const now = serverNow();
  document.querySelectorAll('.clk[data-since]').forEach(el => { el.textContent = mmss(now - +el.dataset.since); });
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
  else if (d.alert) toast(`Alert: ${d.alert}`, 4000);
  else if (d.sub) doAct('sub', d.sub);
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
$('practiceBtn').addEventListener('click', () => {
  const nm = me.name || $('nameInput').value.trim() || 'You';
  const t = newTable({ name: 'Practice', local: true });
  t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: nm }, W: { kind: 'robot' } };
  startBoard(t);
  openTable(t);
});
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
  tables.sort((x, y) => (free(y) > 0) - (free(x) > 0) || y.updatedAt - x.updatedAt);
  el.innerHTML = tables.map(t => {
    const humans = SEATS.filter(s => t.seats[s] && t.seats[s].kind === 'human').length;
    const open = free(t);
    const st0 = (t.match ? 'Team match, ' : '') + (t.phase === 'waiting' ? 'waiting for players' : `board ${t.board}`);
    const status = st0[0].toUpperCase() + st0.slice(1);
    return `<div class="trow"><div><div class="tname">${esc(t.name)}</div><div class="tmeta">${status}, ${humans} ${humans === 1 ? 'person' : 'people'} seated${open ? `, ${open} seat${open === 1 ? '' : 's'} free` : ''}</div>
      <div class="seatmini">${SEATS.map(s => { const o = t.seats[s]; return `<span class="${o ? '' : 'open'}">${s} ${o ? (o.kind === 'robot' ? 'Robot' : esc(o.name)) : 'open'}</span>`; }).join('')}</div></div>
      <button class="btn ${open ? 'primary' : ''}" data-open="${esc(t.code)}">${open ? 'Go to table' : 'Watch'}</button></div>`;
  }).join('');
  el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { if (needName()) openOnline(b.dataset.open); }));
}

// ---------- navigation ----------
function showTableView() {
  $('home').classList.add('hidden'); $('tableView').classList.remove('hidden');
  clearInterval(lobbyTimer);
}
function openTable(t) { // practice
  Net.close();
  T = t; tKey = null; lastRenderedVersion = -1; otherRoom = null; watchers = 0; wasMyTurn = false; clockSkew = 0;
  showTableView(); render();
  history.replaceState(null, '', location.pathname);
}
function openOnline(code) {
  clearTimeout(robotTimer); robotTimer = null;
  if (T && !T.local) { // leaving another online table, e.g. switching team-match rooms
    T = null; selCard = null; pendingCall = null; selLevel = null;
    $('felt').innerHTML = '<div class="pos-center"><div class="waitmsg">Connecting…</div></div>';
    $('myHand').innerHTML = ''; $('bidArea').classList.add('hidden'); $('modalRoot').innerHTML = '';
  }
  wasMyTurn = false; $('alertChk').checked = false; $('alertText').classList.add('hidden');
  setTimeout(() => { if (Net.code === code && !Net.gotState) toast('Still trying to reach the table. Check your connection.', 4000); }, 5000);
  Net.open(code, () => {
    lastRenderedVersion = -1; showTableView();
    history.replaceState(null, '', '#' + code);
  });
}
function goHome() {
  releaseWakeLock();
  Net.close(); clearTimeout(robotTimer); robotTimer = null;
  T = null; tKey = null; DD.queue.length = 0; // stop analysing the table you left
  for (const [k, en] of DD.cache) if (!en.done) DD.cache.delete(k); // ...and let it start again if you come back
  wasMyTurn = false; clockSkew = 0;
  $('tableView').classList.add('hidden'); $('home').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
  loadLobby(); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000);
}
function leaveTable() {
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
  await adoptIdentityFromLink();
  const code = location.hash.slice(1).toUpperCase();
  if (/^[A-Z]{5}$/.test(code) && me.name) openOnline(code);
  else if (/^[A-Z]{5}$/.test(code)) $('codeInput').value = code;
  loadLobby();
  lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000);
})();
