// ===== Table model and actions: shared by the page (practice) and the server =====
// Plain functions over a table object; they use the globals me, toast, rid and T supplied by the app.
// ---------- table model helpers ----------
function newTable({ name, priv, local }) {
  const code = rid(5);
  return {
    id: code, name: name || 'Table ' + code, private: !!priv, local: !!local,
    createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now(), version: 0,
    seats: { N: null, E: null, S: null, W: null },
    board: 0, dealer: 'N', vul: 'None', hands: null, auction: [], contract: null,
    play: { tricks: [] }, phase: 'waiting', claim: null, history: [], chat: [],
    host: me.id, locked: false, allowUndo: true, kibSee: false,
    boardLimit: 0, lastActAt: Date.now(), boardStart: null, seed: null, match: null,
  };
}
function mySeat(t = T) { return SEATS.find(s => t.seats[s] && t.seats[s].kind === 'human' && t.seats[s].id === me.id) || null; }
function dummySeat(t) { return t.contract ? partnerOf(t.contract.declarer) : null; }
function turnSeat(t) {
  if (t.phase === 'auction') return auctionTurn(t.dealer, t.auction);
  if (t.phase === 'play') return playTurn(t.play, t.contract);
  return null;
}
function controllerOf(t, seat) {
  if (t.phase === 'play' && seat === dummySeat(t)) return t.contract.declarer;
  return seat;
}
function occupant(t, seat) { return t.seats[seat]; }
function seatLabel(t, seat) {
  const o = occupant(t, seat);
  if (!o) return 'Empty seat';
  return o.kind === 'robot' ? 'Robot' : o.name || 'Player';
}
function sysMsg(t, text) { t.chat.push({ sys: true, text, ts: Date.now() }); if (t.chat.length > 120) t.chat.splice(0, t.chat.length - 120); }
function allSeated(t) { return SEATS.every(s => t.seats[s]); }
function isHost(t = T) { return !t.local && t.host === me.id; }
function fixHost(t) {
  const humans = SEATS.map(s => t.seats[s]).filter(o => o && o.kind === 'human');
  if (!humans.some(o => o.id === t.host) && humans.length) { t.host = humans[0].id; sysMsg(t, `${humans[0].name} is now the host`); }
}

function startBoard(t) {
  t.board += 1;
  t.dealer = boardDealer(t.board);
  t.vul = boardVul(t.board);
  t.hands = t.seed ? deal(seededRand(t.seed + ':' + t.board)) : deal();
  t.auction = []; t.contract = null; t.play = { tricks: [] }; t.claim = null;
  t.boardStart = Date.now(); t.lastActAt = Date.now(); t.timeUp = false;
  t.phase = 'auction';
}
function finishBoard(t, declTricks) {
  const c = t.contract;
  const sc = c ? scoreNS(c, declTricks, t.vul) : 0;
  const rec = { board: t.board, dealer: t.dealer, vul: t.vul, hands: t.hands, auction: t.auction, contract: c, tricks: t.play.tricks, declTricks: c ? declTricks : null, scoreNS: sc };
  if (t.local) { try { const o = simulateBoard(t.hands, t.dealer, t.vul); rec.other = { auction: o.auction, contract: o.contract, declTricks: o.declTricks, scoreNS: o.scoreNS }; } catch (e) { console.error(e); } }
  t.history.push(rec);
  t.phase = 'done'; t.claim = null;
  sysMsg(t, `Board ${t.board}: ${c ? contractText(c) + ' ' + resultText(c, declTricks) : 'passed out'}, N-S ${sc >= 0 ? '+' : ''}${sc}`);
}

// ---------- actions (each validated against the freshest state) ----------
const A = {
  sit(t, seat) {
    const o = t.seats[seat];
    if (o && o.kind === 'human') return false;
    if (t.locked && t.host !== me.id) { toast('The host has locked the seats'); return false; }
    const cur = mySeat(t);
    if (cur) t.seats[cur] = null;
    t.seats[seat] = { kind: 'human', id: me.id, name: me.name || 'Player' };
    sysMsg(t, `${me.name || 'A player'} sat ${SEAT_NAME[seat]}`);
    if (allSeated(t) && t.board === 0) startBoard(t);
  },
  robot(t, seat) {
    if (t.seats[seat]) return false;
    t.seats[seat] = { kind: 'robot' };
    if (allSeated(t) && t.board === 0) startBoard(t);
  },
  standUp(t) {
    const s = mySeat(t); if (!s) return false;
    t.seats[s] = null; sysMsg(t, `${me.name || 'A player'} left ${SEAT_NAME[s]}`);
    fixHost(t);
  },
  kick(t, seat) {
    if (t.host !== me.id || !t.seats[seat]) return false;
    const o = t.seats[seat];
    t.seats[seat] = null;
    sysMsg(t, `The host removed ${o.kind === 'robot' ? 'the robot' : o.name} from ${SEAT_NAME[seat]}`);
  },
  settings(t, patch) {
    if (t.host !== me.id) return false;
    Object.assign(t, patch);
    const on = v => v ? 'on' : 'off';
    if ('locked' in patch) sysMsg(t, `Seats ${patch.locked ? 'locked' : 'unlocked'} by the host`);
    if ('allowUndo' in patch) sysMsg(t, `Undo turned ${on(patch.allowUndo)}`);
    if ('boardLimit' in patch) sysMsg(t, patch.boardLimit ? `Time limit set to ${patch.boardLimit} minutes per board` : 'Time limit removed');
    if ('kibSee' in patch) sysMsg(t, `Spectators ${patch.kibSee ? 'can' : 'can no longer'} see all hands`);
  },
  redeal(t) {
    if (t.host !== me.id || t.phase !== 'auction') return false;
    t.board -= 1; startBoard(t); sysMsg(t, `The host redealt board ${t.board}`);
  },
  call(t, seat, call, alert) {
    if (t.phase !== 'auction' || auctionTurn(t.dealer, t.auction) !== seat) return false;
    if (!isLegalCall(t.dealer, t.auction, call)) return false;
    t.auction.push(alert ? { call, by: seat, alert } : { call, by: seat });
    t.lastActAt = Date.now();
    if (auctionOver(t.auction)) {
      t.contract = finalContract(t.auction);
      if (!t.contract) finishBoard(t, 0); else t.phase = 'play';
    }
  },
  card(t, seat, card) {
    if (t.phase !== 'play' || t.claim || playTurn(t.play, t.contract) !== seat) return false;
    if (!legalPlays(t.hands, t.play, t.contract, seat).includes(card)) return false;
    applyPlay(t.play, t.contract, seat, card);
    t.lastActAt = Date.now();
    if (completedTricks(t.play).length === 13) finishBoard(t, tricksWon(t.play, t.contract).decl);
  },
  claim(t, seat, n) {
    if (t.phase !== 'play' || t.claim || seat === dummySeat(t)) return false;
    const left = 13 - completedTricks(t.play).length;
    if (n < 0 || n > left) return false;
    const opp = sameSide(seat, t.contract.declarer)
      ? [nextSeat(t.contract.declarer), partnerOf(nextSeat(t.contract.declarer))]
      : [t.contract.declarer];
    t.claim = { by: seat, tricks: n, need: opp, acc: {} };
    sysMsg(t, `${SEAT_NAME[seat]} claims ${n} of the remaining ${left} tricks`);
    resolveRobotClaim(t);
  },
  respond(t, seat, accept) {
    if (!t.claim || !t.claim.need.includes(seat)) return false;
    if (!accept) { sysMsg(t, `${SEAT_NAME[seat]} rejected the claim. Play continues.`); t.claim = null; return; }
    t.claim.acc[seat] = true; checkClaim(t);
  },
  cancelClaim(t, seat) { if (!t.claim || t.claim.by !== seat) return false; t.claim = null; sysMsg(t, `${SEAT_NAME[seat]} withdrew the claim`); },
  chat(t, text) {
    const s = mySeat(t);
    t.chat.push({ from: me.id, name: me.name || 'Player', seat: s, text, ts: Date.now() });
    if (t.chat.length > 120) t.chat.splice(0, t.chat.length - 120);
  },
  next(t) { if (t.phase !== 'done') return false; startBoard(t); },
  undo(t, seat) { if (!t.local && t.allowUndo === false) return false; return doUndo(t, seat); },
  robotStep(t) {
    const ts = turnSeat(t); if (!ts) return false;
    if (t.claim) return false;
    const ctrl = controllerOf(t, ts);
    const o = occupant(t, ctrl);
    if (!o || o.kind !== 'robot') return false;
    if (t.phase === 'auction') { const r = botCall(t.hands[ts], ts, t.dealer, t.auction); return A.call(t, ts, r.call, r.alert); }
    return A.card(t, ts, botPlay(t, ts));
  },
};
function checkClaim(t) {
  const c = t.claim; if (!c) return;
  if (!c.need.every(s => c.acc[s])) return;
  const done = tricksWon(t.play, t.contract).decl;
  const left = 13 - completedTricks(t.play).length;
  const declExtra = sameSide(c.by, t.contract.declarer) ? c.tricks : left - c.tricks;
  sysMsg(t, 'Claim accepted');
  finishBoard(t, done + declExtra);
}
function resolveRobotClaim(t) {
  const c = t.claim; if (!c) return;
  for (const s of c.need) {
    const ctrl = controllerOf(t, s);
    const o = occupant(t, ctrl);
    if (o && o.kind === 'robot') {
      const left = 13 - completedTricks(t.play).length;
      const ok = c.tricks <= sureTricks(t, c.by) || c.tricks === 0 || (c.tricks < left && c.tricks <= sureTricks(t, c.by) + 0);
      if (!ok) { sysMsg(t, `Robot ${SEAT_NAME[s]} rejected the claim. Play continues.`); t.claim = null; return; }
      c.acc[s] = true;
    }
  }
  checkClaim(t);
}
function doUndo(t, seat) {
  if (!seat || (t.phase !== 'auction' && t.phase !== 'play') || t.claim) return false;
  const isRobotCtrl = s => { const o = occupant(t, controllerOf(t, s)); return o && o.kind === 'robot'; };
  if (t.phase === 'play') {
    const flat = []; t.play.tricks.forEach(tr => tr.cards.forEach(pc => flat.push(pc)));
    if (flat.length) {
      let i = flat.length - 1;
      while (i >= 0 && controllerOf(t, flat[i].seat) !== seat) { if (!isRobotCtrl(flat[i].seat)) return false; i--; }
      if (i < 0) return false; // you haven't played a card yet: nothing of yours to take back (never reopen the auction mid-play)
      {
      const keep = flat.slice(0, i);
      const tricks = [];
      keep.forEach(pc => { let tr = tricks[tricks.length - 1]; if (!tr || tr.cards.length === 4) { tr = { leader: pc.seat, cards: [] }; tricks.push(tr); } tr.cards.push(pc); });
      t.play.tricks = tricks;
      sysMsg(t, `${SEAT_NAME[seat]} took back a card`);
      return;
      }
    }
  }
  // auction (or play before the opening lead)
  let i = t.auction.length - 1;
  while (i >= 0 && t.auction[i].by !== seat) { const o = occupant(t, t.auction[i].by); if (!o || o.kind !== 'robot') return false; i--; }
  if (i < 0) return false;
  t.auction = t.auction.slice(0, i);
  t.phase = 'auction'; t.contract = null; t.play = { tricks: [] };
  sysMsg(t, `${SEAT_NAME[seat]} took back a call`);
}

function canSee(t, seat) {
  const mine = mySeat(t);
  if (!mine) {
    if (t.kibSee !== false || t.phase === 'done') return true;
    // dummy is face up for everyone once the opening lead is made, except in a team match
    // (there an onlooker could pass on cards the other room hasn't played yet)
    return !t.match && t.phase === 'play' && seat === dummySeat(t) && t.play.tricks.length > 0;
  }
  if (seat === mine || t.phase === 'done') return true;
  if (t.phase === 'play') {
    const dummyUp = t.play.tricks.length > 0;
    if (seat === dummySeat(t) && dummyUp) return true;
    if (mine === dummySeat(t) && seat === t.contract.declarer && dummyUp) return true; // dummy watches partner play
    if (t.claim && t.claim.by === seat && t.claim.need.includes(mine)) return true;
    if (t.claim && t.claim.by === seat && sameSide(seat, mine)) return true;
  }
  return false;
}
