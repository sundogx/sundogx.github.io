// ======================= Suit symbols in table chat (feature: chatsym) =======================
// When you send a chat message, clear bridge tokens become symbols: "2s" -> 2♠, "4h" -> 4♥, "3nt" -> 3NT,
// "4sx" -> 4♠X, "sa" -> ♠A, "dk" -> ♦K, "h10" / "ht" -> ♥10. Only whole words are touched (a space, the start or
// the end, or punctuation on either side), never links or e-mail addresses, and a few pairs that are also
// ordinary words ("ha", "da", "ca", "st", "dj"...) only when typed in capitals ("HA" -> ♥A). The chat already shows
// ♥/♦ in red (app.js redSym). Options > "Suit symbols in chat" turns it off (Prefs.noChatSym).
// Client-only: the server still just sees text. Loaded before app.js; uses Prefs at run time.

const ChatSym = {
  SYM: { s: '♠', h: '♥', d: '♦', c: '♣' },
  // suit + rank pairs that are also words or common abbreviations: converted only when written in capitals
  WORDS: new Set(['ha', 'da', 'ca', 'st', 'dj', 'sk', 'ct', 'hq', 'ht', 'sq']),
  on: () => typeof Prefs === 'undefined' || !Prefs.noChatSym,
  token(w) {
    let m = /^([1-7])(nt|n|s|h|d|c)(xx|x)?$/i.exec(w);
    if (m) { const st = m[2].toLowerCase(); return m[1] + (st[0] === 'n' ? 'NT' : ChatSym.SYM[st]) + (m[3] || '').toUpperCase(); }
    m = /^([shdc])(a|k|q|j|t|10|[2-9])$/i.exec(w);
    if (m) {
      if (ChatSym.WORDS.has(w.toLowerCase()) && w !== w.toUpperCase()) return null;
      const r = m[2].toUpperCase();
      return ChatSym.SYM[m[1].toLowerCase()] + (r === 'T' ? '10' : r);
    }
    return null;
  },
  convert(text) {
    if (!ChatSym.on() || typeof text !== 'string') return text;
    // split into runs of non-space; each run is opening punctuation, a word, closing punctuation
    return text.split(/(\s+)/).map(run => {
      if (!run || /^\s+$/.test(run) || /:\/\/|@|www\.|\.(com|org|net|io)\b/i.test(run)) return run;
      const m = /^([("'“‘]*)([A-Za-z0-9]+)([)"'”’.,;:!?]*)$/.exec(run);
      if (!m) return run;
      const t = ChatSym.token(m[2]);
      return t ? m[1] + t + m[3] : run;
    }).join('');
  },
  optionsHTML() {
    return `<label class="row" style="gap:8px;margin-bottom:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" data-chatsym="1" ${ChatSym.on() ? 'checked' : ''} style="margin-top:4px"> <span>Suit symbols in chat<br><span class="note">Typing 2s, 3nt or sa in table chat sends 2♠, 3NT or ♠A.</span></span></label>`;
  },
};
if (typeof document !== 'undefined') document.addEventListener('change', e => {
  if (!e.target.dataset || !e.target.dataset.chatsym) return;
  Prefs.noChatSym = !e.target.checked; savePrefs();
});
if (typeof module !== 'undefined') module.exports = { ChatSym };
