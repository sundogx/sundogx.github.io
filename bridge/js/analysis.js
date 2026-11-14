// ======================= Double-dummy analysis, par and hand-record export =======================
// The solver runs in background workers (js/dds-worker.js); results are cached by deal.
// Loaded before app.js; uses its helpers at run time.

const DD = { cache: new Map(), queue: [], workers: [], failed: false };
const handsKey = h => SEATS.map(s => h[s].join('')).join('|');
function ddEntry(h) { return DD.cache.get(handsKey(h)); }
// Queue one job per strain; the contract's strain (if known) goes first.
function requestDD(h, urgent, firstStrain) {
  if (DD.failed && Date.now() - (DD.failedAt || 0) > 120e3) ddRetry();
  if (!h || DD.failed) return;
  const k = handsKey(h);
  let en = DD.cache.get(k);
  if (!en) {
    en = { table: { N: {}, E: {}, S: {}, W: {} }, done: false, strainsDone: 0, queued: true };
    DD.cache.set(k, en);
    const jobs = ['N', 'S', 'H', 'D', 'C'].map(st => ({ k, h, st }));
    if (urgent) DD.queue.unshift(...jobs); else DD.queue.push(...jobs);
  }
  if (firstStrain) {
    const i = DD.queue.findIndex(j => j.k === k && j.st === firstStrain);
    if (i > 0) DD.queue.unshift(DD.queue.splice(i, 1)[0]);
  }
  if (urgent) { // move this board's remaining jobs ahead of other boards
    const mine = DD.queue.filter(j => j.k === k), rest = DD.queue.filter(j => j.k !== k);
    DD.queue = mine.concat(rest);
  }
  pumpDD();
}
function makeWorker() {
  const w = new Worker('js/dds-worker.js');
  w.job = null;
  w.onmessage = e => {
    const m = e.data, en = DD.cache.get(m.k);
    if (m.done) { w.job = null; if (en) { en.strainsDone++; if (en.strainsDone === 5) { en.done = true; ddVersion++; } } pumpDD(); }
    else if (en) en.table[m.decl][m.st] = m.v;
    if (en) onDDUpdate(m.k);
  };
  w.onerror = () => { // drop this worker, retry its job once on a new one, and give up only if that fails too
    const j = w.job; w.job = null;
    try { w.terminate(); } catch (e) { }
    DD.workers = DD.workers.filter(x => x !== w);
    if (j && !j.retried) { j.retried = true; DD.queue.unshift(j); pumpDD(); } else ddFail();
  };
  return w;
}
function ddFail() { // give up for now; try again when the connection returns or after two minutes
  DD.failed = true; DD.failedAt = Date.now();
  for (const [k, en] of DD.cache) if (!en.done) DD.cache.delete(k); // so they are queued afresh later
  DD.queue = [];
}
function ddRetry() { if (DD.failed) { DD.failed = false; DD.workers = []; if (T) renderSide(true); } }
window.addEventListener('online', ddRetry);
function pumpDD() {
  if (DD.failed) return;
  if (!DD.workers.length) {
    try {
      const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < n; i++) DD.workers.push(makeWorker());
    } catch (err) { ddFail(); return; }
  }
  for (const w of DD.workers) {
    if (w.job || !DD.queue.length) continue;
    w.job = DD.queue.shift();
    w.postMessage(w.job);
  }
}
let openRecord = null; // index of hand record currently shown
let ddFrame = 0;
const ddKeys = new Set();
function onDDUpdate(k) { // many messages arrive per board; redraw at most once per frame
  ddKeys.add(k);
  if (ddFrame) return;
  ddFrame = requestAnimationFrame(() => { ddFrame = 0; const ks = [...ddKeys]; ddKeys.clear(); ks.forEach(redrawDD); });
}
function redrawDD(k) {
  if (!T) return;
  if (openRecord !== null && T.history[openRecord] && handsKey(T.history[openRecord].hands) === k) {
    const el = $('ddBox'); if (el) el.innerHTML = ddHTML(T.history[openRecord]);
  }
  if (T.history.some(h => handsKey(h.hands) === k)) renderSide();
}
function parFor(h) {
  const en = ddEntry(h.hands);
  if (!en || !en.done) return null;
  return parScore(en.table, h.vul);
}
function ddHTML(h) {
  if (DD.failed) return '<p class="note">Double-dummy analysis isn\'t available in this browser.</p>';
  const en = ddEntry(h.hands);
  if (!en) { requestDD(h.hands, true); return '<p class="note">Starting analysis…</p>'; }
  if (!en.done && openRecord !== null && T.history[openRecord] === h) requestDD(h.hands, true);
  const cols = ['N', 'S', 'H', 'D', 'C'];
  const rows = ['N', 'S', 'E', 'W'].map(d => `<tr><th>${d}</th>${cols.map(c => { const v = en.table[d][c]; return `<td class="${v >= 7 ? 'mk' : ''}">${v === undefined ? '…' : v >= 7 ? v - 6 : '–'}</td>`; }).join('')}</tr>`).join('');
  const par = en.done ? parScore(en.table, h.vul) : null;
  let played = '';
  if (en.done && h.contract) {
    const dt = en.table[h.contract.declarer][h.contract.strain];
    played = `<p class="note">Double dummy, ${contractText(h.contract)} takes ${dt} tricks (${resultText(h.contract, dt)}). At the table: ${h.declTricks}.</p>`;
  }
  return `<table class="ddt"><tr><th></th>${cols.map(c => `<th class="${isRed(c) ? 'red' : ''}">${SYM[c]}</th>`).join('')}</tr>${rows}</table>
    <p class="note">Numbers are the level each declarer makes with perfect play by everyone; a dash means not even one level.${en.done ? '' : ' Still analysing…'}</p>
    ${par ? `<p><b>Par:</b> ${par.text}, N-S ${par.scoreNS > 0 ? '+' : ''}${par.scoreNS}</p>` : ''}${played}`;
}

// ---------- PBN export ----------
function pbnBoard(h, t) {
  const pbnHand = cards => ['S', 'H', 'D', 'C'].map(su => cards.filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => c[1]).join('')).join('.');
  const order = [h.dealer, nextSeat(h.dealer), partnerOf(h.dealer), nextSeat(partnerOf(h.dealer))];
  const vul = { None: 'None', NS: 'NS', EW: 'EW', Both: 'All' }[h.vul];
  const d = new Date();
  const name = s => { const o = t.seats[s]; return o ? (o.kind === 'robot' ? 'Robot' : o.name) : ''; };
  const L = [];
  L.push('[Event "' + (t.name || 'Bridge table').replace(/"/g, "'") + '"]', `[Date "${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}"]`, `[Board "${h.board}"]`);
  SEATS.forEach(s => L.push(`[${SEAT_NAME[s]} "${name(s).replace(/"/g, "'")}"]`));
  L.push(`[Dealer "${h.dealer}"]`, `[Vulnerable "${vul}"]`, `[Deal "${h.dealer}:${order.map(s => pbnHand(h.hands[s])).join(' ')}"]`);
  if (h.contract) {
    const c = h.contract;
    L.push(`[Declarer "${c.declarer}"]`, `[Contract "${c.level}${c.strain === 'N' ? 'NT' : c.strain}${c.doubled === 1 ? 'X' : c.doubled === 2 ? 'XX' : ''}"]`, `[Result "${h.declTricks}"]`);
  } else L.push('[Declarer ""]', '[Contract "Pass"]', '[Result ""]');
  L.push(`[Auction "${h.dealer}"]`);
  const calls = h.auction.map(a => a.call === 'P' ? 'Pass' : a.call.replace('N', 'NT'));
  for (let i = 0; i < calls.length; i += 4) L.push(calls.slice(i, i + 4).join(' '));
  if (h.contract && h.tricks && h.tricks.length) {
    const lead = nextSeat(h.contract.declarer);
    const cols = [lead, nextSeat(lead), partnerOf(lead), nextSeat(partnerOf(lead))];
    L.push(`[Play "${lead}"]`);
    h.tricks.forEach(tr => L.push(cols.map(s => { const pc = tr.cards.find(x => x.seat === s); return pc ? pc.card : '-'; }).join(' ')));
    if (h.tricks.length < 13) L.push('*');
  }
  const en = ddEntry(h.hands);
  if (en && en.done) {
    const par = parScore(en.table, h.vul);
    L.push(`[OptimumScore "NS ${par.scoreNS}"]`);
  }
  return L.join('\n');
}
// ---------- hand record as a document (Word, or printed to PDF) ----------
function recordDocHTML(h, t) {
  const col = s => (s === 'H' || s === 'D') ? '#c62828' : '#000';
  const sym = s => `<span style="color:${col(s)}">${SYM[s]}</span>`;
  const handHTML = s => `<b>${SEAT_NAME[s]}</b><br>${['S', 'H', 'D', 'C'].map(su => sym(su) + ' ' + (h.hands[s].filter(c => c[0] === su).sort((a, b) => rankOf(b) - rankOf(a)).map(c => rankLabel(c[1])).join(' ') || '–')).join('<br>')}`;
  const callHTML = c => c === 'P' ? 'Pass' : c === 'X' ? '<span style="color:#c62828">X</span>' : c === 'XX' ? '<span style="color:#1f5fae">XX</span>' : c[0] + sym(c[1]);
  const order = ['W', 'N', 'E', 'S'];
  const cells = []; for (let i = 0; i < order.indexOf(h.dealer); i++) cells.push('');
  (h.auction || []).forEach(a => cells.push(callHTML(a.call) + (a.alert ? '*' : '')));
  const rows = []; for (let i = 0; i < cells.length; i += 4) rows.push('<tr>' + [0, 1, 2, 3].map(j => `<td>${cells[i + j] ?? ''}</td>`).join('') + '</tr>');
  const alerts = (h.auction || []).filter(a => a.alert).map(a => `<li>${callHTML(a.call)} by ${SEAT_NAME[a.by]}: ${esc(a.alert)}</li>`).join('');
  const result = h.contract ? `${contractText(h.contract)}, ${resultText(h.contract, h.declTricks)} (${h.declTricks} tricks). N-S ${h.scoreNS > 0 ? '+' : ''}${h.scoreNS}` : 'Passed out';
  let dd = '';
  const en = ddEntry(h.hands);
  if (en && en.done) {
    const st = ['N', 'S', 'H', 'D', 'C'];
    dd = `<h3>Double-dummy analysis</h3><table class="grid"><tr><th></th>${st.map(s => `<th>${s === 'N' ? 'NT' : sym(s)}</th>`).join('')}</tr>${['N', 'S', 'E', 'W'].map(d => `<tr><th>${d}</th>${st.map(s => { const v = en.table[d][s]; return `<td>${v >= 7 ? v - 6 : '–'}</td>`; }).join('')}</tr>`).join('')}</table>`;
    const par = parScore(en.table, h.vul); if (par) dd += `<p>Par: ${esc(par.text)}, N-S ${par.scoreNS > 0 ? '+' : ''}${par.scoreNS}</p>`;
  }
  let play = '';
  if (h.tricks && h.tricks.length && h.contract) play = `<h3>Play</h3><table class="grid"><tr><th>Trick</th>${['N', 'E', 'S', 'W'].map(s => `<th>${s}</th>`).join('')}</tr>${h.tricks.map((tr, k) => {
    const w = tr.cards.length === 4 ? trickWinner(tr, h.contract.strain) : null;
    return `<tr><td>${k + 1}</td>${['N', 'E', 'S', 'W'].map(s => { const pc = tr.cards.find(x => x.seat === s); return `<td>${pc ? (s === w ? '<b><u>' : '') + sym(pc.card[0]) + rankLabel(pc.card[1]) + (s === w ? '</u></b>' : '') : ''}</td>`; }).join('')}</tr>`;
  }).join('')}</table><p style="font-size:10pt">The underlined card won each trick.</p>`;
  const title = `Board ${h.board}${t && t.name ? ' · ' + esc(t.name) : ''}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#000;margin:24px}
h2{margin:0 0 4px}h3{margin:18px 0 6px;font-size:13pt}
table{border-collapse:collapse}td,th{padding:3px 9px;text-align:center}
.grid td,.grid th{border:1px solid #999}.diag td{vertical-align:top;text-align:left;padding:6px 16px;line-height:1.5}
</style></head><body><h2>${title}</h2><p>Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
<table class="diag"><tr><td></td><td>${handHTML('N')}</td><td></td></tr><tr><td>${handHTML('W')}</td><td></td><td>${handHTML('E')}</td></tr><tr><td></td><td>${handHTML('S')}</td><td></td></tr></table>
<h3>Auction</h3><table class="grid"><tr>${order.map(s => `<th>${SEAT_NAME[s]}</th>`).join('')}</tr>${rows.join('')}</table>${alerts ? `<ul style="font-size:10pt">${alerts}</ul>` : ''}
<h3>Result</h3><p>${result}</p>${dd}${play}</body></html>`;
}
function exportRecord(h, kind) {
  const base = `board-${h.board}`;
  if (kind === 'pbn') return downloadText(base + '.pbn', pbnBoard(h, T) + '\n');
  const html = recordDocHTML(h, T);
  if (kind === 'doc') return downloadText(base + '.doc', html, 'application/msword'); // Word opens HTML saved as .doc
  // PDF: open the record and the print dialog; choose "Save as PDF" there
  let w = null; try { w = window.open('', '_blank'); } catch (e) { }
  if (w) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 300); }
  else {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
  }
  toast('In the print window, choose "Save as PDF".', 4000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to the clipboard'); } catch (e2) { toast('Copying is blocked here. Select the text and copy it yourself.'); }
    ta.remove();
  }
}
function downloadText(name, text, type = 'text/plain') {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { copyText(text); }
}

