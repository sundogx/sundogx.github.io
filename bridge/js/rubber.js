// ======================= Rubber and Chicago scoring (feature: rubber) =======================
// Practice only. The pure scoring functions (Rubber.*) sit next to engine.js's duplicate scoring, which they
// don't change; tests/rubbertest.js checks them. RubberUI (below) keeps a log of the practice table's boards
// in t.rubber, sets each new board's dealer and vulnerability from it, and draws the score sheet in Results.
//
// Rubber (Laws of Contract Bridge): contract tricks go below the line (♣/♦ 20, ♥/♠ 30, NT 40 then 30, x2
// doubled, x4 redoubled); 100 below the line is a game, and both sides' part-scores then stop counting towards
// the next game. Overtricks, the 50/100 "insult" for making a doubled/redoubled contract, slam bonuses,
// undertricks and (optionally) honours go above the line. A side with a game is vulnerable. The first side to
// two games wins the rubber: 700 if the other side has no game, 500 if it has one. No part-score bonus.
// An unfinished rubber would add 300 for a side's single game and 100 for a part-score in the unfinished game;
// the sheet shows that as "if stopped now" and never adds it to the totals.
// Chicago: four deals; deal 1 nobody vulnerable, deals 2 and 3 the dealer's side, deal 4 both. Dealers North,
// East, South, West in turn. Part-scores carry over between the four deals as in rubber; a game scores 300 (500
// vulnerable) at once; a part-score made on the fourth deal that doesn't complete a game scores 100. No rubber
// bonus. A passed-out deal is dealt again by the same dealer (it isn't one of the four).
// Honours (an option): four of the five trump honours in one hand 100, all five 150; at notrump all four aces
// in one hand 150. They go to the side that holds them, defenders included, made or not.

const Rubber = {
  side: seat => (seat === 'N' || seat === 'S') ? 'NS' : 'EW',
  other: side => side === 'NS' ? 'EW' : 'NS',
  vulFor(side, vul) { return vul === 'Both' || vul === side; },
  // One deal: { side (declarer's), below (to declarer's side), above: [{ side, pts, what }] }.
  score(c, tricks, vul) {
    const side = Rubber.side(c.declarer), opp = Rubber.other(side), v = Rubber.vulFor(side, vul);
    const need = c.level + 6, dbl = c.doubled || 0, mult = dbl === 2 ? 4 : dbl === 1 ? 2 : 1;
    const per = (c.strain === 'C' || c.strain === 'D') ? 20 : 30;
    if (tricks >= need) {
      const below = (c.level * per + (c.strain === 'N' ? 10 : 0)) * mult, above = [], over = tricks - need;
      if (over) above.push({ side, pts: dbl ? over * (v ? 200 : 100) * (dbl === 2 ? 2 : 1) : over * per, what: over === 1 ? 'Overtrick' : 'Overtricks' });
      if (dbl) above.push({ side, pts: dbl === 2 ? 100 : 50, what: dbl === 2 ? 'Making redoubled' : 'Making doubled' });
      if (c.level === 6) above.push({ side, pts: v ? 750 : 500, what: 'Small slam' });
      if (c.level === 7) above.push({ side, pts: v ? 1500 : 1000, what: 'Grand slam' });
      return { side, below, above };
    }
    const down = need - tricks;
    let pen = 0;
    if (!dbl) pen = down * (v ? 100 : 50);
    else {
      for (let i = 1; i <= down; i++) pen += v ? (i === 1 ? 200 : 300) : (i === 1 ? 100 : i <= 3 ? 200 : 300);
      if (dbl === 2) pen *= 2;
    }
    return { side, below: 0, above: [{ side: opp, pts: pen, what: down === 1 ? 'Undertrick' : 'Undertricks' }] };
  },
  // Honours held in one hand for this contract: { side, pts, what } or null.
  honours(hands, c) {
    if (!hands || !c) return null;
    for (const s of ['N', 'E', 'S', 'W']) {
      const h = hands[s] || [];
      if (c.strain === 'N') { if (h.filter(x => x[1] === 'A').length === 4) return { side: Rubber.side(s), pts: 150, what: 'Four aces' }; continue; }
      const n = h.filter(x => x[0] === c.strain && 'AKQJT'.includes(x[1])).length;
      if (n >= 4) return { side: Rubber.side(s), pts: n === 5 ? 150 : 100, what: n === 5 ? 'Five honours' : 'Four honours' };
    }
    return null;
  },
  // Chicago: vulnerability of deal pos (0-3) dealt by dealer.
  chicagoVul(pos, dealer) { return pos === 0 ? 'None' : pos === 3 ? 'Both' : Rubber.side(dealer); },
  chicagoDealer: pos => ['N', 'E', 'S', 'W'][pos],
  newSet: () => ({ deals: [], above: [], games: [{ NS: [], EW: [], winner: null }], won: { NS: 0, EW: 0 }, pos: 0, done: false, total: { NS: 0, EW: 0 } }),
  // The whole score sheet from the log of boards ([{ board, dealer, contract, declTricks, hon }]).
  // opts: { mode: 'rubber' | 'chicago', honours }. Returns { sets: [...], cur (the set in play, maybe new) }.
  sheet(log, opts = {}) {
    const chicago = opts.mode === 'chicago', sets = [];
    let set = Rubber.newSet();
    const add = (side, pts, what, board, line = 'above') => {
      if (!pts) return;
      if (line === 'above') set.above.push({ side, pts, what, board });
      else set.games[set.games.length - 1][side].push({ pts, board });
      set.total[side] += pts;
    };
    for (const e of log || []) {
      if (set.done) { sets.push(set); set = Rubber.newSet(); }
      const vul = chicago ? Rubber.chicagoVul(set.pos, Rubber.chicagoDealer(set.pos)) : Rubber.setVul(set);
      set.deals.push({ board: e.board, vul, contract: e.contract || null, declTricks: e.declTricks });
      if (!e.contract) continue; // passed out (Chicago: the same dealer deals again)
      const r = Rubber.score(e.contract, e.declTricks, vul);
      add(r.side, r.below, 'Contract', e.board, 'below');
      r.above.forEach(a => add(a.side, a.pts, a.what, e.board));
      if (opts.honours && e.hon) add(e.hon.side, e.hon.pts, e.hon.what, e.board);
      const g = set.games[set.games.length - 1], sum = g[r.side].reduce((a, x) => a + x.pts, 0);
      if (r.below && sum >= 100) {
        g.winner = r.side; set.won[r.side]++;
        set.games.push({ NS: [], EW: [], winner: null });
        if (chicago) add(r.side, Rubber.vulFor(r.side, vul) ? 500 : 300, 'Game', e.board);
        else if (set.won[r.side] === 2) { add(r.side, set.won[Rubber.other(r.side)] ? 500 : 700, 'Rubber', e.board); set.done = true; }
      } else if (chicago && set.pos === 3 && r.below) add(r.side, 100, 'Part-score on deal 4', e.board);
      if (chicago && ++set.pos === 4) set.done = true;
    }
    if (set.done) { sets.push(set); set = Rubber.newSet(); }
    return { sets, cur: set };
  },
  setVul(set) { const a = set.won.NS > 0, b = set.won.EW > 0; return a && b ? 'Both' : a ? 'NS' : b ? 'EW' : 'None'; },
  // The next deal's dealer and vulnerability. Rubber: the dealer follows the board number (it rotates every deal).
  next(log, opts, board) {
    const { cur } = Rubber.sheet(log, opts);
    if (opts.mode === 'chicago') { const dealer = Rubber.chicagoDealer(cur.pos); return { dealer, vul: Rubber.chicagoVul(cur.pos, dealer), pos: cur.pos }; }
    return { dealer: ['N', 'E', 'S', 'W'][(board - 1) % 4], vul: Rubber.setVul(cur) };
  },
  // An unfinished rubber's bonuses if play stopped now: 300 for a side's only game, 100 for a part-score in the
  // unfinished game (both sides may have one). { NS, EW }.
  unfinished(set) {
    const b = { NS: 0, EW: 0 };
    if (set.done) return b;
    if (set.won.NS && !set.won.EW) b.NS += 300;
    if (set.won.EW && !set.won.NS) b.EW += 300;
    const g = set.games[set.games.length - 1];
    for (const s of ['NS', 'EW']) if (g[s].length) b[s] += 100;
    return b;
  },
};

// ---------------- the practice table's side: log, deal set-up and the Results sheet ----------------
const RubberUI = {
  on: t => !!(t && t.local && t.rubber && !t.daily),
  opts: t => ({ mode: t.rubber.mode, honours: !!t.rubber.honours }),
  // Called from app.js act() after every practice action (and once by the new-practice dialog).
  afterAct(t) {
    if (!RubberUI.on(t)) return;
    const log = t.rubber.log || (t.rubber.log = []);
    // a board just finished: log it
    const h = t.history[t.history.length - 1];
    if (t.phase === 'done' && h && h.board === t.board && !log.some(e => e.board === h.board)) {
      const before = Rubber.sheet(log, RubberUI.opts(t));
      log.push({ board: h.board, dealer: h.dealer, contract: h.contract || null, declTricks: h.declTricks, hon: Rubber.honours(h.hands, h.contract) });
      const after = Rubber.sheet(log, RubberUI.opts(t));
      RubberUI.announce(t, before, after);
    }
    // a new board: deal it with the rubber's (or Chicago's) dealer and vulnerability, before anyone calls
    if (t.phase === 'auction' && !t.auction.length && t.rubber.setUp !== t.board) {
      const n = Rubber.next(log, RubberUI.opts(t), t.board);
      t.dealer = n.dealer; t.vul = n.vul; t.rubber.setUp = t.board;
    }
  },
  announce(t, before, after) {
    const we = s => s === 'NS' ? 'N-S' : 'E-W';
    const set = after.sets.length > before.sets.length ? after.sets[after.sets.length - 1] : after.cur;
    for (const s of ['NS', 'EW']) if (set.won[s] > before.cur.won[s]) sysMsg(t, `${we(s)} make a game`);
    if (after.sets.length > before.sets.length) {
      const n = after.sets.length, d = set.total.NS - set.total.EW, word = t.rubber.mode === 'chicago' ? 'Chicago' : 'Rubber';
      sysMsg(t, `${word} ${n} over: N-S ${set.total.NS}, E-W ${set.total.EW} (${d >= 0 ? 'N-S' : 'E-W'} by ${Math.abs(d)})`);
    }
  },
  // ---- the score sheet (Results) ----
  cell: x => `<span title="${esc(`Board ${x.board}${x.what ? ': ' + x.what : ''}`)}">${x.pts}</span>`,
  setHTML(set, t, label) {
    const rows = [];
    // above the line: the latest entries nearest the line, as on a paper sheet
    const ab = { NS: set.above.filter(x => x.side === 'NS'), EW: set.above.filter(x => x.side === 'EW') };
    const n = Math.max(ab.NS.length, ab.EW.length);
    for (let i = n - 1; i >= 0; i--) rows.push(`<tr><td>${ab.NS[i] ? RubberUI.cell(ab.NS[i]) : ''}</td><td>${ab.EW[i] ? RubberUI.cell(ab.EW[i]) : ''}</td></tr>`);
    if (!n) rows.push('<tr><td>&nbsp;</td><td></td></tr>');
    let below = '';
    set.games.forEach((g, gi) => {
      const m = Math.max(g.NS.length, g.EW.length);
      if (!m && gi === set.games.length - 1 && gi > 0) return;
      const last = gi === set.games.length - 1;
      for (let i = 0; i < Math.max(m, 1); i++) below += `<tr class="${i === Math.max(m, 1) - 1 && !last ? 'rs-game' : ''}"><td>${g.NS[i] ? RubberUI.cell(g.NS[i]) : i === 0 && !m ? '&nbsp;' : ''}</td><td>${g.EW[i] ? RubberUI.cell(g.EW[i]) : ''}</td></tr>`;
    });
    return `<table class="rsheet" aria-label="${esc(label)}"><tr><th>We</th><th>They</th></tr>${rows.join('')}<tr class="rs-line"><td colspan="2"></td></tr>${below}<tr class="rs-tot"><td>${set.total.NS}</td><td>${set.total.EW}</td></tr></table>`;
  },
  sheetHTML(t) {
    if (!RubberUI.on(t)) return '';
    const o = RubberUI.opts(t), { sets, cur } = Rubber.sheet(t.rubber.log || [], o), chicago = o.mode === 'chicago';
    const word = chicago ? 'Chicago' : 'Rubber', num = sets.length + 1;
    const show = cur.deals.length || !sets.length ? cur : sets[sets.length - 1];
    const showN = show === cur ? num : sets.length;
    let head = `${word} ${showN}`;
    if (show === cur) {
      if (chicago) head += `, deal ${Math.min(cur.pos + 1, 4)} of 4`;
      else if (cur.won.NS || cur.won.EW) head += `, games ${cur.won.NS}–${cur.won.EW}`;
    } else head += ', finished';
    let extra = '';
    if (show === cur && !chicago && cur.deals.length) {
      const u = Rubber.unfinished(cur);
      if (u.NS || u.EW) extra = `<p class="note">If stopped now: We ${cur.total.NS + u.NS}, They ${cur.total.EW + u.EW}.</p>`;
    }
    let past = '';
    if (sets.length) {
      let ns = 0, ew = 0;
      past = `<table class="reslist"><tr><th>${word}</th><th class="num">We</th><th class="num">They</th></tr>${sets.map((s, i) => { ns += s.total.NS; ew += s.total.EW; const d = s.total.NS - s.total.EW; return `<tr><td>${i + 1}</td><td class="num">${d > 0 ? '+' + d : ''}</td><td class="num">${d < 0 ? '+' + -d : ''}</td></tr>`; }).join('')}</table><p class="note">Over ${sets.length} finished: ${ns - ew >= 0 ? 'We' : 'They'} +${Math.abs(ns - ew)}.</p>`;
    }
    return `<div class="rubber"><p class="rs-h">${head}</p>${RubberUI.setHTML(show, t, head)}${extra}${past}</div>`;
  },
};

if (typeof module !== 'undefined') module.exports = { Rubber };
