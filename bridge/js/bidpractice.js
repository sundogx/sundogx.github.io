// ===== feature: bidpractice =====
// Bidding-only practice: you bid South with a robot partner, the play is skipped. After the auction the board shows
// your contract's double-dummy result, the par contract, IMPs against par, and what the robots would have bid in
// your seat call by call, with each robot call's meaning. A running score is kept for the session.
// Self-contained: its own screen, built on first use. Loaded before app.js; uses app.js helpers at run time.
const BP = { on: false, board: 0, hands: null, dealer: 'N', vul: 'None', auction: [], level: null, done: false,
  next: null, total: 0, deals: 0, uncontested: false, poll: null, timer: null };
try { BP.uncontested = localStorage.getItem('bridge-bp-unc') === '1'; } catch (e) { }

const bpEl = id => document.getElementById(id);
const bpRobots = { N: { kind: 'robot' }, E: { kind: 'robot' }, W: { kind: 'robot' }, S: { kind: 'human' } };
const bpSign = v => (v > 0 ? '+' : '') + v;
const bpImps = v => `${bpSign(v)} IMP${Math.abs(v) === 1 ? '' : 's'}`;

function bpBuild() {
  if (bpEl('bidPractice')) return;
  const s = document.createElement('section');
  s.id = 'bidPractice'; s.className = 'hidden';
  s.innerHTML = `<div class="topbar"><span class="tt">Bidding practice</span><span class="code" id="bpScore"></span>
    <label class="row note bp-unc"><input type="checkbox" id="bpUnc"> Uncontested</label>
    <button class="btn small" id="bpLeave">Leave</button></div>
    <div class="bp-wrap"><div class="bp-main"><div id="bpInfo" class="note"></div><div id="bpHand" class="bp-hand"></div>
    <div id="bpBox"></div><div id="bpResult"></div></div><div class="bp-side" id="bpAuction"></div></div>`;
  bpEl('home').after(s);
  s.addEventListener('click', bpClick);
  bpEl('bpUnc').addEventListener('change', e => { BP.uncontested = e.target.checked; try { localStorage.setItem('bridge-bp-unc', BP.uncontested ? '1' : '0'); } catch (er) { }
    // before your first call the current auction restarts with the new choice; otherwise it starts with the next deal
    if (BP.on && !BP.done && !BP.auction.some(a => a.by === 'S')) { BP.unc = BP.uncontested; BP.auction = []; bpRobots_(); }
  });
}
function bpDeal() { // a fresh deal, with its analysis started at once so it's ready when the auction ends
  const board = BP.board + 1, hands = deal();
  requestDD(hands, true);
  return { board, hands, dealer: boardDealer(board), vul: boardVul(board) };
}
function startBidPractice() {
  bpBuild();
  BP.on = true;
  if (typeof leaveModals === 'function') leaveModals();
  bpEl('home').classList.add('hidden'); bpEl('tableView').classList.add('hidden'); bpEl('bidPractice').classList.remove('hidden');
  bpEl('bpUnc').checked = BP.uncontested;
  clearInterval(lobbyTimer);
  bpNext();
  bpFocusBox(); /* feature: a11y */
}
function leaveBidPractice() {
  BP.on = false; clearTimeout(BP.timer); clearInterval(BP.poll);
  bpEl('bidPractice').classList.add('hidden'); bpEl('home').classList.remove('hidden');
  { const b = bpEl('bidPracticeBtn'); if (b) b.focus({ preventScroll: true }); } /* feature: a11y */
  if (typeof loadLobby === 'function') { loadLobby(); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (!document.hidden) loadLobby(); }, 10000); }
}
function bpNext() {
  const d = BP.next || bpDeal();
  Object.assign(BP, d, { auction: [], level: null, done: false, next: null, unc: BP.uncontested });
  clearInterval(BP.poll); bpRobots_();
}
// robots call until it is South's turn or the auction ends
function bpRobots_() {
  while (!auctionOver(BP.auction)) {
    const seat = auctionTurn(BP.dealer, BP.auction);
    if (seat === 'S') break;
    BP.auction.push(bpRobotCall(seat, BP.auction));
  }
  if (auctionOver(BP.auction)) bpFinish();
  bpRender();
}
function bpRobotCall(seat, auction) {
  if (BP.unc && (seat === 'E' || seat === 'W')) return { by: seat, call: 'P' };
  const r = botCall(BP.hands[seat], seat, BP.dealer, auction, BP.vul);
  return r.alert ? { by: seat, call: r.call, alert: r.alert } : { by: seat, call: r.call };
}
function bpCall(call) {
  if (BP.done || auctionTurn(BP.dealer, BP.auction) !== 'S' || !legalCalls(BP.dealer, BP.auction).includes(call)) return;
  BP.auction.push({ by: 'S', call }); BP.level = null;
  bpRobots_();
}
function bpFinish() {
  BP.done = true;
  // the auction with a robot in South (the same robots around it)
  const ra = [];
  while (!auctionOver(ra)) ra.push(bpRobotCall(auctionTurn(BP.dealer, ra), ra));
  BP.robotAuction = ra;
  BP.next = bpDeal(); // the next deal's analysis queues behind this one
  requestDD(BP.hands, true);
  BP.scored = false;
  clearInterval(BP.poll);
  BP.poll = setInterval(() => { const en = ddEntry(BP.hands); if (DD.failed || (en && en.done)) { clearInterval(BP.poll); bpRenderResult(); } }, 120);
}
function bpScoreOf(c, table) { if (!c) return { ns: 0, tricks: null }; const t = table[c.declarer][c.strain]; return { ns: scoreNS(c, t, BP.vul), tricks: t }; }

function bpRender() {
  bpEl('bpScore').textContent = BP.deals ? `${BP.deals} deal${BP.deals === 1 ? '' : 's'}, ${bpImps(BP.total)}` : '';
  bpEl('bpInfo').textContent = `Board ${BP.board}. Dealer ${SEAT_NAME[BP.dealer]}, ${vulText(BP.vul)}.${BP.unc ? ' Uncontested.' : ''} You are South.`;
  bpEl('bpHand').innerHTML = bpHandHTML(BP.hands.S);
  const view = { seats: bpRobots, auction: BP.auction, phase: BP.done ? 'done' : 'auction' };
  // finished: every call explained by the system (a copy of the auction, so the grid reads it as a record)
  bpEl('bpAuction').innerHTML = auctionGridHTML(view, BP.done ? BP.auction.slice() : BP.auction, BP.dealer, BP.vul, 'S');
  bpEl('bpBox').innerHTML = BP.done ? '' : bpBoxHTML();
  if (!BP.done) bpEl('bpResult').innerHTML = '';
  else bpRenderResult();
}
function bpFocusBox(part) { /* feature: a11y */ const b = bpEl('bpBox') && bpEl('bpBox').querySelector(`${part || ''} button:not(:disabled)`); if (b) b.focus({ preventScroll: true }); }
function bpHandHTML(cards) {
  return UI_SUITS.map(s => {
    const cs = cards.filter(c => suitOf(c) === s).sort((a, b) => rankOf(b) - rankOf(a));
    return `<div class="bp-suit"><span class="${isRed(s) ? 'red ' : ''}s-${s}">${SYM[s]}</span> ${cs.length ? cs.map(c => rankLabel(c[1])).join(' ') : '–'}</div>`;
  }).join('') + `<div class="note">${hcp(cards)} HCP</div>`;
}
function bpBoxHTML() {
  const legal = legalCalls(BP.dealer, BP.auction);
  const minLevel = [1, 2, 3, 4, 5, 6, 7].find(l => STRAINS.some(s => legal.includes(l + s)));
  const lv = BP.level;
  return `<div class="bbox"><div class="lv">${[1, 2, 3, 4, 5, 6, 7].map(l => `<button class="bcard ${lv === l ? 'sel' : ''}" data-bplevel="${l}" ${!minLevel || l < minLevel ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <div class="st">${STRAINS.map(s => `<button class="bcard ${isRed(s) ? 'red' : ''} s-${s}" data-bpcall="${lv ? lv + s : ''}" aria-label="${lv ? lv + ' ' : ''}${STRAIN_WORD[s]}" ${lv && legal.includes(lv + s) ? '' : 'disabled'}>${SYM[s]}</button>`).join('')}</div>
    <div class="sp"><button class="bcard pass" data-bpcall="P">Pass</button><button class="bcard dbl" data-bpcall="X" aria-label="Double" ${legal.includes('X') ? '' : 'disabled'}>X</button><button class="bcard rdbl" data-bpcall="XX" aria-label="Redouble" ${legal.includes('XX') ? '' : 'disabled'}>XX</button></div></div>`;
}
const bpCallHTML = call => bidValue(call) >= 0 ? `${call[0]}${call[1] === 'N' ? 'NT' : `<span class="${isRed(call[1]) ? 'red ' : ''}s-${call[1]}">${SYM[call[1]]}</span>`}` : callText(call);
function bpRenderResult() {
  const box = bpEl('bpResult'); if (!box || !BP.done) return;
  const c = finalContract(BP.auction), rc = finalContract(BP.robotAuction);
  const en = ddEntry(BP.hands), ready = en && en.done;
  let head = '';
  if (DD.failed) head = '<p class="note">Double-dummy analysis isn\'t available in this browser.</p>';
  else if (!ready) head = '<p class="note">Analysing…</p>';
  else {
    const par = parScore(en.table, BP.vul), you = bpScoreOf(c, en.table), rob = bpScoreOf(rc, en.table);
    const imp = toImps(you.ns - par.scoreNS), rimp = toImps(rob.ns - par.scoreNS);
    if (!BP.scored) { BP.scored = true; BP.deals++; BP.total += imp; bpEl('bpScore').textContent = `${BP.deals} deal${BP.deals === 1 ? '' : 's'}, ${bpImps(BP.total)}`; }
    const line = (cc, r) => cc ? `${contractHTML(cc)}, ${r.tricks} tricks (${resultText(cc, r.tricks)}), N-S ${bpSign(r.ns)}` : 'Passed out, N-S 0';
    head = `<p><b>You:</b> ${line(c, you)}. <b>${bpImps(imp)}</b> against par.</p>
      <p><b>Par:</b> ${redSym(esc(par.text.replace(/(by \w+)([=+-])/, '$1 $2')))}, N-S ${bpSign(par.scoreNS)}.</p>
      <p><b>Robot in your seat:</b> ${line(rc, rob)}, ${bpImps(rimp)}.</p>`;
  }
  // your calls against the robot's, each judged on the auction as it really went
  const rows = [];
  BP.auction.forEach((a, i) => {
    if (a.by !== 'S') return;
    const before = BP.auction.slice(0, i), r = botCall(BP.hands.S, 'S', BP.dealer, before, BP.vul);
    const desc = describeCall(before.concat({ by: 'S', call: r.call, alert: r.alert }), i, BP.vul) || '';
    const same = r.call === a.call;
    rows.push(`<tr class="${same ? '' : 'bp-diff'}"><td>${bpCallHTML(a.call)}</td><td>${bpCallHTML(r.call)}</td><td class="note">${redSym(esc(desc))}</td></tr>`);
  });
  box.innerHTML = `<div class="bp-res">${head}
    <table class="bp-cmp"><tr><th>You</th><th>Robot</th><th>Robot's call means</th></tr>${rows.join('')}</table>
    <p class="note">Robots' auction: ${BP.robotAuction.map(a => bpCallHTML(a.call)).join(' ')}</p>
    <div class="row"><button class="btn primary" data-bpnext="1">Next deal</button></div></div>`;
  const nb = box.querySelector('[data-bpnext]'); if (nb) nb.focus({ preventScroll: true });
}
function bpClick(e) {
  const b = e.target.closest('button, [data-alert]'); if (!b) return;
  const d = b.dataset;
  if (b.id === 'bpLeave') leaveBidPractice();
  else if (d.bplevel) { BP.level = +d.bplevel; bpEl('bpBox').innerHTML = bpBoxHTML(); bpFocusBox('.st'); }
  else if (d.bpcall) { bpCall(d.bpcall); bpFocusBox(); }
  else if (d.bpnext) { bpNext(); bpFocusBox(); }
  else if (d.alert) { if (bpEl('explainPop')) hideExplain(); else showExplain(b, d.alert); }
  else return;
  e.stopPropagation();
}
document.addEventListener('keydown', e => { // N for the next deal once the auction is over
  if (!BP.on || !BP.done || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName || '')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); bpNext(); bpFocusBox(); }
});
{ const b = bpEl('bidPracticeBtn'); if (b) b.addEventListener('click', () => startBidPractice()); }
