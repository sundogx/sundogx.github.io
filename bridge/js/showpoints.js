// ======================= Show my points =======================
// Options > "Show my points" (off by default): a small quiet "12 HCP" on your own name plate during the
// auction and play, and on dummy's plate once dummy is face up. Uses app.js's Prefs and table.js helpers.
const ShowPoints = {
  optionsHTML(opt) { return opt('showHCP', 'Show my points', 'A small label on your name plate gives your high-card points, and dummy\'s once dummy is face up.'); },
  tag(t, seat) {
    if (!Prefs.showHCP || !t || !t.hands || t.masked || (t.phase !== 'auction' && t.phase !== 'play')) return '';
    const mine = mySeat(t); if (!mine) return '';
    const dummy = t.phase === 'play' && seat === dummySeat(t) && t.play && t.play.tricks.length > 0;
    if (seat !== mine && !dummy) return '';
    const cards = t.hands[seat];
    if (!cards || !cards.length || cards.some(c => c[0] === '?')) return '';
    return `<span class="hcpTag" title="High-card points">${hcp(cards)} HCP</span>`;
  },
};
