// ======================= "Your turn" cues and table comfort (online play) =======================
// Loaded before app.js; everything here runs once the page is going, so it can use app.js helpers
// (T, Prefs, savePrefs, isMyTurn, mySeat, Net, soundOn, beep, ...). app.js calls Notify.onRender(T) after each
// render and Notify.title() for the tab title, and Options shows Notify.optionsHTML().
//  - Tab title and favicon say "Your turn" while the tab is hidden or unfocused (no flashing).
//  - Optional browser notifications for your turn and for chat while the tab is hidden (opt-in, permission asked then).
//  - The turn sound (More > Sound) is remembered; optional quiet card sounds, made with WebAudio.
//  - While your connection is lost the table shows you as away, with an "I'm back" button.

const Notify = {
  wasTurn: false, chatN: -1, chatUnseen: 0, cards: -1, tableId: null, iconHref: null, iconTurn: null, lost: 0, notes: [],

  away() { return !!(T && !T.local && Net.code && (!Net.ws || Net.ws.readyState !== 1)); },
  inBackground() { return document.hidden || !document.hasFocus(); },

  title() {
    const base = typeof BASE_TITLE === 'string' ? BASE_TITLE : 'Bridge';
    const bg = this.inBackground();
    const turn = !!(T && isMyTurn(T) && bg);
    let t = base;
    if (turn) t = '● Your turn – ' + base;
    else if (bg && this.chatUnseen) t = `(${this.chatUnseen}) Chat – ` + base;
    if (document.title !== t) document.title = t;
    this.favicon(turn);
  },

  // the normal icon, or the same icon with a gold dot in the corner
  favicon(turn) {
    const link = document.querySelector('link[rel="icon"]'); if (!link) return;
    if (this.iconHref === null) this.iconHref = link.getAttribute('href');
    if (!turn) { if (link.getAttribute('href') !== this.iconHref) link.setAttribute('href', this.iconHref); return; }
    if (this.iconTurn) { if (link.getAttribute('href') !== this.iconTurn) link.setAttribute('href', this.iconTurn); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 64);
        x.beginPath(); x.arc(46, 18, 15, 0, 2 * Math.PI); x.fillStyle = '#e0a800'; x.fill();
        x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
        this.iconTurn = c.toDataURL('image/png');
      } catch (e) { this.iconTurn = this.iconHref; }
      this.title();
    };
    img.src = this.iconHref;
  },

  notify(text, tag) {
    if (!Prefs.notify || !('Notification' in window) || Notification.permission !== 'granted' || !this.inBackground()) return;
    try {
      const n = new Notification('Bridge', { body: text, tag, icon: this.iconHref || 'icon-192.png', silent: true });
      n.onclick = () => { window.focus(); n.close(); };
      this.notes.push(n);
    } catch (e) { }
  },
  closeNotes() { this.notes.forEach(n => { try { n.close(); } catch (e) { } }); this.notes = []; },

  // a short, quiet tick for a card being played
  click() {
    if (!Prefs.cardSound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const a = audioCtx, len = Math.floor(a.sampleRate * 0.03), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2200; g.gain.value = 0.25;
      src.connect(f).connect(g).connect(a.destination); src.start();
    } catch (e) { }
  },

  onRender(t) {
    if (!t) return;
    if (t.id !== this.tableId) { this.tableId = t.id; this.wasTurn = false; this.chatN = -1; this.chatUnseen = 0; this.cards = -1; }
    const turn = isMyTurn(t);
    if (turn && !this.wasTurn) this.notify(t.phase === 'auction' ? 'Your turn to bid.' : 'Your turn to play.', 'turn');
    this.wasTurn = turn;
    // chat lines from other people that arrived while the tab was in the background
    const chat = t.chat || [];
    if (this.chatN >= 0 && chat.length > this.chatN) {
      const fresh = chat.slice(this.chatN).filter(m => !m.sys && m.from !== me.id);
      if (fresh.length && this.inBackground() && !t.local) {
        this.chatUnseen += fresh.length;
        const m = fresh[fresh.length - 1];
        this.notify(`${m.name}: ${m.text}`, 'chat');
      }
    }
    this.chatN = chat.length;
    // card sounds
    const n = t.play && t.play.tricks ? t.play.tricks.reduce((k, tr) => k + tr.cards.length, 0) : 0;
    if (t.phase === 'play' && this.cards >= 0 && n > this.cards) this.click();
    this.cards = n;
    this.renderAway();
    this.title();
  },

  // your own away state: the server marks you away while none of your connections is open
  renderAway() {
    const bar = document.getElementById('tableView'); if (!bar) return;
    let el = document.getElementById('awayMe');
    const show = this.away() && this.lost && Date.now() - this.lost > 2500;
    if (!show) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'awayMe'; el.className = 'awayme'; el.setAttribute('role', 'status');
      el.innerHTML = '<span>You are away: the connection was lost. The table sees you as away until you are back.</span> <button class="btn small primary" id="imBack">I\'m back</button>';
      const tb = bar.querySelector('.topbar'); if (tb) tb.after(el); else bar.prepend(el);
      el.querySelector('#imBack').addEventListener('click', () => { if (Net.code) Net.reconnect(); toast('Reconnecting…'); });
    }
  },
  watchConn() {
    if (this.away()) { if (!this.lost) this.lost = Date.now(); } else this.lost = 0;
    this.renderAway();
  },

  optionsHTML(opt) {
    const can = 'Notification' in window;
    return `<h3 style="font-size:16px;margin-top:14px">Online play</h3>
      ${opt('turnSound', 'Turn sound', 'A quiet tone when it is your turn (also under More).')}
      ${opt('cardSound', 'Card sounds', 'A soft tick when a card is played.')}
      ${can ? opt('notify', 'Notifications', 'When the Bridge tab is in the background, tell me when it is my turn and when someone chats.') : ''}`;
  },
  // Options checkboxes for these prefs: app.js saves the pref; this does the rest
  optionChanged(k, on) {
    if (k === 'turnSound') { soundOn = on; this.syncSoundBtn(); if (on) beep(); }
    if (k === 'cardSound' && on) this.click();
    if (k === 'notify' && on && 'Notification' in window && Notification.permission !== 'granted') {
      if (Notification.permission === 'denied') { toast('Notifications are blocked for this site in the browser settings.'); return; }
      Promise.resolve(Notification.requestPermission()).then(p => {
        if (p !== 'granted') { Prefs.notify = false; savePrefs(); const cb = document.querySelector('[data-pref="notify"]'); if (cb) cb.checked = false; toast('Notifications were not allowed.'); }
      });
    }
  },
  syncSoundBtn() { const b = $('soundBtn'); if (b) { b.textContent = soundOn ? 'Sound on' : 'Sound off'; b.setAttribute('aria-pressed', soundOn); } },

  // lobby filter by table type, kept in this browser
  filterTables(list) {
    const f = Prefs.lobbyFilter || 'all';
    const free = t => SEATS.some(s => !t.seats[s] || t.seats[s].kind === 'robot');
    return list.filter(t => f === 'all' || (f === 'free' && free(t)) || (f === 'match' && t.match) || (f === 'pairs' && !t.match) || (f === 'timed' && t.boardLimit));
  },
  // Join next free seat: the first open table (seats not locked) with an empty or robot seat, then sit there
  async joinFree() {
    if (!needName()) return;
    let tables;
    try { tables = (await api('/api/tables')).tables; } catch (e) { toast('Couldn\'t load the table list.'); return; }
    const seatOf = t => SEATS.find(s => !t.seats[s]) || SEATS.find(s => t.seats[s] && t.seats[s].kind === 'robot');
    const t = this.filterTables(tables).filter(t => !t.locked && seatOf(t)).sort((x, y) => (y.people || 0) - (x.people || 0) || y.updatedAt - x.updatedAt)[0];
    if (!t) { toast('No table has a free seat right now. Open one and invite your friends.'); return; }
    openOnline(t.code);
    const until = Date.now() + 15000, iv = setInterval(() => {
      if (Date.now() > until || Net.code !== t.code) { clearInterval(iv); return; }
      if (!T || T.local || T.id !== t.code || !Net.gotState) return;
      clearInterval(iv);
      if (mySeat(T)) return;
      const s = SEATS.find(s => !T.seats[s]) || SEATS.find(s => T.seats[s] && T.seats[s].kind === 'robot');
      if (s) doAct('sit', s); else toast('The free seat was taken meanwhile, so you are watching.');
    }, 200);
  },
  lobbyUI() {
    const r = $('refreshBtn'); if (!r || $('lobbyFilter')) return;
    const sel = document.createElement('select'); sel.id = 'lobbyFilter'; sel.setAttribute('aria-label', 'Show tables');
    sel.innerHTML = [['all', 'All tables'], ['free', 'With a free seat'], ['pairs', 'Pairs tables'], ['match', 'Team matches'], ['timed', 'Timed']].map(([v, l]) => `<option value="${v}" ${(Prefs.lobbyFilter || 'all') === v ? 'selected' : ''}>${l}</option>`).join('');
    sel.addEventListener('change', () => { Prefs.lobbyFilter = sel.value; savePrefs(); loadLobby(); });
    const box = document.createElement('span'); box.className = 'row lobbyf'; box.style.gap = '6px';
    const j = document.createElement('button'); j.className = 'btn small'; j.id = 'joinFreeBtn'; j.textContent = 'Join next free seat';
    j.addEventListener('click', () => this.joinFree());
    r.replaceWith(box); box.append(sel, j, r);
  },

  init() {
    if (Prefs.turnSound) { soundOn = true; this.syncSoundBtn(); }
    const sb = $('soundBtn');
    if (sb) sb.addEventListener('click', () => { Prefs.turnSound = soundOn; savePrefs(); }); // runs after app.js's toggle
    const back = () => { if (!this.inBackground()) { this.chatUnseen = 0; this.closeNotes(); } this.title(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back); window.addEventListener('blur', back);
    setInterval(() => this.watchConn(), 1000);
    this.lobbyUI();
  },
};
window.Notify = Notify;
document.addEventListener('DOMContentLoaded', () => Notify.init());
