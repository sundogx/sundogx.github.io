// ======================= Personal history and statistics (feature: stats) =======================
// Every finished board you sat at (practice or online) is kept in this browser's IndexedDB, newest 2,000.
// Options > History and statistics lists them with filters, shows your stats, and opens any board in the
// usual hand record. Scores are from your side's point of view. Loaded before app.js; uses its helpers at run time.

const Stats = {
  MAX: 2000,
  list: [], // all saved boards, oldest first
  keys: new Set(),
  ready: null,
  db: null,
  filter: { date: 'all', role: 'all' },
};

Stats.open = function () {
  if (Stats.ready) return Stats.ready;
  Stats.ready = new Promise(res => {
    let rq;
    try { rq = indexedDB.open('bridge-history', 1); } catch (e) { res(); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('boards', { keyPath: 'id' });
    rq.onerror = () => res();
    rq.onsuccess = () => {
      Stats.db = rq.result;
      const all = Stats.db.transaction('boards').objectStore('boards').getAll();
      all.onsuccess = () => { Stats.list = all.result.sort((a, b) => a.date - b.date); Stats.list.forEach(r => Stats.keys.add(r.id)); res(); };
      all.onerror = () => res();
    };
  });
  return Stats.ready;
};
Stats.store = function (fn) { if (!Stats.db) return; try { fn(Stats.db.transaction('boards', 'readwrite').objectStore('boards')); } catch (e) { console.error(e); } };
Stats.put = r => Stats.store(s => s.put(r));

const statsSide = seat => seat === 'N' || seat === 'S' ? 'NS' : 'EW';
const statsMine = (r, ns) => statsSide(r.seat) === 'NS' ? ns : -ns; // a N-S score from your side
function statsRole(r) {
  const c = r.h.contract; if (!c) return 'passed';
  if (c.declarer === r.seat) return 'declarer';
  if (partnerOf(c.declarer) === r.seat) return 'dummy';
  return 'defender';
}
const statsMadeIt = h => h.contract && h.declTricks >= h.contract.level + 6;

// called from app.js render(): saves the board that just ended, once
Stats.note = function (t) {
  if (!t || t.phase !== 'done' || !t.history.length) return;
  const h = t.history[t.history.length - 1];
  const seat = h.players ? SEATS.find(s => h.players[s] && h.players[s].id === me.id) : mySeat(t);
  if (!seat || !h.hands || !SEATS.every(s => h.hands[s].every(c => c[0] !== '?'))) return;
  const id = `${t.local ? 'p' : 'o'}:${t.id || ''}:${h.board}:${h.hands.N.join('')}`;
  if (Stats.keys.has(id)) return;
  Stats.keys.add(id);
  const r = { id, date: Date.now(), seat, mode: t.local ? 'practice' : t.match ? 'match' : 'online', table: t.name || '', h: structuredClone(h) };
  r.role = statsRole(r);
  r.score = statsMine(r, h.scoreNS);
  if (h.other) r.robotImps = toImps(r.score - statsMine(r, h.other.scoreNS));
  Stats.fillPar(r);
  Stats.open().then(() => {
    Stats.list.push(r); Stats.put(r);
    while (Stats.list.length > Stats.MAX) { const old = Stats.list.shift(); Stats.keys.delete(old.id); Stats.store(s => s.delete(old.id)); }
  });
};
// IMPs against par once the double-dummy table is in (it may come in later; the History view asks again)
Stats.fillPar = function (r) {
  if (r.parImps !== undefined) return false;
  const par = typeof parFor === 'function' ? parFor(r.h) : null;
  if (!par) return false;
  r.parImps = toImps(r.score - statsMine(r, par.scoreNS));
  return true;
};

const STATS_DAY = 864e5;
function statsFiltered() {
  const f = Stats.filter, now = Date.now();
  const days = { today: 1, week: 7, month: 30 }[f.date];
  return Stats.list.filter(r => (!days || (f.date === 'today' ? new Date(r.date).toDateString() === new Date().toDateString() : now - r.date < days * STATS_DAY))
    && (f.role === 'all' || r.role === f.role));
}

function statsSummaryHTML(rs) {
  const sgn = v => (v > 0 ? '+' : '') + v;
  const avg = k => { const v = rs.filter(r => r[k] !== undefined); return v.length ? `${sgn(Math.round(v.reduce((a, r) => a + r[k], 0) / v.length * 100) / 100)} <span class="note">(${v.length})</span>` : '–'; };
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}% <span class="note">(${a} of ${b})</span>` : '–';
  const decl = rs.filter(r => r.role === 'declarer'), def = rs.filter(r => r.role === 'defender');
  const levels = [1, 2, 3, 4, 5, 6, 7].map(l => { const d = decl.filter(r => r.h.contract.level === l); return d.length ? `${l}: ${d.filter(r => statsMadeIt(r.h)).length}/${d.length}` : ''; }).filter(Boolean).join(', ');
  const dbl = rs.filter(r => r.h.contract && r.h.contract.doubled && r.role !== 'passed');
  const dblMine = dbl.filter(r => r.role !== 'defender'), dblTheirs = dbl.filter(r => r.role === 'defender');
  const dblText = dbl.length ? `${dblMine.length ? `your side declared ${dblMine.length} (${dblMine.filter(r => statsMadeIt(r.h)).length} made)` : ''}${dblMine.length && dblTheirs.length ? ', ' : ''}${dblTheirs.length ? `you defended ${dblTheirs.length} (${dblTheirs.filter(r => !statsMadeIt(r.h)).length} set)` : ''}` : '–';
  return `<table class="reslist stats"><tr><th scope="row">Boards played</th><td>${rs.length}</td></tr>
    <tr><th scope="row">Average IMPs against par</th><td>${avg('parImps')}</td></tr>
    <tr><th scope="row">Average IMPs against the robot table</th><td>${avg('robotImps')}</td></tr>
    <tr><th scope="row">Contracts made as declarer</th><td>${pct(decl.filter(r => statsMadeIt(r.h)).length, decl.length)}</td></tr>
    <tr><th scope="row">Contracts set on defence</th><td>${pct(def.filter(r => !statsMadeIt(r.h)).length, def.length)}</td></tr>
    <tr><th scope="row">Made by level, as declarer</th><td>${levels || '–'}</td></tr>
    <tr><th scope="row">Doubled contracts</th><td>${dblText}</td></tr></table>${statsTrendSVG(rs)}`;
}
// a running total of IMPs over the last 50 boards (against the robot table, else par), drawn as one thin line
function statsTrendSVG(rs) {
  const v = rs.slice(-50).map(r => r.robotImps !== undefined ? r.robotImps : r.parImps).filter(x => x !== undefined);
  if (v.length < 2) return '';
  let s = 0; const cum = [0, ...v.map(x => (s += x))];
  const W = 300, H = 48, lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = hi - lo || 1;
  const x = i => (i / (cum.length - 1) * W).toFixed(1), y = c => (H - 2 - (c - lo) / span * (H - 4)).toFixed(1);
  return `<div class="trend"><span class="note">Last ${v.length} boards, running IMPs: ${s > 0 ? '+' : ''}${s}</span>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Running IMPs over the last ${v.length} boards, ending at ${s}">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/><polyline fill="none" points="${cum.map((c, i) => x(i) + ',' + y(c)).join(' ')}"/></svg></div>`;
}

function statsRowsHTML(rs) {
  const roleWord = { declarer: 'Declarer', dummy: 'Dummy', defender: 'Defence', passed: '' };
  const fmt = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const imp = r => { const v = r.robotImps !== undefined ? r.robotImps : r.parImps; return v === undefined ? '' : (v > 0 ? '+' : '') + v; };
  const shown = rs.slice(-300).reverse();
  return `<table class="reslist"><tr><th>Date</th><th>Bd</th><th>Contract</th><th>You</th><th class="num">Score</th><th class="num">IMPs</th></tr>
    ${shown.map(r => `<tr class="click" data-histrec="${esc(r.id)}" tabindex="0"><td>${fmt(r.date)}</td><td>${r.h.board}</td><td>${cShort(r.h.contract)}${r.h.contract ? ' ' + resultText(r.h.contract, r.h.declTricks) : ''}</td><td>${roleWord[r.role]}</td><td class="num">${r.score}</td><td class="num">${imp(r)}</td></tr>`).join('')}</table>
    ${rs.length > shown.length ? `<p class="note">Showing the newest ${shown.length} of ${rs.length}.</p>` : ''}`;
}

Stats.show = async function () {
  await Stats.open();
  for (const r of Stats.list) if (r.parImps === undefined) { if (Stats.fillPar(r)) Stats.put(r); else if (typeof requestDD === 'function') requestDD(r.h.hands, false); }
  const rs = statsFiltered(), f = Stats.filter;
  const sel = (k, opts) => `<select data-histf="${k}">${opts.map(([v, l]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const m = modal(`<h3>History and statistics</h3>
    <div class="row" style="margin-bottom:10px">${sel('date', [['all', 'All dates'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']])}${sel('role', [['all', 'All boards'], ['declarer', 'Declaring'], ['defender', 'Defending'], ['dummy', 'Dummy']])}</div>
    ${Stats.list.length ? redSym(statsSummaryHTML(rs) + (rs.length ? statsRowsHTML(rs) : '<p class="empty">No boards match.</p>')) : '<p class="empty">Boards you finish appear here.</p>'}
    <p class="note">Kept in this browser only, newest ${Stats.MAX}. IMPs are against the robot table in practice, against par online.</p>
    <div class="row"><button class="btn small" id="histExport" ${Stats.list.length ? '' : 'disabled'}>Export</button><button class="btn small" id="histClear" ${Stats.list.length ? '' : 'disabled'}>Clear all</button></div>`);
  m.querySelectorAll('[data-histf]').forEach(s => s.addEventListener('change', () => { Stats.filter[s.dataset.histf] = s.value; Stats.show().then(() => { const n = $('modalRoot').querySelector(`[data-histf="${s.dataset.histf}"]`); if (n) n.focus(); }); })); /* feature: a11y */
  $('histExport').addEventListener('click', () => downloadText(`bridge-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(Stats.list), 'application/json'));
  $('histClear').addEventListener('click', e => {
    const b = e.target;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Clear all boards?'; return; }
    Stats.list = []; Stats.keys.clear(); Stats.store(s => s.clear()); Stats.show();
  });
};

// open a saved board in the usual hand record: the record reads the global table T, so a stand-in table holds
// just this board while it is drawn (and while its analysis comes in)
Stats.record = function (id) {
  const r = Stats.list.find(x => x.id === id); if (!r) return;
  const fake = { id: 'history', name: r.table || 'History', local: r.mode === 'practice', phase: 'history', history: [r.h], auction: [], chat: [], seats: Object.fromEntries(SEATS.map(s => [s, s === r.seat ? { kind: 'human', id: me.id, name: me.name || 'You' } : { kind: 'robot' }])) };
  const real = T;
  T = fake; try { showRecord(0); } finally { T = real; }
  openRecord = null; // app.js redraws the open record only for the real table's boards
  const box = $('modalRoot').firstChild; if (!box) return;
  box.dataset.hist = id;
  // the record's analysis and play review fill in as they finish; redraw them here (app.js only redraws for T's boards)
  let last = '';
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const T0 = T; T = fake;
    try {
      const dd = ddHTML(r.h), pl = $('playBox') ? playTableHTML(r.h) : '';
      if (dd + pl !== last) { last = dd + pl; if ($('ddBox')) $('ddBox').innerHTML = dd; if ($('playBox')) $('playBox').innerHTML = pl; if (replayDraw) replayDraw(); }
      if (Stats.fillPar(r)) Stats.put(r);
    } catch (e) { clearInterval(timer); } finally { T = T0; }
  }, 800);
};

document.addEventListener('click', e => {
  if (e.target.closest('[data-history]')) { Stats.show(); return; }
  const tr = e.target.closest('[data-histrec]'); if (tr) Stats.record(tr.dataset.histrec);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.histrec) { e.preventDefault(); Stats.record(e.target.dataset.histrec); }
});
Stats.open();
