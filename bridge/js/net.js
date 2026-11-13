// ======================= Connection to the game server =======================
// One WebSocket per open table. Loaded before app.js; everything here only runs once the page is going,
// so it can use app.js helpers ($, toast, render, T, ...).

const Net = {
  ws: null, code: null, retry: 0, gotState: false, pingTimer: null, lastMsg: 0, onFirst: null, hist: [], other: [], chat: [],
  open(code, onFirst) {
    this.close();
    this.code = code; this.retry = 0; this.gotState = false; this.onFirst = onFirst;
    this.connect();
  },
  connect() {
    const code = this.code;
    const ws = new WebSocket(`${API_BASE ? API_BASE.replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host}/api/table/${code}/ws`);
    this.ws = ws;
    this.hist = []; this.other = []; this.chat = [];
    ws.onopen = () => {
      this.retry = 0; this.lastMsg = Date.now(); setConn('');
      ws.send(JSON.stringify({ type: 'hello', secret: me.secret, name: me.name }));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.check(ws), 25000);
    };
    ws.onmessage = e => {
      if (this.ws === ws) this.lastMsg = Date.now();
      if (e.data === 'pong' || this.ws !== ws) return;
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'state') {
        const first = !this.gotState; this.gotState = true;
        if (m.hist) this.hist = this.hist.slice(0, m.histFrom).concat(m.hist); // finished boards arrive once
        if (m.other) this.other = m.other;
        this.chat = (m.chatFull ? [] : this.chat).concat(m.chat || []).slice(-120); // only new chat lines arrive
        T = m.t; T.history = this.hist; T.otherHistory = this.other; T.chat = this.chat; watchers = m.watchers || 0;
        otherRoom = T.match ? { history: T.otherHistory || [] } : null;
        if (typeof m.now === 'number') clockSkew = m.now - Date.now();
        if (first && this.onFirst) { const f = this.onFirst; this.onFirst = null; f(); }
        if (first) rememberTable(T);
        if (this.chatQueue && this.chatQueue.length && ws.readyState === 1) { this.chatQueue.forEach(c => ws.send(JSON.stringify(c))); this.chatQueue = []; }
        if (this.pending) { const p = this.pending; this.pending = null; if (p.mark === playMark(T) && ws.readyState === 1) ws.send(JSON.stringify(p.msg)); else toast('The table moved on while you were reconnecting, so your move wasn\'t sent.'); }
        render();
      } else if (m.type === 'error') toast(m.msg);
      else if (m.type === 'notfound') {
        const wasOpen = this.gotState, gone = this.code; this.close(); forgetTable(gone);
        toast(wasOpen ? 'This table has closed.' : 'No table has that code. Check the letters and try again.');
        if (wasOpen) goHome();
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      setConn('Reconnecting…');
      const wait = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (this.ws === ws) this.connect(); }, wait);
    };
  },
  // Ping; if nothing has come back for a while the connection is dead even though it says it is open, so start a new one.
  check(ws = this.ws) {
    if (!ws || this.ws !== ws) return;
    if (ws.readyState === 1) {
      if (Date.now() - this.lastMsg > 60000) { this.reconnect(); return; }
      ws.send('ping');
    }
  },
  reconnect() {
    const old = this.ws; if (!old || !this.code) return;
    this.ws = null; clearInterval(this.pingTimer); try { old.close(); } catch (e) { }
    setConn('Reconnecting…'); this.retry = 0; this.connect();
  },
  send(msg) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    // Hold one move made while reconnecting; it's sent if the table hasn't changed in the meantime.
    if (msg.type === 'act' && msg.name === 'chat' && T && !T.local) { (this.chatQueue = this.chatQueue || []).push(msg); if (this.chatQueue.length > 10) this.chatQueue.shift(); toast('Reconnecting. Your message will be sent as soon as the connection is back.'); return false; }
    if (msg.type === 'act' && T && !T.local) { this.pending = { msg, mark: playMark(T) }; toast('Reconnecting. Your move will be sent as soon as the connection is back.'); return false; }
    toast('Not connected yet. Your move wasn\'t sent, so try again in a moment.');
    return false;
  },
  close() {
    const ws = this.ws; this.ws = null; this.code = null; this.pending = null; this.chatQueue = []; clearInterval(this.pingTimer); setConn('');
    if (ws) try { ws.close(1000); } catch (e) { }
  },
};
// After a phone sleeps or changes network, check the connection as soon as the page is back.
document.addEventListener('visibilitychange', () => { if (!document.hidden && Net.ws && Net.ws.readyState === 1 && Date.now() - Net.lastMsg > 30000) Net.reconnect(); });
window.addEventListener('online', () => { if (Net.ws && Net.code) Net.reconnect(); });
let watchers = 0;
function setConn(text) { const el = $('connState'); if (el) el.textContent = text; }

