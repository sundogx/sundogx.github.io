// ======================= Skip a deal in practice (feature: skip) =======================
// More > Skip deal ends the current practice board without a result and deals the next one, like
// Funbridge's "Next deal". Nothing is added to the history, so Results and History/stats (js/stats.js,
// which saves only boards that reach phase 'done') never see it. Loaded before app.js; uses its helpers at run time.

const Skip = {
  ok: t => !!(t && t.local && !t.daily && !t.whatIf /* feature: playfrom */ && (t.phase === 'auction' || t.phase === 'play')),
  render(t) { const b = document.getElementById('skipBtn'); if (b) b.classList.toggle('hidden', !Skip.ok(t)); },
  go() {
    if (!Skip.ok(T)) return;
    if (T.phase === 'play' && !confirm('Skip this deal? It will not be scored.')) return;
    const board = T.board;
    selCard = null;
    act(s => {
      if (!Skip.ok(s) || s.board !== board) return false;
      sysMsg(s, `Board ${s.board} skipped`);
      startBoard(s);
    });
  },
};
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#skipBtn')) Skip.go(); });
