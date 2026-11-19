// ======================= Suit order (feature: suitorder) =======================
// The order of the suits in your own hand and dummy (not the hand record). Prefs.suitOrder: '' alternating colours
// (the default), 'rank' spades-hearts-diamonds-clubs, 'trump' trumps on the left during play, colours still alternating.
const SUIT_ORDERS = { '': ['S', 'H', 'C', 'D'], rank: ['S', 'H', 'D', 'C'] };
const TRUMP_LEFT = { S: ['S', 'H', 'C', 'D'], H: ['H', 'S', 'D', 'C'], D: ['D', 'S', 'H', 'C'], C: ['C', 'H', 'S', 'D'] };
function handSuits(t) {
  const p = (typeof Prefs !== 'undefined' && Prefs.suitOrder) || '';
  if (p === 'trump') return (t && t.phase === 'play' && t.contract && TRUMP_LEFT[t.contract.strain]) || SUIT_ORDERS[''];
  return SUIT_ORDERS[p] || SUIT_ORDERS[''];
}
function suitOrderOptionHTML() {
  const cur = (typeof Prefs !== 'undefined' && Prefs.suitOrder) || '';
  const opts = [['', 'Alternating colours ♠♥♣♦'], ['rank', 'By rank ♠♥♦♣'], ['trump', 'Trumps on the left in play']];
  return `<label class="row" style="gap:8px;margin:4px 0 8px">Suit order <select id="optSuitOrder">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
