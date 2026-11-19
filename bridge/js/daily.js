// ===== Daily deals (feature: daily) =====
// Everyone gets the same 4 boards each UTC day, dealt in the page from the seed 'daily:<date>', played against
// the robots like practice. After each board the result goes to the server (POST /api/daily), which shows the
// matchpoints against everyone else who played it. Without the server (offline) the boards still play.
// Uses the app's globals (T, me, newTable, startBoard, openTable, modal, closeModal, esc, Local, API_BASE...).
const Daily = {
  BOARDS: 4,
  today: () => new Date().toISOString().slice(0, 10),
  saved() {
    const t = Local.get('bt:daily');
    return t && t.daily && t.local && t.seats && t.hands && Array.isArray(t.history) && Array.isArray(t.chat) && t.play ? t : null;
  },
  start() {
    const typed = $('nameInput').value.trim().slice(0, 20);
    if (typed && typed !== me.name) { me.name = typed; saveMe(); }
    const nm = me.name || 'You';
    const s = Daily.saved();
    if (s && s.daily === Daily.today()) {
      s.seats.S = { kind: 'human', id: me.id, name: nm };
      try { openTable(s); return; } catch (e) { console.error(e); }
    }
    const date = Daily.today();
    const t = newTable({ name: 'Daily deals', local: true });
    t.daily = date; t.seed = 'daily:' + date; t.dailyPosted = {};
    t.seats = { N: { kind: 'robot' }, E: { kind: 'robot' }, S: { kind: 'human', id: me.id, name: nm }, W: { kind: 'robot' } };
    startBoard(t);
    openTable(t);
  },
  title: t => `Daily deals, board ${Math.min(t.board, Daily.BOARDS)} of ${Daily.BOARDS}`,
  // the result panel: no Next after the last board, and a Leaderboard button
  resultButtons(t, go) {
    const lb = '<button class="btn" data-daily-lb="1">Leaderboard</button>';
    if (t.board >= Daily.BOARDS) return `<p class="note" style="margin:4px 0 0">That's today's ${Daily.BOARDS} boards. New ones at midnight UTC.</p><div class="row">${lb}</div>`;
    return go.replace('</div>', lb + '</div>');
  },
  // called on every render of a daily table: post finished boards once (retrying now and then while offline)
  lastTry: 0, busy: false,
  onRender(t) {
    if (t.phase !== 'done' || Daily.busy || Date.now() - Daily.lastTry < 20000) return;
    t.dailyPosted = t.dailyPosted || {};
    const h = t.history.find(x => x.board <= Daily.BOARDS && !x.replayOf && !t.dailyPosted[x.board]);
    if (!h || navigator.onLine === false) return;
    Daily.busy = true; Daily.lastTry = Date.now();
    const c = h.contract;
    fetch(API_BASE + '/api/daily', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: t.daily, board: h.board, secret: me.secret, name: me.name || 'Player', contract: c ? { level: c.level, strain: c.strain, declarer: c.declarer, doubled: c.doubled || 0 } : null, declTricks: c ? h.declTricks : null }),
    }).then(r => {
      // posted, already there, or refused for good (an old date): don't send it again
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) { t.dailyPosted[h.board] = true; Daily.lastTry = 0; if (typeof savePractice === 'function') savePractice(); }
    }).catch(() => {}).finally(() => { Daily.busy = false; });
  },
  async showLeaderboard(board) {
    const t = T; if (!t || !t.daily) return;
    board = board || Math.min(t.board, Daily.BOARDS);
    let d = null;
    try {
      const r = await fetch(`${API_BASE}/api/daily/${t.daily}?u=${encodeURIComponent(me.id)}`);
      if (r.ok) d = await r.json();
    } catch (e) { /* offline */ }
    if (T !== t) return; // left the table meanwhile
    if (!d) { modal('<h3>Daily deals</h3><p class="note">The leaderboard needs a connection. Your boards still count on this device; results are sent when you\'re back online.</p>'); return; }
    const you = d.overall.find(p => p.you);
    const res = r => r.contract ? `${contractHTML(r.contract)} ${resultText(r.contract, r.declTricks)}` : 'Passed out';
    const sc = v => (v > 0 ? '+' : '') + v;
    const b = d.boards[board] || { rows: [], count: 0 };
    const tabs = Array.from({ length: Daily.BOARDS }, (_, i) => `<button class="btn small" data-daily-b="${i + 1}" aria-pressed="${i + 1 === board}">Board ${i + 1}</button>`).join('');
    const m = modal(`<h3>Daily deals, ${esc(t.daily)}</h3>
      <p>${you ? `Your rank: <b>${you.rank}</b> of ${d.players}, ${you.pct}% over ${you.boards} board${you.boards === 1 ? '' : 's'}` : 'Finish a board to get a rank.'}</p>
      <div class="row daily-tabs">${tabs}</div>
      <table class="daily-lb"><thead><tr><th>Name</th><th>Result</th><th>N-S</th><th>MP</th></tr></thead><tbody>
      ${b.rows.map(r => `<tr class="${r.you ? 'you' : ''}"><td>${esc(r.name)}</td><td>${res(r)}</td><td>${sc(r.score)}</td><td>${r.pct}%</td></tr>`).join('') || '<tr><td colspan="4" class="note">Nobody has played this board yet.</td></tr>'}
      </tbody></table>
      <p class="note">${b.count} played board ${board}. Matchpoints: 2 for each score beaten, 1 for each tie, as a percentage.</p>
      <h3 style="margin-top:12px">Overall</h3>
      <table class="daily-lb"><thead><tr><th>#</th><th>Name</th><th>Boards</th><th>%</th></tr></thead><tbody>
      ${d.overall.slice(0, 20).concat(you && you.rank > 20 ? [you] : []).map(p => `<tr class="${p.you ? 'you' : ''}"><td>${p.rank}</td><td>${esc(p.name)}</td><td>${p.boards}</td><td>${p.pct}%</td></tr>`).join('')}
      </tbody></table>`);
    m.querySelectorAll('[data-daily-b]').forEach(x => x.addEventListener('click', () => { Daily.showLeaderboard(+x.dataset.dailyB); }));
  },
  renderHome() {
    const s = Daily.saved(), btn = $('dailyBtn');
    if (!btn) return;
    const cur = s && s.daily === Daily.today() ? s : null;
    btn.textContent = !cur ? 'Daily deals' : cur.phase === 'done' && cur.board >= Daily.BOARDS ? 'Daily deals (done)' : `Daily deals, board ${cur.board} of ${Daily.BOARDS}`;
  },
};
document.addEventListener('click', e => {
  if (e.target.closest('#dailyBtn')) Daily.start();
  else if (e.target.closest('[data-daily-lb]')) Daily.showLeaderboard();
});
