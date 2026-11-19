// ======================= Leak finder (feature: history) =======================
// A section of the History window (js/stats.js) that adds up, over your last N boards, the IMPs you lost by kind:
// - the contract, against par: your contract played double dummy is compared with par, and a loss goes to missed
//   game, missed slam, overbid game or slam, part-score battles, doubled contracts, or other (strain, sacrifices);
// - the play: the tricks you gave away double dummy (js/analysis.js playReview, read-only) as declarer, on defence
//   and with your opening lead, each turned into the IMPs they cost on that board.
// The double-dummy tables and play reviews are worked out lazily, one board at a time, only while the History window
// is open or no table is open (never while you play, so the robots aren't slowed), and the play results are kept
// in the record (r.rv), so each board is checked once. Loaded after stats.js, before app.js.

const Leaks = {
  N: 50,
  V: 1, // version of r.rv
  CATS: [
    ['missedGame', 'Missed game'], ['missedSlam', 'Missed slam'], ['overbid', 'Overbid game or slam'],
    ['partscore', 'Part-score battles'], ['doubled', 'Doubled contracts'], ['other', 'Other contracts (strain, sacrifices)'],
    ['declarer', 'Declarer play'], ['defence', 'Defence'], ['lead', 'Opening lead'],
  ],
  scope: null, box: null, timer: 0, cur: null, sig: '', openUI: true,
};

const leakGame = c => !!c && (c.level >= 5 || (c.level === 4 && c.strain !== 'C' && c.strain !== 'D') || (c.level === 3 && c.strain === 'N'));
const leakMine = (r, c) => !!c && statsSide(c.declarer) === statsSide(r.seat);

// the contract's share: { cat, imps } (imps > 0 lost against par), or null (no loss, or no double-dummy table yet)
Leaks.bid = function (r) {
  const p = r.par; if (!p) return null;
  const h = r.h, C = h.contract, P = p.c;
  const ddScore = C ? statsMine(r, scoreNS(C, p.ddT, h.vul)) : 0;
  const imps = -toImps(ddScore - statsMine(r, p.ns));
  if (imps <= 0) return null;
  const pMakes = leakMine(r, P) && !P.doubled; // par is your side's making contract (not a sacrifice)
  let cat;
  if (C && C.doubled) cat = 'doubled';
  else if (pMakes && P.level >= 6 && !(leakMine(r, C) && C.level >= 6)) cat = 'missedSlam';
  else if (pMakes && leakGame(P) && !(leakMine(r, C) && leakGame(C))) cat = 'missedGame';
  else if (leakMine(r, C) && leakGame(C) && p.ddT < C.level + 6) cat = 'overbid';
  else if (!leakGame(P) && !leakGame(C)) cat = 'partscore';
  else cat = 'other';
  return { cat, imps };
};
// the play's share, from the stored review: { declarer, defence, lead } in IMPs (0 when nothing was given away)
Leaks.play = function (r) {
  const v = r.rv, c = r.h.contract; if (!v || !c) return null;
  const sc = t => scoreContract(c, Math.max(0, Math.min(13, t)), r.h.vul), t = r.h.declTricks;
  return {
    declarer: v.decl ? toImps(sc(t + v.decl) - sc(t)) : 0, // the tricks you'd have made
    defence: v.def ? toImps(sc(t) - sc(t - v.def)) : 0, // the tricks declarer wouldn't have made
    lead: v.lead ? toImps(sc(t) - sc(t - v.lead)) : 0,
  };
};
// boards whose play you're checked on: you declared or defended, and cards were played
const leakNeedsPlay = r => (r.role === 'declarer' || r.role === 'defender') && r.h.tricks && r.h.tricks.length > 0;
// Store the finished play review in the record (true when something new is stored). Never starts a review.
Leaks.absorb = function (r) {
  if (!leakNeedsPlay(r) || (r.rv && r.rv.v === Leaks.V) || typeof PlayDD === 'undefined') return false;
  const en = PlayDD.cache.get(reviewKey(r.h));
  if (!en || !en.done) return false;
  const rv = { v: Leaks.V, decl: 0, def: 0, lead: 0 };
  reviewFlat(r.h).forEach((pc, i) => {
    const x = en.res[i]; if (!x || !(x.loss > 0)) return;
    if (r.role === 'declarer' && sameSide(pc.seat, r.seat)) rv.decl += x.loss; // your cards and dummy's
    else if (r.role === 'defender' && pc.seat === r.seat) { if (i === 0) rv.lead += x.loss; else rv.def += x.loss; }
  });
  r.rv = rv;
  return true;
};

// the boards in view: the last N of the History window's filtered boards (or of all boards)
const leakBoards = () => { const rs = Leaks.scope || Stats.list; return Leaks.N ? rs.slice(-Leaks.N) : rs; };

Leaks.sectionHTML = function (rs) {
  if (rs) Leaks.scope = rs;
  const bs = leakBoards(), sum = {};
  Leaks.CATS.forEach(([k]) => { sum[k] = { imps: 0, list: [] }; });
  let noDD = 0, noPlay = 0;
  for (const r of bs) {
    const b = Leaks.bid(r);
    if (!r.par) noDD++;
    else if (b) { sum[b.cat].imps += b.imps; sum[b.cat].list.push([r, b.imps]); }
    if (leakNeedsPlay(r) && !(r.rv && r.rv.v === Leaks.V)) { noPlay++; continue; }
    const p = Leaks.play(r);
    if (p) for (const k of ['declarer', 'defence', 'lead']) if (p[k] > 0) { sum[k].imps += p[k]; sum[k].list.push([r, p[k]]); }
  }
  const links = list => {
    const top = list.slice().sort((a, b) => b[1] - a[1] || b[0].date - a[0].date), shown = top.slice(0, 8);
    return shown.map(([r, im]) => `<button class="lnk" data-histrec="${esc(r.id)}" title="${esc(new Date(r.date).toLocaleDateString())}">${r.h.board} <span class="note">−${im}</span></button>`).join(' ') + (top.length > shown.length ? ` <span class="note">and ${top.length - shown.length} more</span>` : '');
  };
  const rows = Leaks.CATS.filter(([k]) => sum[k].imps > 0).sort((a, b) => sum[b[0]].imps - sum[a[0]].imps)
    .map(([k, label]) => `<tr><th scope="row">${label}</th><td class="num">−${sum[k].imps}</td><td>${links(sum[k].list)}</td></tr>`).join('');
  const nSel = `<select data-leakn="1" aria-label="Boards to look at">${[[20, 'Last 20'], [50, 'Last 50'], [100, 'Last 100'], [0, 'All']].map(([v, l]) => `<option value="${v}" ${Leaks.N === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const wait = [noDD ? `${noDD} board${noDD > 1 ? 's' : ''} waiting for double-dummy analysis` : '', noPlay ? `checking the play of ${noPlay} board${noPlay > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
  return `<details class="leaks" ${Leaks.openUI ? 'open' : ''}><summary>Where the IMPs went</summary>
    <div class="row" style="margin:6px 0">${nSel}<span class="note">${bs.length} board${bs.length === 1 ? '' : 's'}</span></div>
    ${rows ? `<table class="reslist leaktab"><tr><th>Kind</th><th class="num">IMPs</th><th>Boards</th></tr>${rows}</table>` : `<p class="note">${wait ? 'Nothing lost so far.' : 'No IMPs lost against par.'}</p>`}
    ${wait ? `<p class="note">Still ${wait}…</p>` : ''}
    <p class="note">Contracts: your contract played double dummy against par. Play: what the tricks you gave away double dummy cost.</p></details>`;
};

// one step of the background work: finish the board being checked, or start the next one
Leaks.step = function () {
  const open = Leaks.box && Leaks.box.isConnected;
  if (!open) Leaks.box = null;
  const idle = !T || (T.phase !== 'auction' && T.phase !== 'play');
  if (document.hidden || (!open && !idle) || (typeof ddRobotBusy === 'function' && ddRobotBusy())) return;
  let changed = false;
  if (Leaks.cur) {
    const r = Leaks.cur, en = typeof playReview === 'function' ? playReview(r.h) : null;
    if (!en) { Leaks.cur = null; return; } // no solver here
    if (!en.done) return;
    if (Leaks.absorb(r)) { Stats.put(r); changed = true; }
    Leaks.cur = null;
  }
  const bs = leakBoards();
  for (const r of bs) if (!r.par) { if (Stats.fillPar(r)) { Stats.put(r); changed = true; } else if (open && typeof requestDD === 'function') requestDD(r.h.hands, false); }
  if (!Leaks.cur) {
    // newest first; a board whose review is already cached is stored at once
    for (let i = bs.length - 1; i >= 0; i--) {
      const r = bs[i];
      if (!leakNeedsPlay(r) || (r.rv && r.rv.v === Leaks.V)) continue;
      if (Leaks.absorb(r)) { Stats.put(r); changed = true; continue; }
      if (typeof PlayDD === 'undefined' || PlayDD.failed) break;
      Leaks.cur = r; playReview(r.h); break;
    }
  }
  if (changed && open) Leaks.redraw();
};
Leaks.redraw = function () {
  const el = document.getElementById('leakBox'); if (!el) return;
  const html = redSym(Leaks.sectionHTML());
  if (html !== Leaks.sig) { Leaks.sig = html; el.innerHTML = html; }
};
// called by Stats.show with the window and its filtered boards
Leaks.watch = function (m, rs) {
  Leaks.box = m; Leaks.scope = rs; Leaks.sig = '';
  const el = document.getElementById('leakBox');
  if (el) el.addEventListener('toggle', e => { if (e.target.matches('details.leaks')) Leaks.openUI = e.target.open; }, true);
  if (!Leaks.timer) Leaks.timer = setInterval(() => { try { Leaks.step(); } catch (e) { console.error(e); } }, 1000);
};
document.addEventListener('change', e => {
  if (!e.target.dataset || !e.target.dataset.leakn) return;
  Leaks.N = +e.target.value; Leaks.redraw();
  const s = document.querySelector('[data-leakn]'); if (s) s.focus();
});
// at home, the boards you haven't looked at are checked too (no table open: nothing to slow down)
if (typeof Stats !== 'undefined') Stats.open().then(() => { if (!Leaks.timer) Leaks.timer = setInterval(() => { try { Leaks.step(); } catch (e) { console.error(e); } }, 1500); });
