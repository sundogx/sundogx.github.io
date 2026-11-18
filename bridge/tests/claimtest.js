// Checks the claim solver in js/bots.js (claimSolver, used to answer claims and for robots' own claims):
//  1. against brute-force minimax (exactTricks and a memoised minimax) on random endings of 1-5 tricks, also from the middle of a trick;
//  2. against the WebAssembly double-dummy solver (js/wasm) on endings of 6-10 tricks;
//  3. CPU time of one claim answer (claimAccept, least of three runs) on the server bundle (src/game.js, run `node build.mjs` first)
//     for 6, 7, 8 and 9 tricks left: median, p99 and max, and how often the node budget ran out;
//  4. robots' own claims (robotClaimCount): the claim always equals the double-dummy result.
// Usage: node tests/claimtest.js [endings per check]   (default 2000)
Object.assign(globalThis, require('../js/engine.js'));
const B = require('../js/bots.js');
const fs = require('fs'), path = require('path'), os = require('os');
const N = +process.argv[2] || 2000;
const rand = seededRand('claims');
let fails = 0;
const bad = (...m) => { fails++; if (fails < 10) console.log('MISMATCH', ...m); };

// A random position: a dealt board and a contract, the first cards played by the heuristic robots (or at random),
// stopped with `left` tricks to go and `extra` cards of the next trick played.
function position(left, extra, randomPlay) {
  const hands = deal(rand);
  const contract = { level: 1, strain: STRAINS[Math.floor(rand() * 5)], doubled: 0, declarer: SEATS[Math.floor(rand() * 4)] };
  const t = { hands, contract, play: { tricks: [] }, auction: [] };
  const n = (13 - left) * 4 + extra;
  for (let i = 0; i < n; i++) {
    const s = playTurn(t.play, contract), legal = legalPlays(hands, t.play, contract, s);
    applyPlay(t.play, contract, s, randomPlay ? legal[Math.floor(rand() * legal.length)] : B.botPlay(t, s));
  }
  return t;
}
const sideIx = s => SEATS.indexOf(s) & 1;
// Brute force: plain minimax over every legal card (no pruning, no grouping of equal cards), with the result of each
// exact position (who holds which card, who is to play, the trick so far) remembered.
function brute(t, claimer) {
  const strain = t.contract.strain, memo = new Map();
  const tr = t.play.tricks[t.play.tricks.length - 1], open = tr && tr.cards.length < 4;
  const h = {}; for (const s of SEATS) h[s] = remainingHand(t.hands, t.play, s);
  function rec(trick, turn) {
    if (trick.length === 4) {
      const w = trickWinner({ cards: trick }, strain), r = sameSide(w, claimer) ? 1 : 0;
      return h[w].length ? r + rec([], w) : r;
    }
    const key = SEATS.map(s => h[s].join('')).join('|') + turn + trick.map(pc => pc.card).join('');
    if (memo.has(key)) return memo.get(key);
    let cards = h[turn];
    if (trick.length) { const f = cards.filter(x => x[0] === trick[0].card[0]); if (f.length) cards = f; }
    const max = sameSide(turn, claimer);
    let best = max ? -1 : 99;
    for (const c of cards) {
      const keep = h[turn]; h[turn] = keep.filter(x => x !== c);
      const v = rec(trick.concat([{ seat: turn, card: c }]), nextSeat(turn));
      h[turn] = keep;
      best = max ? Math.max(best, v) : Math.min(best, v);
    }
    memo.set(key, best);
    return best;
  }
  return rec(open ? tr.cards.slice() : [], playTurn(t.play, t.contract));
}

(async () => {
  // 1. brute force
  let n1 = 0;
  for (let i = 0; i < N; i++) {
    const left = 1 + (i % 5), extra = Math.floor(rand() * 4), t = position(left, extra, i % 2 === 0);
    const claimer = SEATS[Math.floor(rand() * 4)];
    const ref = left <= 3 && i % 10 === 0 ? B.exactTricks(t, claimer) : brute(t, claimer);
    const S = B.claimSolver(B.claimPos(t), sideIx(claimer), Infinity), v = S.value();
    if (v !== ref) bad('brute', left, extra, v, ref);
    for (let k = 0; k <= left; k++) if (S.win(k) !== (k <= ref)) bad('win', k, ref);
    n1++;
  }
  console.log(`brute force: ${n1} endings of 1-5 tricks, ${fails} mismatches`);

  // 2. DDS
  const wasmDir = path.join(__dirname, '..', 'js', 'wasm');
  const D = require('../js/ddplay.js');
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, 'compiled.wasm')));
  const inst = await D.ddInstance(require(path.join(wasmDir, 'compiled.js')), mod);
  const dds = t => { // tricks for the side to play next, from here (the trick in progress included)
    const tr = t.play.tricks[t.play.tricks.length - 1], open = tr && tr.cards.length < 4;
    const rem = {}; for (const s of SEATS) rem[s] = remainingHand(t.hands, t.play, s);
    const first = open ? tr.leader : playTurn(t.play, t.contract);
    const r = D.ddSolveRaw(inst, { S: 0, H: 1, D: 2, C: 3, N: 4 }[t.contract.strain], SEATS.indexOf(first), open ? tr.cards.map(pc => pc.card) : [], D.ddPBN(rem));
    return { mover: playTurn(t.play, t.contract), tricks: Math.max(...r.map(x => x.tricks)) };
  };
  const f2 = fails; let n2 = 0;
  for (let i = 0; i < N; i++) {
    const left = 6 + (i % 5), extra = Math.floor(rand() * 4), t = position(left, extra, i % 3 === 0);
    const d = dds(t);
    const v = B.claimSolver(B.claimPos(t), sideIx(d.mover), Infinity).value();
    if (v !== d.tricks) bad('dds', left, extra, v, d.tricks);
    n2++;
  }
  console.log(`DDS: ${n2} endings of 6-10 tricks, ${fails - f2} mismatches`);

  // 3. timing on the server bundle: one answer to a claim (a random claim near the real result, half of them mid-trick)
  const tmp = path.join(os.tmpdir(), `bridge-game-${process.pid}.mjs`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8'));
  const G = await import(tmp); fs.unlinkSync(tmp);
  for (const left of [6, 7, 8, 9]) {
    const cases = []; // made first, so the timing isn't disturbed by the robots' play that sets them up
    for (let i = 0; i < Math.max(400, N / 4); i++) {
      const t = position(left, i % 2 ? Math.floor(rand() * 4) : 0, false);
      const by = SEATS.filter(s => s !== partnerOf(t.contract.declarer))[Math.floor(rand() * 3)];
      const d = dds(t), dv = sideIx(d.mover) === sideIx(by) ? d.tricks : left - d.tricks;
      cases.push({ t, by, dv, n: Math.max(1, Math.min(left, dv + Math.floor(rand() * 3) - 1)) });
    }
    const ms = []; let over = 0, wrong = 0, acc = 0, accOld = 0, right = 0;
    for (const { t, by, dv, n } of cases) {
      let ok, best = Infinity;
      for (let k = 0; k < 3; k++) { // CPU time (as the server's limit counts it), the least of three runs
        const c0 = process.cpuUsage(); ok = G.claimAccept(t, by, n); const c = process.cpuUsage(c0); best = Math.min(best, (c.user + c.system) / 1000);
      }
      ms.push(best);
      const r = G.claimHolds(t, by, n);
      if (r === null) over++; else if (r !== (n <= dv)) wrong++;
      if (ok && n > dv) bad('accepted a wrong claim', left, n, dv);
      if (n <= dv) { right++; if (ok) acc++; if (n <= B.claimTopTricks(t, by)) accOld++; }
    }
    ms.sort((a, b) => a - b);
    const q = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2);
    console.log(`${left} tricks left: CPU median ${q(0.5)} ms, p90 ${q(0.9)} ms, p99 ${q(0.99)} ms, max ${q(1)} ms; over the node budget ${over}/${ms.length}; wrong ${wrong}; correct claims accepted ${acc}/${right} (the old count alone: ${accOld})`);
    if (wrong) bad('wrong exact answers', wrong);
  }

  // 4. robots' own claims: the number claimed is the double-dummy result for the claimer's side
  const f4 = fails; let tried = 0, claimed = 0, all = 0; const rms = [];
  for (let i = 0; i < N; i++) {
    const t = position(2 + (i % 9), 0, false), seat = playTurn(t.play, t.contract);
    const by = seat === partnerOf(t.contract.declarer) ? t.contract.declarer : seat;
    const c0 = process.cpuUsage(); const n = B.robotClaimCount(t, by, 6000); const c = process.cpuUsage(c0); rms.push((c.user + c.system) / 1000);
    tried++;
    if (n == null) continue;
    claimed++; if (n === 13 - completedTricks(t.play).length) all++;
    const d = dds(t), dv = sideIx(d.mover) === sideIx(by) ? d.tricks : 13 - completedTricks(t.play).length - d.tricks;
    if (n !== dv) bad('robot claim', n, dv);
  }
  rms.sort((a, b) => a - b);
  console.log(`robot claims: ${claimed} of ${tried} positions (${all} for all the rest), ${fails - f4} wrong; CPU time p99 ${rms[Math.floor(0.99 * rms.length)].toFixed(2)} ms, max ${rms[rms.length - 1].toFixed(2)} ms`);
  // 5. the claim flow at a table (server bundle): who may claim, who answers, what is shown
  const f5 = fails;
  const check = (cond, msg) => { if (!cond) bad('flow:', msg); };
  // a table in the play with the given people seated (the other seats robots), `left` tricks to go
  function table(declarer, people, left, extra = 0, strain) {
    const p = position(left, extra, false);
    G.setMe({ id: 'host', name: 'Host' });
    const t = G.newTable({ name: 'test' });
    for (const s of SEATS) t.seats[s] = people[s] ? { kind: 'human', id: people[s], name: people[s] } : { kind: 'robot' };
    t.board = 1; t.phase = 'play'; t.hands = p.hands; t.play = p.play;
    t.contract = { level: 1, strain: strain || p.contract.strain, doubled: 0, declarer };
    return t;
  }
  const as = id => G.setMe({ id, name: id });
  const ddFor = (t, by) => B.claimSolver(B.claimPos(t), sideIx(by), Infinity).value();
  let flows = 0;
  for (let i = 0; i < 40; i++) {
    const left = 3 + (i % 5);
    // South (Ann) declares against two robots: right claims are accepted at once, wrong ones rejected
    let t = table('S', { S: 'ann' }, left, i % 4);
    as('ann');
    const dv = ddFor(t, 'S'), done = G.completedTricks(t.play).length, won = tricksWon(t.play, t.contract).decl;
    check(G.A.claim(t, 'S', left + 1) === false && /claim again/.test(G.takeError() || ''), 'more tricks than are left');
    check(G.A.claim(t, 'S', dv, left + 1) === false, 'stale count');
    t.undoReq = { by: 'E', need: ['S'] };
    check(G.A.claim(t, 'S', dv) === false, 'claim during an undo request'); G.takeError();
    t.undoReq = null;
    const t2 = structuredClone(t);
    G.A.claim(t, 'S', dv, left);
    check(t.phase === 'done' && t.history[0].declTricks === won + dv, 'right claim accepted');
    if (dv < left) {
      G.A.claim(t2, 'S', dv + 1, left);
      check(t2.phase === 'play' && !t2.claim && /^Robot (East|West) rejected the claim/.test(t2.chat[t2.chat.length - 1].text), 'wrong claim rejected');
      G.A.claim(t2, 'S', 0); // conceding the rest is always accepted
      check(t2.phase === 'done' && t2.history[0].declTricks === won, 'concession');
    }
    // dummy can't claim
    t = table('N', { S: 'ann' }, left, i % 4); as('ann');
    check(G.A.claim(t, 'S', 0) === false, 'dummy claims');
    // a human opponent answers; the robot opponent accepts at once; the claimer's partner (a person) isn't asked
    t = table('S', { S: 'ann', E: 'bob', N: 'cy' }, left, i % 4); as('ann');
    G.A.claim(t, 'S', ddFor(t, 'S'), left);
    check(t.claim && t.claim.need.slice().sort().join() === 'E,W' && t.claim.acc.W && !t.claim.acc.E, 'robot opponent answered, person asked');
    as('bob'); check(G.canSee(t, 'S'), 'opponent sees the claimer\'s cards');
    G.A.respond(t, 'E', true);
    check(t.phase === 'done', 'accepted by both');
    // a defender's claim: declarer (a person) answers and sees the claimer's cards, the claimer's partner doesn't
    t = table('N', { E: 'ann', W: 'dan', N: 'bob' }, left, i % 4); as('ann');
    G.A.claim(t, 'E', ddFor(t, 'E'), left);
    check(t.claim && t.claim.need.join() === 'N', 'declarer asked');
    as('bob'); check(G.canSee(t, 'E'), 'declarer sees the claimer\'s cards');
    as('dan'); check(!G.canSee(t, 'E'), 'partner doesn\'t');
    as('ann'); G.A.cancelClaim(t, 'E'); check(!t.claim && t.phase === 'play', 'withdrawn');
    flows++;
  }
  // robots claiming: find positions where the declaring robot (West, East dummy) has a claim on lead
  let rc = 0, held = 0;
  for (let i = 0; i < 400 && rc < 20; i++) {
    const t = table('W', { S: 'ann' }, 3 + (i % 5), 0);
    const lead = G.turnSeat(t); if (lead !== 'W' && lead !== 'E') continue;
    const n = B.robotClaimCount(t, 'W', 6000); if (n == null) continue;
    rc++;
    const tu = structuredClone(t); tu.timeUp = true; G.A.robotStep(tu);
    check(!tu.claim && tu.phase === 'play', 'no robot claim when time is up');
    G.A.robotStep(t);
    check(t.claim && t.claim.by === 'W' && t.claim.tricks === n && / \(robot\) claims /.test(t.chat[t.chat.length - 1].text), 'robot claims');
    check(t.claim && t.claim.acc.N && !t.claim.acc.S, 'robot partner of the person accepts; the person is asked');
    as('ann'); check(G.canSee(t, 'W'), 'the person sees the robot claimer\'s cards');
    G.A.respond(t, 'S', false);
    const before = t.play.tricks.reduce((k, x) => k + x.cards.length, 0);
    G.A.robotStep(t);
    check(!t.claim && t.play.tricks.reduce((k, x) => k + x.cards.length, 0) === before + 1, 'after a rejection the robot plays on');
    // a defender robot whose partner is a person doesn't claim for them
    const d = table('S', { E: 'ann' }, 3 + (i % 5), 0); // West's partner East is Ann
    if (G.turnSeat(d) === 'W' && B.robotClaimCount(d, 'W', 6000) != null) { held++; G.A.robotStep(d); check(!d.claim, 'robot claims for a person'); }
  }
  check(rc >= 10, 'found robot claims to test');
  console.log(`table flow: ${flows} claim flows and ${rc} robot claims (${held} held back for a person partner), ${fails - f5} failures`);

  console.log(fails ? `FAILED: ${fails} mismatches` : 'claim solver ok');
  if (fails) process.exitCode = 1;
})();
