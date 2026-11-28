// ======================= Learning mode and robot strength (feature: learn) =======================
// Practice only (not online tables, not the daily deal). Options:
// - "Show all hands": the robots' hands are face up during the play.
// - "Show tricks per card": on your turn (and dummy's when you declare) each legal card gets a small badge with the
//   tricks your side takes in the whole board, double dummy, if you play it. One solve per position, in a worker of
//   its own (the same few lines as the play review in js/analysis.js), and it waits while a robot is thinking.
//   Boards played with either aid on are marked `aided: true` in their record (History shows a small marker).
// - "Robot strength": Beginner (heuristic play, botPlay/botLead), Club (fewer layouts, shorter budget), Strong (the
//   usual settings) or Expert (more layouts, a longer budget). js/analysis.js robotDDCardStd asks robotLevel() for the
//   parameters of a robot's card decision; online robots, friends-mode solving and the hint are unchanged.
// Loaded before app.js; uses its helpers (Prefs, T, render) at run time.

const Learn = {
  // overrides of the RobotDD / LeadDD parameters in js/analysis.js; strong = none (today's robots)
  LEVELS: {
    beginner: { heuristic: true },
    club: { K: 4, MIN_K: 3, BUDGET_MS: 800, POOL: 0, LEAD_K: 12, LEAD_MS: 900 }, // POOL 0: no reading of the play so far
    strong: null,
    expert: { K: 48, BUDGET_MS: 3000, POOL: 192, LEAD_K: 96, LEAD_MS: 3000 },
  },
  NAMES: { beginner: 'Beginner', club: 'Club', strong: 'Strong', expert: 'Expert' },
  res: new Map(), // playKey -> { card: tricks for the mover's side in the whole board }
  want: null, // the position waiting for its solve: { key, job, base }
  cur: null, // the position being solved
  w: null, failed: false, aided: new Set(), wait: 0,

  ok: t => !!(t && t.local && !t.daily),
  showAll(t) { return !!(Prefs.learnAll && Learn.ok(t) && t.phase === 'play'); },
  tricksOn(t) { return !!(Prefs.learnTricks && Learn.ok(t) && t.phase === 'play' && !Learn.failed); },

  // the parameters of a practice robot's card decision (null: the usual ones); not for your own seat (the hint)
  robotLevel(t, seat) {
    if (!Learn.ok(t)) return null;
    const o = occupant(t, controllerOf(t, seat));
    if (!o || o.kind !== 'robot') return null;
    return Learn.LEVELS[Prefs.robotLevel] || null;
  },

  optionsHTML(opt) {
    if (T && !T.local) return '';
    const lv = Prefs.robotLevel in Learn.LEVELS ? Prefs.robotLevel : 'strong';
    return opt('learnAll', 'Show all hands', 'In practice, every hand is face up during the play. Such boards are marked in History.')
      + opt('learnTricks', 'Show tricks per card', 'In practice, on your turn each card you can play shows the tricks your side takes, double dummy, if you play it. Such boards are marked in History.')
      + `<label class="row" style="gap:8px;margin:4px 0 8px">Robot strength in practice <select id="optLevel">${Object.keys(Learn.NAMES).map(v => `<option value="${v}" ${lv === v ? 'selected' : ''}>${Learn.NAMES[v]}</option>`).join('')}</select></label>`;
  },
  wireOptions(m) {
    const s = m.querySelector('#optLevel');
    if (s) s.addEventListener('change', () => { Prefs.robotLevel = s.value; savePrefs(); });
  },

  // called from app.js render(): marks aided boards, and asks for the badges' solve
  onRender(t) {
    if (!Learn.ok(t)) return;
    if (t.phase === 'play' && (Learn.showAll(t) || Learn.tricksOn(t))) Learn.aided.add(Learn.boardKey(t.id, t.board, t.hands));
    if (t.phase === 'done' && t.history.length) {
      const h = t.history[t.history.length - 1];
      if (!h.aided && h.hands && Learn.aided.has(Learn.boardKey(t.id, h.board, h.hands))) h.aided = true;
    }
    Learn.ask(t);
  },
  boardKey: (id, board, hands) => `${id}:${board}:${hands && hands.N ? hands.N.join('') : ''}`,

  // the seat whose legal cards get badges now (yours, or dummy's when you declare), or null
  mover(t) {
    if (!Learn.tricksOn(t) || t.claim || t.timeUp) return null;
    const ts = turnSeat(t);
    return ts && myLegal(t, ts).length > 1 ? ts : null;
  },
  ask(t) {
    const seat = Learn.mover(t); if (!seat) return;
    const key = playKey(t);
    if (Learn.res.has(key) || (Learn.cur && Learn.cur.key === key) || (Learn.want && Learn.want.key === key)) return;
    if (SEATS.some(s => !t.hands[s] || t.hands[s].some(c => c[0] === '?'))) return;
    const hands = {}; SEATS.forEach(s => { hands[s] = remainingHand(t.hands, t.play, s); });
    const tr = t.play.tricks[t.play.tricks.length - 1], open = tr && tr.cards.length < 4;
    const trick = open ? tr.cards.map(pc => pc.card) : [];
    const won = tricksWon(t.play, t.contract), base = sameSide(seat, t.contract.declarer) ? won.decl : won.def;
    Learn.want = { key, base, job: { trump: DD_TRUMP[t.contract.strain], first: SEATS.indexOf(open ? tr.leader : seat), trick, pbn: ddPBN(hands), hands, mover: seat } };
    Learn.pump();
  },
  pump() {
    if (Learn.cur || !Learn.want || Learn.failed) return;
    // a robot is thinking: it goes first (as the hand-record analysis does)
    if (typeof ddRobotBusy === 'function' && ddRobotBusy()) { if (!Learn.wait) Learn.wait = setTimeout(() => { Learn.wait = 0; Learn.pump(); }, 300); return; }
    const j = Learn.cur = Learn.want; Learn.want = null;
    try { Learn.worker().postMessage({ key: j.key, job: j.job }); } catch (e) { Learn.fail(); }
  },
  worker() {
    if (Learn.w) return Learn.w;
    const u = p => JSON.stringify(new URL('js/' + p, location.href).href);
    const src = `importScripts(${u('wasm/compiled.js')}, ${u('min/engine.js')}, ${u('min/ddplay.js')});
let mod = null, solve = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.wasm) { mod = mod || m.wasm; return; }
  try {
    if (!solve) { if (!mod) mod = await WebAssembly.compile(await (await fetch(${u('wasm/compiled.wasm')})).arrayBuffer()); solve = ddSolver(create_dds_module, mod); }
    self.postMessage({ key: m.key, r: await solve(m.job) });
  } catch (err) { self.postMessage({ key: m.key, error: String(err && err.message || err) }); }
};`;
    const w = Learn.w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.addEventListener('error', e => e.preventDefault()); /* feature: stab3 */
    if (typeof ddGiveWasm === 'function') ddGiveWasm(w);
    w.onmessage = e => {
      const m = e.data, j = Learn.cur; Learn.cur = null;
      if (m.error) { Learn.fail(); return; }
      if (j && j.key === m.key) {
        const out = {}; for (const c in m.r) out[c] = j.base + m.r[c];
        Learn.res.set(m.key, out);
        if (Learn.res.size > 60) Learn.res.delete(Learn.res.keys().next().value);
        if (T && playKey(T) === m.key) Learn.decorate();
      }
      Learn.pump();
    };
    w.onerror = () => Learn.fail();
    return w;
  },
  fail() {
    Learn.failed = true; Learn.cur = Learn.want = null;
    try { if (Learn.w) Learn.w.terminate(); } catch (e) { } Learn.w = null;
  },

  // called after app.js draws the felt and your hand: a badge on each legal card (none until the solve is in)
  decorate() {
    const t = T; if (!t || !Learn.mover(t)) return;
    const r = Learn.res.get(playKey(t)); if (!r) return;
    const legal = myLegal(t, turnSeat(t)), best = Math.max(...legal.map(c => r[c] ?? -1));
    document.querySelectorAll('#felt [data-play], #myHand [data-play]').forEach(el => {
      const c = el.dataset.play, v = r[c];
      if (v === undefined || !legal.includes(c) || el.querySelector('.ddn')) return;
      el.insertAdjacentHTML('beforeend', `<span class="ddn${v < best ? ' lo' : ''}" aria-hidden="true">${v}</span>`);
      el.title = `${v} trick${v === 1 ? '' : 's'} for your side, double dummy`;
    });
  },
};
