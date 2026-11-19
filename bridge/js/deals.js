// ===== Practice deal types (feature: deals) =====
// Dealing for practice tables by rejection sampling: deal at random until a deal passes the chosen filter,
// for at most DEAL_BUDGET_MS, then fall back to a plain random deal. You always sit South in practice.
// Also "rotate so I'm declarer": when North ends up declaring, the whole table turns round 180 degrees
// (hands, auction, dealer, declarer and any tricks), so you play the hand from South. N-S stays N-S, so
// vulnerability and scores don't change.
const DEAL_BUDGET_MS = 80;
const DEAL_TYPES = [
  ['random', 'Random'],
  ['declare', 'I declare'],
  ['slam', 'Slam deals'],
  ['compete', 'Competitive auctions'],
  ['nt', '1NT openings'],
  ['preempt', 'Preempts'],
  ['game', 'Games (more strength for N-S)'],
  ['custom', 'Custom'],
];
const DEAL_SHAPES = [['any', 'Any shape'], ['major5', 'A 5+ card major'], ['bal', 'Balanced'], ['long6', 'A 6+ card suit']];

function dealInfo(cards) {
  const L = suitLengths(cards), ls = Object.values(L).sort((a, b) => b - a);
  return { hcp: hcp(cards), L, long: ls[0], bal: ls[3] >= 2 && (ls[0] <= 4 || (ls[0] === 5 && ls[1] === 3)) };
}
function dealFit(a, b) { return Math.max(...SUITS.map(s => a.L[s] + b.L[s])); }
// seats from the dealer round to (not including) seat
function dealSeatsBefore(dealer, seat) { const r = []; for (let s = dealer; s !== seat; s = nextSeat(s)) r.push(s); return r; }
// the first seat from the dealer with an opening bid (12+ HCP), or null
function dealOpener(i, dealer) { let s = dealer; for (let k = 0; k < 4; k++, s = nextSeat(s)) if (i[s].hcp >= 12) return s; return null; }

const DEAL_FILTERS = {
  declare: (i) => i.S.hcp >= 16 && i.S.hcp > i.N.hcp + 3 && i.N.hcp + i.S.hcp >= 23,
  slam: (i) => { const ns = i.N.hcp + i.S.hcp; return ns >= 32 || (ns >= 28 && dealFit(i.N, i.S) >= 9); },
  compete: (i) => {
    const ns = i.N.hcp + i.S.hcp;
    return ns >= 17 && ns <= 23 && dealFit(i.N, i.S) >= 8 && dealFit(i.E, i.W) >= 8 && [i.N, i.S].some(x => x.hcp >= 10 && x.long >= 5) && [i.E, i.W].some(x => x.hcp >= 10 && x.long >= 5);
  },
  nt: (i, dealer) => { const o = dealOpener(i, dealer); return (o === 'S' || o === 'N') && i[o].hcp >= 15 && i[o].hcp <= 17 && i[o].bal; },
  preempt: (i, dealer) => { // someone has a weak hand with a long suit, and nobody before them could open
    for (let s = dealer, k = 0; k < 4; k++, s = nextSeat(s)) {
      const x = i[s];
      if (x.hcp >= 12) return false;
      if (x.hcp >= 5 && x.hcp <= 10 && (x.long >= 7 || ((x.L.S >= 6 || x.L.H >= 6 || x.L.D >= 6) && x.long === 6))) return true;
      if (x.long >= 6) return false;
    }
    return false;
  },
  game: (i) => i.N.hcp + i.S.hcp >= 26,
  custom: (i) => {
    const lo = +Prefs.dealMin || 0, hi = Prefs.dealMax === undefined || Prefs.dealMax === '' ? 37 : +Prefs.dealMax, x = i.S;
    if (x.hcp < lo || x.hcp > hi) return false;
    const sh = Prefs.dealShape || 'any';
    return sh === 'any' || (sh === 'major5' && (x.L.S >= 5 || x.L.H >= 5)) || (sh === 'bal' && x.bal) || (sh === 'long6' && x.long >= 6);
  },
};

// Hands for a new practice board, or null to use a plain random deal.
function practiceDeal(t, kind = Prefs.deals, budget = DEAL_BUDGET_MS) {
  const f = DEAL_FILTERS[kind];
  if (!f) return null;
  const end = Date.now() + budget;
  for (let n = 0; ; n++) {
    const h = deal();
    const i = {}; for (const s of SEATS) i[s] = dealInfo(h[s]);
    if (f(i, t.dealer)) return h;
    if ((n & 63) === 63 && Date.now() > end) break;
  }
  if (typeof toast === 'function') toast('No deal of that kind turned up in time, so this one is random');
  return null;
}

// ---------- rotate so I'm declarer ----------
const ROT = { N: 'S', S: 'N', E: 'W', W: 'E' };
function rotateTable(t) {
  t.hands = { N: t.hands.S, E: t.hands.W, S: t.hands.N, W: t.hands.E };
  t.dealer = ROT[t.dealer];
  t.auction = t.auction.map(a => ({ ...a, by: ROT[a.by] }));
  if (t.contract) t.contract = { ...t.contract, declarer: ROT[t.contract.declarer] };
  for (const tr of t.play.tricks) { tr.leader = ROT[tr.leader]; for (const pc of tr.cards) pc.seat = ROT[pc.seat]; }
  t.rotated = !t.rotated;
}
// Called on the new state after each practice action: turns the table round once the auction ends with North declaring.
function dealsAfterAct(t) {
  if (t.rotated && t.rotated !== t.board) t.rotated = false; // a new board starts the right way round
  if (t.rotated && t.phase === 'auction') { rotateTable(t); return; } // undo back into the auction: turn back first
  if (!Prefs.rotateDecl || !t.local || t.phase !== 'play' || !t.contract || t.contract.declarer !== 'N' || mySeat(t) !== 'S') return;
  if (t.play.tricks.length) return; // only as the play starts
  rotateTable(t); t.rotated = t.board;
  if (typeof toast === 'function') toast('Turned round: you declare from South');
}

// ---------- Options ----------
function dealsOptionsHTML() {
  const sel = (id, list, v) => `<select id="${id}">${list.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const hc = (id, v) => `<input id="${id}" type="number" min="0" max="37" value="${v}" style="width:4em">`;
  return `<label class="row" style="gap:8px;margin:4px 0 8px">Deals in practice ${sel('optDeals', DEAL_TYPES, Prefs.deals || 'random')}</label>
    <div id="optDealCustom" class="row" style="gap:8px;margin:0 0 8px;flex-wrap:wrap;${Prefs.deals === 'custom' ? '' : 'display:none'}">
      <span>South</span>${hc('optDealMin', Prefs.dealMin ?? 0)}<span>to</span>${hc('optDealMax', Prefs.dealMax ?? 37)}<span>HCP,</span>${sel('optDealShape', DEAL_SHAPES, Prefs.dealShape || 'any')}</div>
    <label class="row" style="gap:8px;margin-bottom:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="optRotate" ${Prefs.rotateDecl ? 'checked' : ''} style="margin-top:4px"> <span>Rotate so I'm declarer<br><span class="note">When North declares in practice, the table turns round so you play the hand from South.</span></span></label>`;
}
function dealsOptionsWire(m) {
  const g = id => m.querySelector('#' + id);
  if (!g('optDeals')) return;
  g('optDeals').addEventListener('change', e => { Prefs.deals = e.target.value; savePrefs(); g('optDealCustom').style.display = e.target.value === 'custom' ? '' : 'none'; });
  const num = (id, k) => g(id).addEventListener('change', e => { const v = Math.max(0, Math.min(37, Math.round(+e.target.value || 0))); e.target.value = v; Prefs[k] = v; savePrefs(); });
  num('optDealMin', 'dealMin'); num('optDealMax', 'dealMax');
  g('optDealShape').addEventListener('change', e => { Prefs.dealShape = e.target.value; savePrefs(); });
  g('optRotate').addEventListener('change', e => { Prefs.rotateDecl = e.target.checked; savePrefs(); });
}

if (typeof module !== 'undefined') module.exports = { practiceDeal, rotateTable, dealsAfterAct, DEAL_FILTERS, dealInfo };
