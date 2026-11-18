// Robots claiming in whole games, on the server bundle (src/game.js; run `node build.mjs` first): four robots
// bid and play boards through the table actions (A.robotStep), so a robot on lead claims when the rest is clear
// and the robot opponents answer at once. For every claim it checks that the result equals the double-dummy result
// from that point, and compares it with what the robots get by playing the board out instead.
// Usage: node tests/claimsim.js [boards]   (default 300)
const fs = require('fs'), path = require('path'), os = require('os');
Object.assign(globalThis, require('../js/engine.js'));
const B = require('../js/bots.js');
const N = +process.argv[2] || 300;

(async () => {
  const tmp = path.join(os.tmpdir(), `bridge-game-${process.pid}.mjs`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8'));
  const G = await import(tmp); fs.unlinkSync(tmp);
  G.setMe({ id: 'tester', name: 'Tester' });
  const t = G.newTable({ name: 'sim' });
  t.seed = 'claimsim'; // the same deals every run
  for (const s of SEATS) G.A.robot(t, s);
  const cms = [];
  let boards = 0, played = 0, claims = 0, errors = 0, wrongDD = 0, same = 0, better = 0, worse = 0, saved = 0, ms = 0, steps = 0, maxStep = 0;
  const byLeft = {};
  while (boards < N) {
    if (t.phase === 'done') { G.A.next(t); continue; }
    const tr = t.play.tricks[t.play.tricks.length - 1];
    const snap = t.phase === 'play' && tr && tr.cards.length === 4 ? structuredClone({ hands: t.hands, contract: t.contract, play: t.play }) : null;
    const hist = t.history.length;
    if (snap) { // the time a robot takes to decide whether to claim (measured apart; robotStep does it again)
      const by = G.controllerOf(t, G.turnSeat(t));
      const c0 = performance.now(); G.robotClaimCount(t, by, 6000); const c = performance.now() - c0;
      cms.push(c);
    }
    const t0 = performance.now();
    const r = G.A.robotStep(t);
    const d = performance.now() - t0; ms += d; steps++; if (d > maxStep) maxStep = d;
    if (r === false) { errors++; console.log('robot step failed', t.phase); break; }
    if (t.history.length === hist) continue;
    boards++;
    const rec = t.history[t.history.length - 1];
    if (!rec.contract) continue;
    played++;
    const cards = rec.tricks.reduce((n, x) => n + x.cards.length, 0);
    if (cards === 52) continue;
    // a claim ended the board: snap is the position it was made in
    claims++;
    const left = 13 - snap.play.tricks.length, decl = rec.contract.declarer;
    byLeft[left] = (byLeft[left] || 0) + 1; saved += left;
    const done = tricksWon(snap.play, snap.contract).decl;
    const dd = B.claimSolver(B.claimPos(snap), SEATS.indexOf(decl) & 1, Infinity).value();
    if (done + dd !== rec.declTricks) { wrongDD++; console.log('claim result differs from double dummy', rec.board, rec.declTricks, done + dd); }
    const p = structuredClone(snap);
    while (completedTricks(p.play).length < 13) { const s = playTurn(p.play, p.contract); applyPlay(p.play, p.contract, s, B.botPlay(p, s)); }
    const out = tricksWon(p.play, p.contract).decl;
    if (out === rec.declTricks) same++; else if (out > rec.declTricks) better++; else worse++;
  }
  const claimLines = t.chat.filter(m => / claims \d+ of /.test(m.text)).length;
  console.log(`${boards} boards, ${played} played, ${claims} ended by a robot claim (tricks left when claimed: ${JSON.stringify(byLeft)}; ${saved} tricks not played out)`);
  console.log(`claims vs double dummy: ${wrongDD} different. Played out by the robots instead: same result ${same}, declarer more ${better}, declarer fewer ${worse}`);
  console.log(`robot step time: average ${(ms / steps).toFixed(2)} ms, max ${maxStep.toFixed(1)} ms; claim lines in the chat (last 120 lines): ${claimLines}; errors ${errors}`);
  cms.sort((a, b) => a - b);
  console.log(`deciding whether to claim (${cms.length} times): median ${cms[cms.length >> 1].toFixed(2)} ms, p99 ${cms[Math.floor(cms.length * 0.99)].toFixed(2)} ms, max ${cms[cms.length - 1].toFixed(2)} ms`);
  if (errors || wrongDD) process.exitCode = 1;
})();
