// ======================= MiniBridge and the new-practice options (feature: minibridge) =======================
// MiniBridge, the beginners' game (as on BBO, RealBridge and Trickster): no auction. Every player's high-card
// points are shown on the name plates. The side with more points declares, and of that side the player with
// more points is declarer. Ties: if both sides have 20, the dealer's side declares; if partners have the same
// points, the one nearer the dealer (the dealer, or the first after the dealer going clockwise) declares.
// Dummy goes face up at once; declarer then chooses a strain and a target from a small panel:
//   part-score = the 1-level contract (1♣ … 1NT), game = 5♣, 5♦, 4♥, 4♠ or 3NT.
// Scoring: the target is the contract, scored as usual (duplicate scoring, or rubber/Chicago if that is on):
// a part-score scores its tricks plus 50 (overtricks count), so choosing game when it makes pays the game bonus,
// and a game that fails goes down from the game level. No doubles.
// Robot declarers pick the strain and target that score best double dummy for their side (the page's solver,
// js/analysis.js requestDD, used read-only); if the solver isn't available they guess from fit and points.
// Results compare your score with that double-dummy choice (the "Robots" column), in IMPs.
// Practice only: chosen from the home page's New practice options, which also set the scoring (js/rubber.js).
// Hooks: app.js act() and startPractice() call PracticeModes; plateHTML, seatBlock and renderFelt ask Mini.

const MINI_GAME = { C: 5, D: 5, H: 4, S: 4, N: 3 };
const Mini = {
  on: t => !!(t && t.local && t.mini && !t.daily),
  points: hands => Object.fromEntries(SEATS.map(s => [s, hcp(hands[s])])),
  // Who declares: see the rules at the top.
  declarer(hands, dealer) {
    const p = Mini.points(hands), ns = p.N + p.S, ew = p.E + p.W;
    const side = ns > ew ? 'NS' : ew > ns ? 'EW' : sideOf(dealer);
    const order = [dealer, nextSeat(dealer), partnerOf(dealer), nextSeat(partnerOf(dealer))].filter(s => sideOf(s) === side);
    return p[order[1]] > p[order[0]] ? order[1] : order[0];
  },
  contracts: (strain, declarer) => [{ level: 1, strain, doubled: 0, declarer }, { level: MINI_GAME[strain], strain, doubled: 0, declarer }],
  // The best strain and target double dummy (dd: the solver's table, { N: { C: tricks, ... }, ... }).
  best(dd, declarer, vul) {
    let best = null;
    for (const st of ['N', 'S', 'H', 'D', 'C']) {
      const n = dd[declarer] && dd[declarer][st]; if (n == null) return null;
      for (const c of Mini.contracts(st, declarer)) {
        const sc = scoreContract(c, n, vul);
        if (!best || sc > best.score) best = { contract: c, tricks: n, score: sc };
      }
    }
    return best;
  },
  // Without the solver: an 8-card major fit, else notrump unless a 9-card minor fit and a short suit; game with 25+ (29+ in a minor).
  guess(hands, declarer) {
    const a = suitLengths(hands[declarer]), b = suitLengths(hands[partnerOf(declarer)]);
    const pts = hcp(hands[declarer]) + hcp(hands[partnerOf(declarer)]);
    const fit = s => a[s] + b[s], short = Math.min(...SUITS.map(s => Math.min(a[s], b[s])));
    let strain = 'N';
    const maj = ['S', 'H'].filter(s => fit(s) >= 8).sort((x, y) => fit(y) - fit(x))[0];
    const min = ['D', 'C'].filter(s => fit(s) >= 9).sort((x, y) => fit(y) - fit(x))[0];
    if (maj) strain = maj; else if (min && short <= 1) strain = min;
    const game = pts >= (strain === 'C' || strain === 'D' ? 29 : 25);
    return { level: game ? MINI_GAME[strain] : 1, strain, doubled: 0, declarer };
  },
  // ---- table actions (on the state copy act() hands over) ----
  afterAct(t) {
    if (!Mini.on(t)) return;
    // a new board: no auction; find declarer, and dummy goes face up while declarer chooses
    if (t.phase === 'auction' && !t.auction.length && t.mini.board !== t.board) {
      let d = Mini.declarer(t.hands, t.dealer);
      // the Options' "rotate so I'm declarer" (js/deals.js) turns the table now, so you choose and play from South
      if (d === 'N' && mySeat(t) === 'S' && typeof Prefs !== 'undefined' && Prefs.rotateDecl && typeof rotateTable === 'function') { rotateTable(t); t.rotated = t.board; d = 'S'; }
      t.mini = { board: t.board, declarer: d };
      t.phase = 'mini';
      const p = Mini.points(t.hands);
      sysMsg(t, `Board ${t.board}: N-S ${p.N + p.S}, E-W ${p.E + p.W} points. ${SEAT_NAME[d]} declares.`);
    }
    // a board just ended: mark it and add the double-dummy comparison when the solver has it
    const h = t.history[t.history.length - 1];
    if (t.phase === 'done' && h && h.board === t.board && !h.mini) {
      h.mini = true; h.other = null;
      Mini.fillOther(h);
    }
  },
  choose(t, seat, level, strain) {
    if (!Mini.on(t) || t.phase !== 'mini' || t.mini.board !== t.board || seat !== t.mini.declarer) return false;
    if (!MINI_GAME[strain] || (level !== 1 && level !== MINI_GAME[strain])) return false;
    t.contract = { level, strain, doubled: 0, declarer: seat };
    t.phase = 'play'; t.lastActAt = Date.now();
    sysMsg(t, `${SEAT_NAME[seat]} chooses ${level}${SYM[strain]} (${level === 1 ? 'part-score' : 'game'})`);
  },
  fillOther(h) {
    if (h.other || typeof ddEntry !== 'function' || !h.contract) return false;
    const en = ddEntry(h.hands); if (!en || !en.done) return false;
    const b = Mini.best(en.table, h.contract.declarer, h.vul); if (!b) return false;
    h.other = { auction: [], contract: b.contract, declTricks: b.tricks, scoreNS: scoreNS(b.contract, b.tricks, h.vul) };
    return true;
  },
  // ---- the page ----
  faceUp(t, seat) { // dummy is face up from the start, for everyone
    if (!Mini.on(t)) return false;
    if (t.phase === 'mini') return seat === partnerOf(t.mini.declarer);
    return t.phase === 'play' && seat === dummySeat(t);
  },
  tag(t, seat) { // every player's points on the plates
    if (!Mini.on(t) || !t.hands || (t.phase !== 'mini' && t.phase !== 'play')) return '';
    return `<span class="hcpTag" title="High-card points">${hcp(t.hands[seat])} HCP</span>`;
  },
  centerHTML(t) {
    const d = t.mini.declarer, mine = mySeat(t), p = Mini.points(t.hands);
    const pts = `<p class="note">N-S ${p.N + p.S}, E-W ${p.E + p.W} points</p>`;
    if (mine !== d || controllerOf(t, d) !== mine) return `<div class="waitmsg">${SEAT_NAME[d]} declares${pts}</div>`;
    const btn = c => `<button class="bcard ${isRed(c.strain) ? 'red' : ''}" data-mini="${c.level}${c.strain}" aria-label="${c.level} ${STRAIN_WORD[c.strain]}">${c.level}${c.strain === 'N' ? 'NT' : SYM[c.strain]}</button>`;
    const row = (label, k) => `<span class="ml">${label}</span>${['C', 'D', 'H', 'S', 'N'].map(s => btn(Mini.contracts(s, d)[k])).join('')}`;
    return `<div class="banner minipick"><h3>Choose a contract</h3>${pts}<div class="mgrid">${row('Part-score', 0)}${row('Game', 1)}</div></div>`;
  },
  resultsNote: 'MiniBridge: Robots is the best strain and target double dummy. Tap a board to see its hand record.',
  // robot declarers choose once the solver has the deal (at most a few seconds), at the robots' usual pace
  pick: null,
  onRender(t) {
    if (!Mini.on(t)) return;
    if (t.history.some(h => h.mini && !h.other && Mini.fillOther(h))) renderSide(true);
    if (t.phase !== 'mini') return;
    if (typeof requestDD === 'function') requestDD(t.hands, true);
    const d = t.mini.declarer, o = occupant(t, controllerOf(t, d));
    const key = t.id + ':' + t.board;
    if (!o || o.kind !== 'robot' || (Mini.pick && Mini.pick.key === key)) return;
    const start = Date.now(), pick = Mini.pick = { key };
    const step = () => {
      if (Mini.pick !== pick || !T || T.id + ':' + T.board !== key || T.phase !== 'mini') return;
      const en = typeof ddEntry === 'function' ? ddEntry(T.hands) : null;
      const ready = en && en.done, waited = Date.now() - start;
      if (!ready && !(typeof DD !== 'undefined' && DD.failed) && waited < 6000) { setTimeout(step, 150); return; }
      if (waited < 900 * speedMult()) { setTimeout(step, 900 * speedMult() - waited); return; }
      const b = ready && Mini.best(en.table, d, T.vul);
      const c = b ? b.contract : Mini.guess(T.hands, d);
      act(s => s.id + ':' + s.board === key ? Mini.choose(s, d, c.level, c.strain) : false);
    };
    setTimeout(step, 150);
  },
};
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-mini]'); if (!b || !T) return;
  const v = b.dataset.mini, seat = mySeat(T);
  act(s => Mini.choose(s, seat, +v[0], v[1]));
});

// ---------------- New practice: game and scoring ----------------
const PracticeModes = {
  pending: null,
  show() {
    const g = Prefs.pmGame || 'bid', sc = Prefs.pmScore || 'duplicate';
    const radio = (name, v, cur, label, note) => `<label class="row" style="gap:8px;margin-bottom:6px;flex-wrap:nowrap;align-items:flex-start"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''} style="margin-top:4px"> <span>${label}${note ? `<br><span class="note">${note}</span>` : ''}</span></label>`;
    const m = modal(`<h3>New practice</h3>
      <fieldset class="pm"><legend>Game</legend>
      ${radio('pmGame', 'bid', g, 'Bidding and play')}
      ${radio('pmGame', 'mini', g, 'MiniBridge', 'No bidding. The side with more points declares and chooses a part-score or game.')}</fieldset>
      <fieldset class="pm"><legend>Scoring</legend>
      ${radio('pmScore', 'duplicate', sc, 'Duplicate', 'Each board on its own, compared with the robots in IMPs.')}
      ${radio('pmScore', 'rubber', sc, 'Rubber', 'Games and part-scores add up; the first side to two games wins the rubber.')}
      ${radio('pmScore', 'chicago', sc, 'Chicago', 'Four deals with set vulnerability, then a new Chicago.')}
      <label class="row" style="gap:8px;margin:2px 0 0 24px"><input type="checkbox" id="pmHon" ${Prefs.pmHon ? 'checked' : ''}> Honours</label></fieldset>
      <p class="note">This starts a new practice table; the one in progress is replaced.</p>
      <div class="row"><button class="btn primary" id="pmStart">Start</button><button class="btn" data-close="1">Cancel</button></div>`);
    m.querySelector('#pmStart').addEventListener('click', () => {
      const v = n => (m.querySelector(`input[name=${n}]:checked`) || {}).value;
      Prefs.pmGame = v('pmGame') || 'bid'; Prefs.pmScore = v('pmScore') || 'duplicate'; Prefs.pmHon = m.querySelector('#pmHon').checked; savePrefs();
      PracticeModes.pending = { mini: Prefs.pmGame === 'mini', score: Prefs.pmScore, honours: Prefs.pmHon };
      closeModal();
      try { startPractice(true); } finally { PracticeModes.pending = null; }
    });
  },
  // a fresh practice table from the dialog (called by startPractice before the first board is dealt)
  apply(t) {
    const p = PracticeModes.pending; if (!p) return;
    if (p.mini) t.mini = { board: 0 };
    if (p.score === 'rubber' || p.score === 'chicago') t.rubber = { mode: p.score, honours: !!p.honours, log: [] };
    const sc = { rubber: 'rubber', chicago: 'Chicago' }[p.score];
    t.name = p.mini ? 'MiniBridge' + (sc ? ', ' + sc : '') : sc ? sc[0].toUpperCase() + sc.slice(1) + ' practice' : 'Practice';
  },
  afterAct(t) {
    if (typeof RubberUI !== 'undefined') RubberUI.afterAct(t); // first: it sets the new board's dealer and vulnerability
    Mini.afterAct(t);
  },
};

if (typeof module !== 'undefined') module.exports = { Mini, MINI_GAME };
