// ======================= Auto-play single cards (feature: autoplay) =======================
// Loaded before app.js; uses its globals (T, Prefs, turnSeat, myLegal, playMark, doAct, selCard, ...).
// When the seat you play for (your hand, or dummy when you declare) has only one legal card, it is played
// for you after about half a second, using the normal card action, so it works in practice and online.
// The last trick is always one card each, so it plays itself too.
// With "Confirm before playing a card" on, a single card is only raised (one tap or Enter plays it),
// except on the last trick, where there is nothing to choose. A position is auto-played once only, so an
// undo back to it leaves the card for you to play.
const AutoPlay = {
  timer: null, key: null, done: new Set(),
  onRender(t) {
    if (Prefs.autoPlay === false || !t || t.phase !== 'play') return this.cancel();
    const ts = turnSeat(t), legal = ts ? myLegal(t, ts) : [];
    if (legal.length !== 1) return this.cancel();
    const key = t.id + ':' + playMark(t) + ':' + ts;
    if (this.key === key || this.done.has(key)) return;
    this.cancel(); this.key = key;
    const card = legal[0], last = remainingHand(t.hands, t.play, ts).length === 1;
    if (Prefs.confirm && !last) { this.done.add(key); if (selCard !== card) { selCard = card; renderHand(); renderFelt(); } return; }
    // after a trick ends, wait for the finished trick to clear first
    const tr = t.play.tricks[t.play.tricks.length - 1], wait = 500 + (tr && tr.cards.length === 4 ? trickHoldMs() : 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!T || T.id + ':' + playMark(T) + ':' + turnSeat(T) !== key || Prefs.autoPlay === false) return;
      const l = myLegal(T, ts); if (l.length !== 1 || l[0] !== card) return;
      if (this.done.size > 2000) this.done.clear(); // keep the once-only memory bounded over a long session
      this.done.add(key); selCard = null; doAct('card', ts, card);
    }, wait);
  },
  cancel() { clearTimeout(this.timer); this.timer = null; this.key = null; },
};
