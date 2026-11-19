/* feature: played */
// ===== Played cards, as on Funbridge: opened from the More menu =====
// Per suit, the cards already played (greyed, in rank order). At a practice table it also lists the cards
// still out that you can't see; online it shows only what any player may know, the played cards.
function playedCardsHTML(t) {
  const played = t && t.play && t.phase !== 'auction' ? t.play.tricks.flatMap(tr => tr.cards.map(pc => pc.card)) : [];
  let unseen = null;
  if (t && t.local && t.hands && (t.phase === 'play' || t.phase === 'done')) {
    const gone = new Set(played);
    const seen = new Set(SEATS.filter(s => canSee(t, s)).flatMap(s => t.hands[s]));
    unseen = SEATS.flatMap(s => t.hands[s]).filter(c => !gone.has(c) && !seen.has(c));
  }
  const ranks = cs => cs.slice().sort((a, b) => rankOf(b) - rankOf(a)).map(c => rankLabel(c[1])).join(' ') || '–';
  const rows = UI_SUITS.map(s => {
    const sym = `<span class="pc-s${isRed(s) ? ' red' : ''}">${SYM[s]}</span>`;
    const p = `<span class="pc-p">${ranks(played.filter(c => suitOf(c) === s))}</span>`;
    const u = unseen ? `<span class="pc-u">${ranks(unseen.filter(c => suitOf(c) === s))}</span>` : '';
    return `<div class="pc-row">${sym}${p}${u}</div>`;
  }).join('');
  const head = unseen ? '<div class="pc-row pc-h"><span class="pc-s"></span><span class="pc-p">Played</span><span class="pc-u">Still out, unseen</span></div>' : '';
  return `<h3>Played cards</h3>${played.length ? '' : '<p class="note">No card played yet.</p>'}<div class="pc">${head}${rows}</div>`;
}
function showPlayedCards() { if (typeof T !== 'undefined' && T) modal(playedCardsHTML(T)).classList.add('pc-modal'); }
document.addEventListener('click', e => { if (e.target.closest('[data-played]')) showPlayedCards(); });
