// ===== Sharing and importing deals (feature: share) =====
// A finished board as a link (#deal=…, everything in the hash, no server), a read-only viewer for such links,
// and import of PBN, BBO LIN strings and BBO handviewer URLs, to view or to play against the robots.
// The parsing and encoding at the top is pure (Node can require it); the page part is at the bottom.
if (typeof module !== 'undefined' && typeof SEATS === 'undefined') Object.assign(globalThis, require('./engine.js'));

const SH_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SH_DECK = SUITS.flatMap(s => [...RANKS].map(r => s + r)); // 52 cards, card index = position
const SH_VUL = { None: 'o', NS: 'n', EW: 'e', Both: 'b' };
const SH_VUL_BACK = { o: 'None', n: 'NS', e: 'EW', b: 'Both' };
function shCallIndex(call) {
  if (call === 'P') return 35; if (call === 'X') return 36; if (call === 'XX') return 37;
  return (+call[0] - 1) * 5 + STRAINS.indexOf(call[1]);
}
function shCallOf(i) { return i === 35 ? 'P' : i === 36 ? 'X' : i === 37 ? 'XX' : (Math.floor(i / 5) + 1) + STRAINS[i % 5]; }

// h: a board as in t.history. Format: board.DV.deal.auction.play[.tricks]
// deal: each card's holder (2 bits, SEATS order), three cards to a character; auction and play: one character each.
function shareEncode(h) {
  const owner = {}; SEATS.forEach((s, i) => h.hands[s].forEach(c => { owner[c] = i; }));
  let deal = '';
  for (let i = 0; i < 52; i += 3) { let v = 0; for (let j = 0; j < 3; j++) v = v * 4 + (i + j < 52 ? owner[SH_DECK[i + j]] : 0); deal += SH_B64[v]; }
  const auc = (h.auction || []).map(a => SH_B64[shCallIndex(a.call)]).join('');
  const flat = (h.tricks || []).flatMap(tr => tr.cards.map(pc => SH_B64[SH_DECK.indexOf(pc.card)])).join('');
  const parts = [h.board || 1, h.dealer + SH_VUL[h.vul], deal, auc, flat];
  const played = (h.tricks || []).filter(tr => tr.cards.length === 4).length;
  if (h.contract && h.declTricks != null && played < 13) parts.push(h.declTricks); // a claim
  return parts.join('.');
}
function shareDecode(s) {
  const p = String(s).split('.');
  if (p.length < 3 || p[2].length !== 18) throw new Error('Not a deal link');
  const dealer = p[1][0], vul = SH_VUL_BACK[p[1][1]];
  if (!SEATS.includes(dealer) || !vul) throw new Error('Not a deal link');
  const hands = { N: [], E: [], S: [], W: [] };
  for (let k = 0; k < 18; k++) {
    let v = SH_B64.indexOf(p[2][k]); if (v < 0) throw new Error('Not a deal link');
    for (let j = 2; j >= 0; j--) { const i = k * 3 + j; if (i < 52) hands[SEATS[v & 3]].push(SH_DECK[i]); v >>= 2; }
  }
  const calls = []; for (const ch of p[3] || '') { const i = SH_B64.indexOf(ch); if (i < 0 || i > 37) break; calls.push(shCallOf(i)); }
  const plays = [...(p[4] || '')].map(ch => SH_DECK[SH_B64.indexOf(ch)]);
  return buildDeal({ board: +p[0] || 1, dealer, vul, hands, calls, plays, claim: p[5] != null && p[5] !== '' ? +p[5] : null });
}

// Make a board record (the shape of t.history entries) from parsed parts; checks the deal, stops at the first illegal call or card.
function buildDeal({ board, dealer, vul, hands, calls = [], plays = [], claim = null, alerts = {} }) {
  const all = SEATS.flatMap(s => hands[s] || []);
  if (all.length !== 52 || new Set(all).size !== 52 || SEATS.some(s => hands[s].length !== 13)) throw new Error('The deal needs four hands of 13 different cards');
  const auction = [];
  let by = dealer;
  for (const c of calls) {
    if (auctionOver(auction) || !isLegalCall(dealer, auction, c)) break;
    const a = { call: c, by }; if (alerts[auction.length]) a.alert = alerts[auction.length];
    auction.push(a); by = nextSeat(by);
  }
  const over = auctionOver(auction);
  const contract = over ? finalContract(auction) : null;
  const tricks = [];
  let declTricks = null;
  if (contract) {
    const left = {}; SEATS.forEach(s => { left[s] = hands[s].slice(); });
    let turn = nextSeat(contract.declarer);
    for (const card of plays) {
      let tr = tricks[tricks.length - 1];
      if (!tr || tr.cards.length === 4) { if (tricks.length === 13) break; tr = { leader: turn, cards: [] }; tricks.push(tr); }
      const hand = left[turn], led = tr.cards.length ? suitOf(tr.cards[0].card) : null;
      if (!hand.includes(card) || (led && suitOf(card) !== led && hand.some(c => suitOf(c) === led))) { if (!tr.cards.length) tricks.pop(); break; }
      hand.splice(hand.indexOf(card), 1);
      tr.cards.push({ seat: turn, card });
      turn = tr.cards.length === 4 ? trickWinner(tr, contract.strain) : nextSeat(turn);
    }
    const won = tricks.filter(tr => tr.cards.length === 4 && sameSide(trickWinner(tr, contract.strain), contract.declarer)).length;
    const full = tricks.filter(tr => tr.cards.length === 4).length;
    declTricks = claim != null && claim >= 0 && claim <= 13 ? claim : full === 13 ? won : null;
  }
  const h = { board: board || 1, dealer, vul, hands, auction, contract, tricks, declTricks, scoreNS: contract && declTricks != null ? scoreNS(contract, declTricks, vul) : 0 };
  if (!over) h.unfinished = true;
  return h;
}

// a hand like "SAKQ.HJT9.D...C..." pieces: suits in S H D C order, ranks; "10" becomes T
function shRanks(str) { return String(str).toUpperCase().replace(/10/g, 'T').replace(/[^AKQJT2-9]/g, ''); }
function shParseCard(str) {
  const t = String(str).trim().toUpperCase().replace('10', 'T');
  if (/^[SHDC][AKQJT2-9]$/.test(t)) return t;
  if (/^[AKQJT2-9][SHDC]$/.test(t)) return t[1] + t[0];
  return null;
}

// ---------- PBN (the first board in the text) ----------
// the boards in a PBN file that have a deal: their [Board] numbers, in file order
function pbnBoards(text) { return String(text).split(/(?=\[Board\s+")/).filter(b => /\[Deal\s+"/i.test(b)).map(b => (/\[Board\s+"([^"]*)"/.exec(b) || [])[1] || '?'); }
function parsePBN(text, pick = 0) { // pick: which of the boards that have a deal
  text = String(text).replace(/\{[^}]*\}/g, ' ').replace(/^%.*$/gm, '').replace(/^;.*$/gm, '');
  const boards = text.split(/(?=\[Board\s+")/);
  const src = boards.filter(b => /\[Deal\s+"/i.test(b))[pick];
  if (!src) throw new Error('No [Deal] tag found');
  const tags = {}, sect = {};
  let cur = null;
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*\[(\w+)\s+"([^"]*)"\s*\]/.exec(line);
    if (m) { cur = m[1].toLowerCase(); tags[cur] = m[2]; sect[cur] = ''; continue; }
    if (cur) sect[cur] += ' ' + line;
  }
  const dm = /^([NESW]):(.*)$/i.exec((tags.deal || '').trim());
  if (!dm) throw new Error('The [Deal] tag is not in the N:… form');
  const hands = {};
  let s = dm[1].toUpperCase();
  const parts = dm[2].trim().split(/\s+/);
  for (let k = 0; k < 4; k++) {
    const suits = (parts[k] || '').split('.');
    hands[s] = parts[k] === '-' ? null : SUITS.flatMap((su, i) => [...shRanks(suits[i] || '')].map(r => su + r));
    s = nextSeat(s);
  }
  fillFourth(hands);
  const board = parseInt(tags.board, 10) || 1;
  const dealer = /^[NESW]$/i.test(tags.dealer || '') ? tags.dealer.toUpperCase() : boardDealer(board);
  const vul = { none: 'None', love: 'None', '-': 'None', ns: 'NS', ew: 'EW', all: 'Both', both: 'Both' }[(tags.vulnerable || '').toLowerCase()] || boardVul(board);
  const calls = [];
  if (sect.auction != null) {
    for (let tok of sect.auction.split(/\s+/)) {
      tok = tok.replace(/[!?]+$/, '').toUpperCase();
      if (!tok || /^=\d+=$/.test(tok) || /^\$\d+$/.test(tok) || tok === '*' || tok === '+' || tok === '-') continue;
      if (tok === 'AP') { while (calls.length < 3 || calls.slice(-3).some(c => c !== 'P')) calls.push('P'); continue; }
      if (tok === 'PASS') calls.push('P'); else if (tok === 'X' || tok === 'XX') calls.push(tok);
      else { const b = /^([1-7])(NT|N|S|H|D|C)$/.exec(tok); if (b) calls.push(b[1] + b[2][0]); }
    }
  }
  const rows = [];
  if (sect.play != null && /^[NESW]$/i.test(tags.play || '')) {
    const cols = []; let c = tags.play.toUpperCase(); for (let k = 0; k < 4; k++) { cols.push(c); c = nextSeat(c); }
    const toks = sect.play.split(/\s+/).filter(t => t && !/^=\d+=$/.test(t) && !/^\$\d+$/.test(t) && t !== '*');
    for (let i = 0; i + 4 <= toks.length; i += 4) rows.push(Object.fromEntries(cols.map((seat, j) => [seat, shParseCard(toks[i + j].replace(/[!?]+$/, ''))])));
  }
  const res = parseInt(tags.result, 10);
  return buildFromRows({ board, dealer, vul, hands, calls, rows, claim: Number.isFinite(res) ? res : null });
}
// PBN play rows are by seat, not by order of play: put each trick in order from its leader
function buildFromRows(d) {
  const first = buildDeal({ ...d, plays: [] });
  if (!first.contract || !d.rows.length) return first;
  const plays = [];
  let lead = nextSeat(first.contract.declarer);
  for (const row of d.rows) {
    const tr = { cards: [] }; let s = lead;
    for (let k = 0; k < 4; k++) { if (!row[s]) break; tr.cards.push({ seat: s, card: row[s] }); plays.push(row[s]); s = nextSeat(s); }
    if (tr.cards.length < 4) break;
    lead = trickWinner(tr, first.contract.strain);
  }
  return buildDeal({ ...d, plays });
}
function fillFourth(hands) {
  const miss = SEATS.filter(s => !hands[s] || !hands[s].length);
  if (miss.length === 1) { const have = new Set(SEATS.flatMap(s => hands[s] || [])); hands[miss[0]] = SH_DECK.filter(c => !have.has(c)); }
}

// ---------- BBO LIN (also inside a handviewer URL) ----------
function parseLIN(text) {
  let s = String(text).trim();
  const url = /^https?:\/\//i.test(s) ? new URL(s) : null;
  if (url) {
    const q = url.searchParams;
    if (q.get('lin')) s = q.get('lin');
    else if (q.get('n') || q.get('s')) return parseHandviewer(q);
    else throw new Error('This link has no deal in it');
  } else if (/^lin=/i.test(s)) s = decodeURIComponent(s.slice(4));
  if (!/md\|/i.test(s)) { try { const d = decodeURIComponent(s); if (/md\|/i.test(d)) s = d; } catch (e) { } }
  const tok = s.replace(/\r?\n/g, '').split('|');
  let dealer = null, vul = 'None', board = 1, hands = null, claim = null;
  const calls = [], plays = [], alerts = {};
  for (let i = 0; i + 1 < tok.length; i += 2) {
    const k = tok[i].trim().toLowerCase(), v = tok[i + 1];
    if (k === 'md') {
      const m = /^([1-4])?(.*)$/.exec(v.trim());
      if (m[1]) dealer = ['S', 'W', 'N', 'E'][+m[1] - 1];
      const hs = m[2].split(','); hands = {};
      ['S', 'W', 'N', 'E'].forEach((seat, j) => { hands[seat] = linHand(hs[j] || ''); });
      fillFourth(hands);
    } else if (k === 'sv') vul = { o: 'None', '0': 'None', n: 'NS', e: 'EW', b: 'Both' }[v.trim().toLowerCase()] || 'None';
    else if (k === 'ah') { const m = /(\d+)/.exec(v); if (m) board = +m[1] || 1; }
    else if (k === 'mb') {
      const c = v.trim().replace(/!$/, '').toUpperCase();
      const call = c === 'P' ? 'P' : c === 'D' ? 'X' : c === 'R' ? 'XX' : /^[1-7](N|NT|S|H|D|C)$/.test(c) ? c[0] + c[1] : null;
      if (call) { calls.push(call); if (/!$/.test(v.trim())) alerts[calls.length - 1] = 'Alerted'; }
    } else if (k === 'an' && calls.length) alerts[calls.length - 1] = v.trim() || 'Alerted';
    else if (k === 'pc') { const c = shParseCard(v); if (c) plays.push(c); }
    else if (k === 'mc') claim = parseInt(v, 10);
  }
  if (!hands) throw new Error('No md| (deal) found');
  if (!dealer) dealer = boardDealer(board);
  return buildDeal({ board, dealer, vul, hands, calls, plays, claim: Number.isFinite(claim) ? claim : null, alerts });
}
function linHand(str) { // "SAKQHJT9D876C5432"
  const out = []; let su = null;
  for (const ch of String(str).toUpperCase().replace(/10/g, 'T')) {
    if ('SHDC'.includes(ch)) su = ch; else if (su && 'AKQJT98765432'.includes(ch)) out.push(su + ch);
  }
  return out;
}
// handviewer.html?n=skqhaj…&s=…&e=…&w=…&d=n&v=b&b=7&a=1sp2sppp&p=…
function parseHandviewer(q) {
  const hands = {};
  for (const s of SEATS) hands[s] = q.get(s.toLowerCase()) ? linHand(q.get(s.toLowerCase())) : null;
  fillFourth(hands);
  const board = parseInt(q.get('b'), 10) || 1;
  const d = (q.get('d') || '').toUpperCase();
  const dealer = SEATS.includes(d) ? d : boardDealer(board);
  const vul = { o: 'None', '-': 'None', n: 'NS', e: 'EW', b: 'Both' }[(q.get('v') || '').toLowerCase()] || boardVul(board);
  const calls = [];
  const a = (q.get('a') || '').toUpperCase().replace(/\([^)]*\)/g, '');
  for (let i = 0; i < a.length;) {
    const ch = a[i];
    if (ch === 'P') { calls.push('P'); i++; } else if (ch === 'D') { calls.push('X'); i++; } else if (ch === 'R') { calls.push('XX'); i++; }
    else if (/[1-7]/.test(ch) && /[NSHDC]/.test(a[i + 1] || '')) { calls.push(ch + a[i + 1]); i += a[i + 2] === 'T' && a[i + 1] === 'N' ? 3 : 2; }
    else i++;
  }
  const plays = []; const p = (q.get('p') || '').toUpperCase();
  for (let i = 0; i + 1 < p.length; i += 2) { const c = shParseCard(p.slice(i, i + 2)); if (c) plays.push(c); }
  return buildDeal({ board, dealer, vul, hands, calls, plays });
}
// whatever was pasted: a deal link of ours, a handviewer URL, LIN, or PBN
function parseAnyDeal(text, pick = 0) {
  const s = String(text).trim();
  if (!s) throw new Error('Paste a deal first');
  const ours = /#deal=([A-Za-z0-9_.\-]+)/.exec(s);
  if (ours) return shareDecode(ours[1]);
  if (/\[Deal\s+"/i.test(s)) return parsePBN(s, pick);
  if (/md\||md%7C|lin=|handviewer|[?&]n=/i.test(s)) return parseLIN(s);
  throw new Error('That isn\'t a PBN deal, a LIN string or a handviewer link');
}

if (typeof module !== 'undefined') module.exports = { shareEncode, shareDecode, buildDeal, parsePBN, pbnBoards, parseLIN, parseAnyDeal };

// ---------- the page ----------
if (typeof document !== 'undefined') {
  window.shareURL = h => location.origin + location.pathname + '#deal=' + shareEncode(h);
  // a read-only hand record for a shared or imported deal, with the card-by-card replay, and "Play this deal"
  window.showSharedDeal = function (h) {
    const hand = s => `<div><div class="lbl">${SEAT_NAME[s]}</div>${rowsHTML(h.hands[s])}</div>`;
    const res = h.contract ? `${contractHTML(h.contract)}${h.declTricks != null ? ' ' + resultText(h.contract, h.declTricks) + ', N-S ' + h.scoreNS : ''}` : h.unfinished ? 'Auction not finished' : 'Passed out';
    const hasPlay = h.tricks && h.tricks.length;
    const fake = { auction: [], seats: {} };
    const m = modal(`<h3>Board ${h.board}</h3><p class="note" style="margin-top:-6px">Dealer ${SEAT_NAME[h.dealer]}. ${vulText(h.vul)}.</p>
      ${hasPlay ? `<p class="rphead">${res}</p><div id="replayBox"></div>` : `<div class="diagram"><div></div>${hand('N')}<div></div>${hand('W')}<div class="lbl">${res}</div>${hand('E')}<div></div>${hand('S')}<div></div></div>`}
      ${h.auction.length ? auctionGridHTML(fake, h.auction, h.dealer, h.vul, null) : ''}
      <h3 style="font-size:16px;margin-top:12px">Double-dummy analysis</h3><div id="ddBox">${ddHTML(h)}</div>
      ${hasPlay && h.contract ? `<h3 style="font-size:16px;margin-top:12px">Play</h3><div id="playBox">${playTableHTML(h)}</div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn small primary" id="shPlay">Play this deal</button><button class="btn small" id="shCopy">Copy link</button><button class="btn small" id="shPbn">Copy PBN</button></div>`);
    if (hasPlay) startReplay(h);
    m.querySelector('#shPlay').addEventListener('click', () => { closeModal(); playSharedDeal(h); });
    m.querySelector('#shCopy').addEventListener('click', () => copyText(shareURL(h)));
    m.querySelector('#shPbn').addEventListener('click', () => copyText(pbnBoard(h, { name: 'Shared deal', seats: {} })));
    // the analysis callbacks only follow the open table's hand record, so this window polls for itself
    let lastDD = '', lastPlay = '';
    const iv = setInterval(() => {
      if (!m.isConnected) { clearInterval(iv); return; }
      const dd = ddHTML(h); if (dd !== lastDD) { lastDD = dd; const el = m.querySelector('#ddBox'); if (el) el.innerHTML = dd; }
      const pb = m.querySelector('#playBox');
      if (pb) { const pt = playTableHTML(h); if (pt !== lastPlay) { lastPlay = pt; pb.innerHTML = pt; if (replayDraw) replayDraw(); } }
    }, 700);
  };
  // practice with robots on this deal: you sit South, the robots bid and play the rest
  window.playSharedDeal = function (h) {
    const t = newTable({ name: 'Practice', local: true });
    t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: me.name || 'You' }, W: { kind: 'robot' } };
    t.board = (h.board || 1) - 1;
    startBoard(t, { dealer: h.dealer, vul: h.vul, hands: structuredClone(h.hands) });
    t.replayOf = null;
    openTable(t);
  };
  window.showImport = function () {
    const m = modal(`<h3>Import a deal</h3>
      <p class="note">Paste a PBN deal, a BBO LIN string or a BBO handviewer link, or open a .pbn or .lin file.</p>
      <textarea id="shText" rows="6" style="width:100%;box-sizing:border-box;font:13px ui-monospace,monospace" placeholder="[Deal &quot;N:…&quot;] or md|…| or https://www.bridgebase.com/tools/handviewer.html?lin=…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn small" id="shFileBtn">Open a file</button><input type="file" id="shFile" accept=".pbn,.lin,.txt,text/plain" hidden></div>
      <label class="row note hidden" id="shPick" style="gap:6px;margin-top:8px">Board <select id="shBoard"></select></label>
      <p class="note hidden" id="shErr" role="status"></p>
      <div class="row" style="margin-top:8px"><button class="btn small primary" id="shDoPlay">Play it</button><button class="btn small" id="shDoView">View</button></div>`);
    const read = () => {
      try { return parseAnyDeal(m.querySelector('#shText').value, +m.querySelector('#shBoard').value || 0); }
      catch (e) { const el = m.querySelector('#shErr'); el.textContent = e.message || 'That deal could not be read'; el.classList.remove('hidden'); return null; }
    };
    const boards = () => { // a PBN file of several boards: choose one
      const v = m.querySelector('#shText').value, b = /\[Deal\s+"/i.test(v) ? pbnBoards(v) : [];
      m.querySelector('#shBoard').innerHTML = b.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
      m.querySelector('#shPick').classList.toggle('hidden', b.length < 2);
    };
    m.querySelector('#shText').addEventListener('input', () => { m.querySelector('#shErr').classList.add('hidden'); boards(); });
    m.querySelector('#shFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { m.querySelector('#shText').value = await f.text(); boards(); } });
    m.querySelector('#shFileBtn').addEventListener('click', () => m.querySelector('#shFile').click()); /* feature: a11y */
    m.querySelector('#shDoPlay').addEventListener('click', () => { const h = read(); if (h) { closeModal(); playSharedDeal(h); } });
    m.querySelector('#shDoView').addEventListener('click', () => { const h = read(); if (h) showSharedDeal(h); });
    m.querySelector('#shText').focus();
  };
  document.addEventListener('click', e => { if (e.target.closest('[data-import]')) showImport(); });
  const fromHash = () => {
    const m = /^#deal=([A-Za-z0-9_.\-]+)$/.exec(location.hash);
    if (!m) return;
    try { showSharedDeal(shareDecode(m[1])); } catch (e) { console.error(e); toast('That deal link is damaged'); }
  };
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('load', () => setTimeout(fromHash, 0));
}
