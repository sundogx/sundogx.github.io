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
  filter: { date: 'all', role: 'all', flag: false },
  picked: null, // the boards ticked for export (a Set of ids), or null when not selecting (feature: history)
};

Stats.open = function () {
  if (Stats.ready) return Stats.ready;
  Stats.ready = new Promise(res => {
    let rq;
    try { rq = indexedDB.open('bridge-history', 1); } catch (e) { res(); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('boards', { keyPath: 'id' });
    rq.onerror = () => res();
    rq.onblocked = () => res();
    rq.onsuccess = () => {
      Stats.db = rq.result;
      Stats.db.onversionchange = () => { Stats.db.close(); Stats.db = null; };
      let all;
      try { all = Stats.db.transaction('boards').objectStore('boards').getAll(); } catch (e) { console.error(e); res(); return; }
      all.onsuccess = () => { Stats.list = (all.result || []).sort((a, b) => a.date - b.date); Stats.list.forEach(r => Stats.keys.add(r.id)); res(); };
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
    if (Stats.list.some(x => x.id === id)) return; // already loaded from the database
    Stats.list.push(r); Stats.put(r);
    while (Stats.list.length > Stats.MAX) { const old = Stats.list.shift(); Stats.keys.delete(old.id); Stats.store(s => s.delete(old.id)); }
  });
};
// IMPs against par once the double-dummy table is in (it may come in later; the History view asks again)
// (feature: history) also keeps the par contract and the contract's double-dummy tricks with the record, for the leak finder
Stats.fillPar = function (r) {
  if (r.parImps !== undefined && r.par) return false;
  const par = typeof parFor === 'function' ? parFor(r.h) : null;
  if (!par) return false;
  r.parImps = toImps(r.score - statsMine(r, par.scoreNS));
  const en = ddEntry(r.h.hands), c = r.h.contract;
  r.par = { ns: par.scoreNS, c: par.contract || null, ddT: c ? en.table[c.declarer][c.strain] : null };
  return true;
};

const STATS_DAY = 864e5;
function statsFiltered() {
  const f = Stats.filter, now = Date.now();
  const days = { today: 1, week: 7, month: 30 }[f.date];
  return Stats.list.filter(r => (!days || (f.date === 'today' ? new Date(r.date).toDateString() === new Date().toDateString() : now - r.date < days * STATS_DAY))
    && (f.role === 'all' || r.role === f.role) && (!f.flag || r.flag));
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

// the opening lead of a board, or null
const statsLead = h => h.contract && h.tricks && h.tricks[0] && h.tricks[0].cards[0] ? h.tricks[0].cards[0].card : null;
function statsRowsHTML(rs) {
  const roleWord = { declarer: 'Declarer', dummy: 'Dummy', defender: 'Defence', passed: '' };
  const fmt = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const imp = r => { const v = r.robotImps !== undefined ? r.robotImps : r.parImps; return v === undefined ? '' : (v > 0 ? '+' : '') + v; };
  const lead = r => { const c = statsLead(r.h); return c ? `<span class="s-${c[0]}">${SYM[c[0]]}</span>${rankLabel(c[1])}` : ''; };
  const pick = Stats.picked, shown = rs.slice(-300).reverse();
  /* feature: history */ // a star to flag the board, the opening lead, a note under the row, a tick box while selecting
  const star = r => `<button class="hstar" data-histflag="${esc(r.id)}" aria-pressed="${r.flag ? 'true' : 'false'}" aria-label="Flag board ${r.h.board}" title="Flag">${r.flag ? '★' : '☆'}</button>`;
  const tick = r => pick ? `<td><input type="checkbox" data-histpick="${esc(r.id)}" ${pick.has(r.id) ? 'checked' : ''} aria-label="Select board ${r.h.board}"></td>` : '';
  return `<table class="reslist hist"><tr>${pick ? '<th><input type="checkbox" data-histpick="*" aria-label="Select all"></th>' : ''}<th><span class="sr">Flag</span></th><th class="hd">Date</th><th>Bd</th><th>Contract</th><th>Lead</th><th>You</th><th class="num">Score</th><th class="num">IMPs</th></tr>
    ${shown.map(r => `<tr class="click${r.note ? ' hasnote' : ''}" data-histrec="${esc(r.id)}" tabindex="0">${tick(r)}<td>${star(r)}</td><td class="hd">${fmt(r.date)}</td><td>${r.h.board}</td><td>${cShort(r.h.contract)}${r.h.contract ? ' ' + resultText(r.h.contract, r.h.declTricks) : ''}${r.h.aided ? '<span class="aided" title="Played with learning aids (all hands or tricks per card shown)">aided</span>' : '' /* feature: learn */}</td><td>${lead(r)}</td><td>${roleWord[r.role]}</td><td class="num">${r.score}</td><td class="num">${imp(r)}</td></tr>${r.note ? `<tr class="hnote"><td colspan="${pick ? 9 : 8}">${esc(r.note)}</td></tr>` : ''}`).join('')}</table>
    ${rs.length > shown.length ? `<p class="note">Showing the newest ${shown.length} of ${rs.length}.</p>` : ''}`;
}

Stats.show = async function () {
  await Stats.open();
  for (const r of Stats.list) if (r.parImps === undefined || !r.par) { if (Stats.fillPar(r)) Stats.put(r); else if (typeof requestDD === 'function') requestDD(r.h.hands, false); }
  const rs = statsFiltered(), f = Stats.filter;
  const sel = (k, opts) => `<select data-histf="${k}">${opts.map(([v, l]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const has = Stats.list.length, any = rs.length ? '' : 'disabled';
  const m = modal(`<h3>History and statistics</h3>
    <div class="row" style="margin-bottom:10px">${sel('date', [['all', 'All dates'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']])}${sel('role', [['all', 'All boards'], ['declarer', 'Declaring'], ['defender', 'Defending'], ['dummy', 'Dummy']])}<label class="hflagf"><input type="checkbox" data-histflagf="1" ${f.flag ? 'checked' : ''}> Flagged</label>${'' /* feature: history */}</div>
    ${has ? redSym(statsSummaryHTML(rs) + (typeof Leaks !== 'undefined' && rs.length ? `<div id="leakBox">${Leaks.sectionHTML(rs)}</div>` : '') /* feature: history */ + (rs.length ? statsRowsHTML(rs) : '<p class="empty">No boards match.</p>')) : '<p class="empty">Boards you finish appear here.</p>'}
    <p class="note">Kept in this browser only, newest ${Stats.MAX}. IMPs are against the robot table in practice, against par online.</p>
    <div class="row"><button class="btn small" id="histPBN" ${any}>PBN file</button><button class="btn small" id="histPrint" ${any}>Print recap</button><button class="btn small" id="histPick" ${any} aria-pressed="${Stats.picked ? 'true' : 'false'}">${Stats.picked ? 'Done selecting' : 'Select'}</button>${'' /* feature: history */}<button class="btn small" id="histExport" ${has ? '' : 'disabled'}>Export</button><button class="btn small" id="histClear" ${has ? '' : 'disabled'}>Clear all</button></div>
    <p class="note" id="histTarget">${statsTargetText(rs)}</p>`);
  m.querySelectorAll('[data-histf]').forEach(s => s.addEventListener('change', () => { Stats.filter[s.dataset.histf] = s.value; Stats.show().then(() => { const n = $('modalRoot').querySelector(`[data-histf="${s.dataset.histf}"]`); if (n) n.focus(); }); })); /* feature: a11y */
  m.querySelector('[data-histflagf]').addEventListener('change', e => { Stats.filter.flag = e.target.checked; Stats.show().then(() => { const n = $('modalRoot').querySelector('[data-histflagf]'); if (n) n.focus(); }); });
  $('histPBN').addEventListener('click', () => { const t = statsTargets(rs); if (t.length) downloadText(`bridge-boards-${new Date().toISOString().slice(0, 10)}.pbn`, statsPBN(t)); });
  $('histPrint').addEventListener('click', () => { const t = statsTargets(rs); if (t.length) statsPrint(t); });
  $('histPick').addEventListener('click', () => { Stats.picked = Stats.picked ? null : new Set(); Stats.show().then(() => $('histPick') && $('histPick').focus()); });
  m.addEventListener('change', e => { // tick boxes: kept in Stats.picked without redrawing the window
    const id = e.target.dataset && e.target.dataset.histpick; if (!id || !Stats.picked) return;
    const boxes = [...m.querySelectorAll('[data-histpick]:not([data-histpick="*"])')];
    if (id === '*') boxes.forEach(b => { b.checked = e.target.checked; if (b.checked) Stats.picked.add(b.dataset.histpick); else Stats.picked.delete(b.dataset.histpick); });
    else if (e.target.checked) Stats.picked.add(id); else Stats.picked.delete(id);
    $('histTarget').textContent = statsTargetText(rs);
  });
  $('histExport').addEventListener('click', () => downloadText(`bridge-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(Stats.list), 'application/json'));
  $('histClear').addEventListener('click', e => {
    const b = e.target;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Clear all boards?'; return; }
    Stats.list = []; Stats.keys.clear(); Stats.picked = null; Stats.store(s => s.clear()); Stats.show();
  });
  if (typeof Leaks !== 'undefined') Leaks.watch(m, rs); /* feature: history */
};

// ---------- (feature: history) flags, notes, PBN file and printed recap of several boards ----------
// The PBN file and the recap take the ticked boards if any are ticked, else every board the filters show (oldest first).
function statsTargets(rs) { return Stats.picked && Stats.picked.size ? Stats.list.filter(r => Stats.picked.has(r.id)) : rs; }
function statsTargetText(rs) {
  const n = statsTargets(rs).length, ticked = Stats.picked && Stats.picked.size;
  if (!n) return '';
  return `PBN file and Print recap take ${ticked ? `the ${n} ticked board${n > 1 ? 's' : ''}` : n > 1 ? `the ${n} boards shown` : 'this board'}.`;
}
// the stand-in table pbnBoard reads (players' names and the table's name)
const statsTable = r => ({ name: r.table || 'Bridge table', seats: Object.fromEntries(SEATS.map(s => [s, s === r.seat ? { kind: 'human', name: me.name || 'You' } : r.h.players && r.h.players[s] ? r.h.players[s] : { kind: 'robot' }])) });
function statsPBN(rs) {
  const day = d => { d = new Date(d); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
  return '% PBN 2.1\n% EXPORT\n\n' + rs.map(r => {
    let b = pbnBoard(r.h, statsTable(r)).replace(/^\[Date "[^"]*"\]/m, `[Date "${day(r.date)}"]`);
    const c = [r.flag ? 'Flagged' : '', r.note ? r.note.replace(/[{}]/g, '') : ''].filter(Boolean).join('. ');
    if (c) b = b.replace(/^(\[Board [^\n]*\n)/m, `$1{${c}}\n`);
    return b;
  }).join('\n\n') + '\n';
}
// a print-friendly recap: for each board the diagram, the auction, the result and lead, and your note
function statsRecapHTML(rs) {
  const sym = s => `<span class="${s === 'H' || s === 'D' ? 'r' : ''}">${SYM[s]}</span>`;
  const hand = (h, s) => `<b>${SEAT_NAME[s]}</b><br>${SUITS.map(su => sym(su) + ' ' + (h.hands[s].filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => rankLabel(c[1])).join(' ') || '–')).join('<br>')}`;
  const call = c => c === 'P' ? 'Pass' : c === 'X' ? '<span class="r">X</span>' : c === 'XX' ? '<span class="b">XX</span>' : c[0] + (c[1] === 'N' ? 'NT' : sym(c[1]));
  const contract = c => `${c.level}${c.strain === 'N' ? 'NT' : sym(c.strain)}${c.doubled === 2 ? 'XX' : c.doubled ? 'X' : ''} by ${SEAT_NAME[c.declarer]}`;
  const sg = v => (v > 0 ? '+' : '') + v;
  const board = r => {
    const h = r.h, order = ['W', 'N', 'E', 'S'], cells = [];
    for (let i = 0; i < order.indexOf(h.dealer); i++) cells.push('');
    (h.auction || []).forEach(a => cells.push(call(a.call) + (a.alert ? '*' : '')));
    const rows = []; for (let i = 0; i < cells.length; i += 4) rows.push('<tr>' + [0, 1, 2, 3].map(j => `<td>${cells[i + j] ?? ''}</td>`).join('') + '</tr>');
    const ld = statsLead(h);
    const res = h.contract ? `${contract(h.contract)}, ${resultText(h.contract, h.declTricks)}. N-S ${sg(h.scoreNS)}.` : 'Passed out.';
    const par = r.par ? ` Par N-S ${sg(r.par.ns)}${r.parImps ? `, ${sg(r.parImps)} IMPs to you` : ''}.` : '';
    return `<section><h2>${r.flag ? '★ ' : ''}Board ${h.board} <small>${esc(new Date(r.date).toLocaleDateString())}${r.table ? ' · ' + esc(r.table) : ''} · you ${SEAT_NAME[r.seat]}</small></h2>
<p class="m">Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
<div class="wrap"><table class="diag"><tr><td></td><td>${hand(h, 'N')}</td><td></td></tr><tr><td>${hand(h, 'W')}</td><td></td><td>${hand(h, 'E')}</td></tr><tr><td></td><td>${hand(h, 'S')}</td><td></td></tr></table>
<div><table class="auc"><tr>${order.map(s => `<th>${s}</th>`).join('')}</tr>${rows.join('')}</table>
<p>${res}${par}${ld ? `<br>Lead ${sym(ld[0])}${rankLabel(ld[1])} by ${SEAT_NAME[h.tricks[0].cards[0].seat]}.` : ''}</p>${r.note ? `<p class="nt">${esc(r.note)}</p>` : ''}</div></div></section>`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bridge boards</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000;margin:18px}
h2{font-size:13pt;margin:0 0 2px}h2 small{font-weight:normal;font-size:10pt;color:#444}.m{margin:0 0 4px;font-size:10pt}
section{break-inside:avoid;page-break-inside:avoid;border-top:1px solid #999;padding:10px 0}
.wrap{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
table{border-collapse:collapse}.diag td{vertical-align:top;padding:3px 12px;line-height:1.35}
.auc th,.auc td{border:1px solid #bbb;padding:2px 8px;text-align:center;min-width:34px}
.r{color:#c62828}.b{color:#1f5fae}.nt{font-style:italic}p{margin:6px 0}
</style></head><body>${rs.map(board).join('')}</body></html>`;
}
function statsPrint(rs) {
  const html = statsRecapHTML(rs);
  let w = null; try { w = window.open('', '_blank'); } catch (e) { }
  if (w) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 300); return; }
  downloadText(`bridge-boards-${new Date().toISOString().slice(0, 10)}.html`, html, 'text/html'); // pop-ups blocked: save it to print later
}
Stats.setFlag = function (id) {
  const r = Stats.list.find(x => x.id === id); if (!r) return;
  if (r.flag) delete r.flag; else r.flag = true;
  Stats.put(r);
  document.querySelectorAll(`[data-histflag="${CSS.escape(id)}"]`).forEach(b => { b.textContent = r.flag ? '★' : '☆'; b.setAttribute('aria-pressed', r.flag ? 'true' : 'false'); });
};
Stats.setNote = function (id, text) {
  const r = Stats.list.find(x => x.id === id); if (!r) return;
  text = String(text || '').trim().slice(0, 200);
  if (text === (r.note || '')) return;
  if (text) r.note = text; else delete r.note;
  Stats.put(r);
};
// the flag, the note and a way back to the list, at the top of a saved board's hand record
function statsRecordBar(box, r) {
  const bar = document.createElement('div');
  bar.className = 'histbar';
  bar.innerHTML = `<button class="btn small" data-histback="1">‹ History</button><button class="hstar" data-histflag="${esc(r.id)}" aria-pressed="${r.flag ? 'true' : 'false'}" aria-label="Flag this board" title="Flag">${r.flag ? '★' : '☆'}</button><input type="text" id="histNote" maxlength="200" placeholder="Note" aria-label="Note on this board" value="${esc(r.note || '')}">`;
  const top = box.querySelector('.mtop'); box.insertBefore(bar, top ? top.nextSibling : box.firstChild);
  const inp = bar.querySelector('#histNote');
  let timer = 0;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => Stats.setNote(r.id, inp.value), 400); });
  inp.addEventListener('change', () => { clearTimeout(timer); Stats.setNote(r.id, inp.value); });
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); }); // typing here isn't a shortcut
}

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
  statsRecordBar(box.querySelector('.box'), r); /* feature: history */
  // the record's analysis and play review fill in as they finish; redraw them here (app.js only redraws for T's boards)
  let last = '';
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const T0 = T; T = fake;
    try {
      const dd = ddHTML(r.h), pl = $('playBox') ? playTableHTML(r.h) : '';
      if (dd + pl !== last) { last = dd + pl; if ($('ddBox')) $('ddBox').innerHTML = dd; if ($('playBox')) $('playBox').innerHTML = pl; if (replayDraw) replayDraw(); }
      if (Stats.fillPar(r)) Stats.put(r);
      if (typeof Leaks !== 'undefined' && Leaks.absorb(r)) Stats.put(r); /* feature: history */
    } catch (e) { clearInterval(timer); } finally { T = T0; }
  }, 800);
};

document.addEventListener('click', e => {
  if (e.target.closest('[data-history]') || e.target.closest('[data-histback]')) { Stats.show(); return; }
  const fl = e.target.closest('[data-histflag]'); if (fl) { Stats.setFlag(fl.dataset.histflag); return; } /* feature: history */
  if (e.target.closest('[data-histpick]')) return;
  const tr = e.target.closest('[data-histrec]'); if (tr) Stats.record(tr.dataset.histrec);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.histrec && !e.target.closest('input')) { e.preventDefault(); Stats.record(e.target.dataset.histrec); }
});
Stats.open();
