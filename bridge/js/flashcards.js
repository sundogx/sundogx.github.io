// ===== feature: flashcards =====
// "What do you bid?": single bidding decisions by topic. A card is made by dealing and letting the robots bid
// (botCall, read-only) until South faces a decision of the topic; you pick a call and see the robot's call and
// what the system takes it to mean. Streak and per-topic accuracy are kept in localStorage (bridge-fc).
// Loaded after js/explorer.js (its bx* helpers) and before app.js.
const FC_TOPICS = [
  ['openings', 'Openings'], ['responses', 'Responses'], ['notrump', 'Notrump'], ['competition', 'Competition'], ['slam', 'Slam'],
];
const FC_VULS = ['None', 'NS', 'EW', 'Both'];
const fcIsBid = c => bidValue(c) >= 0;
const fcNS = s => s === 'N' || s === 'S';

// Which topic South's decision after `prefix` belongs to (null: none). call is the robot's call there.
function fcTopicOf(prefix, call, vul) {
  const nonP = prefix.filter(a => a.call !== 'P');
  const theirs = nonP.filter(a => !fcNS(a.by)), ours = nonP.filter(a => fcNS(a.by));
  const first = prefix.find(a => fcIsBid(a.call));
  const lb = lastBid(prefix);
  // slam: key-card asks and answers, control bids, bids at the six and seven level, quantitative notrump
  const slamCall = (fcIsBid(call) && +call[0] >= 6) || call === '4N' || call === '5N';
  const askedKC = ours.length && ['4N', '5N'].includes(ours[ours.length - 1].call) && ours[ours.length - 1].by === 'N';
  if (slamCall || askedKC) return 'slam';
  if (ours.length >= 2 && fcIsBid(call) && lb && fcNS(lb.by) && +call[0] >= 4) {
    let d = ''; try { d = describeCall(prefix.concat({ by: 'S', call }), prefix.length, vul) || ''; } catch (e) { d = ''; }
    if (/control bid|key card|grand slam|queen/i.test(d)) return 'slam';
  }
  if (!first) return 'openings';
  if (theirs.length) return lb && +lb.call[0] <= 4 && !(fcIsBid(call) && +call[0] >= 5) && ours.filter(a => a.by === 'S').length <= 1 ? 'competition' : null;
  // opponents silent from here on
  if (fcNS(first.by) && (first.call === '1N' || first.call === '2N')) return 'notrump';
  if (first.by === 'N' && /^1[CDHS]$/.test(first.call) && ours.length === 1) return 'responses';
  return null;
}
// how often a decision is used even though it is a pass (most passes are dull)
const FC_PASS_KEEP = { openings: 0.15, responses: 0.3, notrump: 0.5, competition: 0.2, slam: 0.6 };

// Deal until South has a decision of this topic. { hands, dealer, vul, prefix, call, alert, topic } or null.
function fcGenerate(topic, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let hands = deal();
    const dealer = SEATS[Math.floor(Math.random() * 4)], vul = FC_VULS[Math.floor(Math.random() * 4)];
    // slam and notrump decisions want strength on our side: give N-S the stronger pair of hands
    if (topic === 'slam' || topic === 'notrump' || topic === 'responses') {
      const ns = hcp(hands.N) + hcp(hands.S), ew = hcp(hands.E) + hcp(hands.W);
      if (ew > ns) hands = { N: hands.E, E: hands.S, S: hands.W, W: hands.N };
      if (topic === 'slam' && Math.max(ns, ew) < 30) continue;
    }
    const auction = [];
    while (!auctionOver(auction) && auction.length < 40) {
      const seat = auctionTurn(dealer, auction);
      const r = botCall(hands[seat], seat, dealer, auction, vul);
      if (seat === 'S') {
        const tp = fcTopicOf(auction, r.call, vul);
        if (tp === topic && (r.call !== 'P' || Math.random() < FC_PASS_KEEP[topic]))
          return { hands, dealer, vul, prefix: auction.slice(), call: r.call, alert: r.alert || null, topic };
        // past the stage where this topic can come up
        if (topic === 'openings' && auction.some(a => fcIsBid(a.call))) break;
        if (topic === 'responses' && auction.filter(a => a.call !== 'P').length > 1) break;
      }
      auction.push(r.alert ? { by: seat, call: r.call, alert: r.alert } : { by: seat, call: r.call });
    }
  }
  return null;
}
// Only the robot's own call counts as right. Comparing the system's meanings was tried and isn't a clear test:
// it reads many different calls alike (2NT and 6NT, 3♠ and 4♠ in competition, different control bids) because
// its natural fallback gives them the same ranges, so no other call is accepted.
function fcSame(prefix, a, b) { return a === b; }

// ---- stats ----
function fcLoad() {
  let s = null; try { s = JSON.parse(localStorage.getItem('bridge-fc') || 'null'); } catch (e) { s = null; }
  s = s && typeof s === 'object' ? s : {};
  s.streak = s.streak | 0; s.best = s.best | 0; s.t = s.t && typeof s.t === 'object' ? s.t : {};
  for (const [k] of FC_TOPICS) { const v = s.t[k]; s.t[k] = Array.isArray(v) ? [v[0] | 0, v[1] | 0] : [0, 0]; }
  if (!FC_TOPICS.some(([k]) => k === s.topic) && s.topic !== 'mixed') s.topic = 'mixed';
  return s;
}
function fcStore() { try { localStorage.setItem('bridge-fc', JSON.stringify(FC.stats)); } catch (e) { } }

// ---- the screen ----
const FC = { on: false, fromTable: false, card: null, answer: null, level: null, next: null, stats: null };

function fcBuild() {
  if (bxEl('flashcards')) return;
  const s = document.createElement('section');
  s.id = 'flashcards'; s.className = 'hidden';
  s.innerHTML = `<div class="topbar"><span class="tt">What do you bid?</span><span class="code" id="fcStreak"></span>
    <button class="btn small" id="fcLeave">Leave</button></div>
    <div class="fc-topics" role="group" aria-label="Topic">${[['mixed', 'Mixed']].concat(FC_TOPICS).map(([k, t]) => `<button class="btn small" data-fctopic="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
    <div class="bx-wrap"><div class="bx-main"><div id="fcInfo" class="note"></div><div id="fcHand" class="bx-hand"></div>
    <div id="fcBox"></div><div id="fcResult"></div></div><div class="bx-side"><div id="fcGrid"></div></div></div>
    <p class="note fc-acc" id="fcAcc"></p>`;
  bxEl('tableView').after(s); // after the table's topbar: app.js finds that one as the first .topbar
  s.addEventListener('click', fcClick);
}
function startFlashcards() {
  fcBuild();
  FC.stats = fcLoad();
  FC.fromTable = bxOpenScreen('flashcards'); FC.on = true;
  fcNew();
}
function leaveFlashcards() { FC.on = false; bxCloseScreen('flashcards', FC.fromTable, 'flashBtn'); }
function fcPickTopic() {
  const t = FC.stats.topic;
  return t === 'mixed' ? FC_TOPICS[Math.floor(Math.random() * FC_TOPICS.length)][0] : t;
}
function fcNew() {
  FC.answer = null; FC.level = null;
  const want = FC.stats.topic;
  const ready = FC.next && (want === 'mixed' || FC.next.topic === want) ? FC.next : null;
  FC.next = null;
  if (ready) { FC.card = ready; fcRender(); fcFocus(); return; }
  FC.card = null; FC.failed = false; fcRender();
  setTimeout(() => { // let "Dealing…" paint first
    let c = null; const tp = fcPickTopic();
    for (let i = 0; i < 3 && !c; i++) c = fcGenerate(tp);
    FC.card = c; FC.failed = !c; fcRender(); fcFocus();
  }, 20);
}
function fcFocus(part) { const b = bxEl('fcBox') && bxEl('fcBox').querySelector(`${part || ''} button:not(:disabled)`); if (b) b.focus({ preventScroll: true }); }
const fcTopicName = k => (FC_TOPICS.find(x => x[0] === k) || [k, 'Mixed'])[1];
function fcRender() {
  const st = FC.stats;
  bxEl('fcStreak').textContent = `Streak ${st.streak}${st.best ? `, best ${st.best}` : ''}`;
  bxEl('flashcards').querySelectorAll('[data-fctopic]').forEach(b => b.setAttribute('aria-pressed', b.dataset.fctopic === st.topic ? 'true' : 'false'));
  const acc = FC_TOPICS.filter(([k]) => st.t[k][1]).map(([k, t]) => `${t} ${st.t[k][0]}/${st.t[k][1]} (${Math.round(100 * st.t[k][0] / st.t[k][1])}%)`);
  bxEl('fcAcc').innerHTML = acc.length ? `${acc.join(' · ')} <button class="btn small" data-fcreset="1">Reset</button>` : '';
  const c = FC.card;
  if (!c) {
    bxEl('fcInfo').textContent = FC.failed ? 'No position of this topic came up this time.' : 'Dealing…';
    bxEl('fcHand').innerHTML = ''; bxEl('fcBox').innerHTML = ''; bxEl('fcGrid').innerHTML = '';
    bxEl('fcResult').innerHTML = FC.failed ? '<div class="row"><button class="btn primary" data-fcnext="1">Try again</button></div>' : '';
    return;
  }
  bxEl('fcInfo').textContent = `${fcTopicName(c.topic)}. Dealer ${SEAT_NAME[c.dealer]}, ${vulText(c.vul)}. You are South.`;
  bxEl('fcHand').innerHTML = bxHandHTML(c.hands.S);
  const shownAuction = FC.answer ? c.prefix.concat({ by: 'S', call: FC.answer }) : c.prefix;
  bxEl('fcGrid').innerHTML = bxGridHTML(FC.answer ? shownAuction.slice() : c.prefix, c.dealer, c.vul, !FC.answer);
  bxEl('fcBox').innerHTML = FC.answer ? '' : bxBoxHTML(c.dealer, c.prefix, FC.level, 'fc');
  bxEl('fcResult').innerHTML = FC.answer ? fcResultHTML() : '';
}
function fcDesc(prefix, call, alert, vul) {
  const a = prefix.concat(alert ? { by: 'S', call, alert } : { by: 'S', call });
  let metas = null; try { metas = auctionMetas(a, vul); } catch (e) { metas = null; }
  const m = bxMeaning(a, a.length - 1, vul, metas);
  const tag = m.kind === 'alert' ? '<span class="bx-al">Alert</span> ' : m.kind === 'announce' ? '<span class="bx-an">Announced</span> ' : '';
  return tag + (m.text ? bxText(m.text) : call === 'P' ? '' : 'Natural');
}
function fcResultHTML() {
  const c = FC.card, you = FC.answer;
  const head = FC.right ? '<p class="fc-ok">Right.</p>' : `<p class="fc-no">The robots bid ${bxCallHTML(c.call)}.</p>`;
  const rows = [`<tr><th>Robots</th><td class="bx-c">${bxCallHTML(c.call)}</td><td>${fcDesc(c.prefix, c.call, c.alert, c.vul)}</td></tr>`];
  if (you !== c.call) rows.push(`<tr><th>You</th><td class="bx-c">${bxCallHTML(you)}</td><td>${fcDesc(c.prefix, you, null, c.vul)}</td></tr>`);
  return `<div class="fc-res">${head}<table class="bx-list">${rows.join('')}</table>
    <div class="row"><button class="btn primary" data-fcnext="1">Next</button></div></div>`;
}
function fcAnswer(call) {
  const c = FC.card;
  if (!c || FC.answer || !legalCalls(c.dealer, c.prefix).includes(call)) return;
  FC.answer = call; FC.level = null;
  FC.right = fcSame(c.prefix, call, c.call, c.vul);
  const st = FC.stats, t = st.t[c.topic];
  t[1]++; if (FC.right) { t[0]++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
  fcStore(); fcRender();
  const nb = bxEl('fcResult').querySelector('[data-fcnext]'); if (nb) nb.focus({ preventScroll: true });
  // the next card is made while you read this one
  setTimeout(() => { if (FC.on && FC.answer && !FC.next) FC.next = fcGenerate(fcPickTopic(), 500); }, 60);
}
function fcClick(e) {
  const b = e.target.closest('button, [data-alert]'); if (!b) return;
  const d = b.dataset;
  if (b.id === 'fcLeave') leaveFlashcards();
  else if (d.fctopic) { FC.stats.topic = d.fctopic; fcStore(); if (!FC.card || FC.answer || (d.fctopic !== 'mixed' && FC.card.topic !== d.fctopic)) fcNew(); else fcRender(); }
  else if (d.fclevel) { FC.level = +d.fclevel; bxEl('fcBox').innerHTML = bxBoxHTML(FC.card.dealer, FC.card.prefix, FC.level, 'fc'); fcFocus('.st'); }
  else if (d.fccall) fcAnswer(d.fccall);
  else if (d.fcnext) fcNew();
  else if (d.fcreset) { const topic = FC.stats.topic; localStorage.removeItem('bridge-fc'); FC.stats = fcLoad(); FC.stats.topic = topic; fcStore(); fcRender(); }
  else if (d.alert) { if (bxEl('explainPop')) hideExplain(); else showExplain(b, d.alert); }
  else return;
  e.stopPropagation();
}
// keys (from explorer.js's listener): the bidding box, and N for the next card
function fcKey(k, e) {
  const c = FC.card; if (!c) { if (FC.failed && k === 'n') fcNew(); return; }
  if (FC.answer) { if (k === 'n') { fcNew(); e.preventDefault(); } return; }
  if (bxBoxKey(k, c.dealer, c.prefix, FC.level, l => { FC.level = l; bxEl('fcBox').innerHTML = bxBoxHTML(c.dealer, c.prefix, FC.level, 'fc'); fcFocus('.st'); }, x => fcAnswer(x))) e.preventDefault();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', e => { if (e.target.closest('[data-flashcards]')) startFlashcards(); });
  const b = document.getElementById('flashBtn'); if (b) b.addEventListener('click', () => startFlashcards());
}
if (typeof module !== 'undefined') module.exports = { FC_TOPICS, fcTopicOf, fcGenerate, fcSame };
