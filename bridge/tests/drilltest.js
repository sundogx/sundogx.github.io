// "Your mistakes" helpers (js/drills.js). node tests/drilltest.js [boards=300]
// Random legal boards: the problems found on a board (whose cards, which kind), the position before each card
// against the engine's own legal plays and trick count, the Leitner grading and the practice queue, merging.
Object.assign(globalThis, require('../js/engine.js'));
const D = require('../js/drills.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
const N = +process.argv[2] || 300;
const rnd = seededRand('drills');
const pickOf = a => a[Math.floor(rnd() * a.length)];
let probs = 0, positions = 0;
for (let n = 0; n < N; n++) {
  const hands = deal(rnd), dealer = SEATS[n % 4], decl = SEATS[(n >> 2) % 4];
  const contract = { level: 1 + (n % 7), strain: STRAINS[n % 5], declarer: decl, doubled: 0 };
  const play = { tricks: [] };
  const stop = n % 3 ? 52 : 1 + Math.floor(rnd() * 51); // some boards end in a claim part way
  for (let k = 0; k < stop; k++) { const s = playTurn(play, contract); applyPlay(play, contract, s, pickOf(legalPlays(hands, play, contract, s))); }
  const h = { board: n + 1, dealer, vul: 'None', hands, contract, tricks: structuredClone(play.tricks), auction: [] };
  const seat = SEATS[(n >> 4) % 4];
  const role = seat === decl ? 'declarer' : partnerOf(decl) === seat ? 'dummy' : 'defender';
  const r = { id: 'p::' + n, date: 1e12 + n, seat, role, h };
  const flat = D.drFlat(h);
  ok(flat.length === stop, 'flat length');
  // a fake finished review: every third card cost a trick
  const en = { done: true, res: flat.map((pc, i) => i % 3 === 1 ? { loss: 1 + (i % 2), best: ['SA'] } : { loss: 0, best: [] }) };
  const found = D.drExtract(r, en);
  for (const it of found) {
    probs++;
    const pc = flat[it.i];
    ok(en.res[it.i].loss > 0 && it.loss === en.res[it.i].loss && it.card === pc.card, 'problem from a costly card');
    if (role === 'declarer') ok(sameSide(pc.seat, seat) && it.kind === 'decl', 'declarer: your or dummy\'s card');
    else ok(role === 'defender' && pc.seat === seat && it.kind === (it.i === 0 ? 'lead' : 'def'), 'defender: your card');
  }
  if (role === 'dummy') ok(!found.length, 'dummy has no problems');
  if (role === 'defender') ok(found.length === flat.filter((pc, i) => i % 3 === 1 && pc.seat === seat).length, 'all of yours found');
  // the position before each card matches the engine replayed to that point
  for (let i = 0; i < flat.length; i += 1 + (n % 3)) {
    positions++;
    const pos = D.drPosition(h, i), sub = { tricks: [] };
    for (let j = 0; j < i; j++) applyPlay(sub, contract, flat[j].seat, flat[j].card);
    const mover = playTurn(sub, contract);
    ok(pos.mover === mover && flat[i].seat === mover, 'mover');
    ok(pos.legal.slice().sort().join() === legalPlays(hands, sub, contract, mover).slice().sort().join(), 'legal cards');
    ok(pos.legal.includes(flat[i].card), 'the card played is legal');
    const tw = tricksWon(sub, contract);
    ok(pos.decl === tw.decl && pos.def === tw.def, 'tricks so far');
    ok(SEATS.every(s => pos.hands[s].length === remainingHand(hands, sub, s).length), 'cards left');
    const cur = currentTrick(sub);
    ok(pos.trick.map(x => x.card).join() === (cur ? cur.cards.map(x => x.card).join() : ''), 'trick so far');
  }
}
ok(probs > 100 && positions > 1000, `enough cases (${probs} problems, ${positions} positions)`);

// Leitner boxes and the queue
const now = 5e12;
const mk = (k, kind, loss, date) => ({ k, rec: 'r', i: 0, kind, loss, date, box: 0, due: 0, tries: 0, right: 0, best: [] });
const items = [mk('a', 'decl', 1, 1), mk('b', 'def', 3, 2), mk('c', 'lead', 2, 3), mk('d', 'decl', 2, 4)];
let q = D.drQueue(items, 'all', now, false);
ok(q.map(x => x.k).join() === 'b,d,c,a', 'costliest first, then newest: ' + q.map(x => x.k));
ok(D.drQueue(items, 'decl', now, false).map(x => x.k).join() === 'd,a', 'kind filter');
D.drGrade(items[1], true, now);
ok(items[1].box === 1 && items[1].due === now + D.DR.GAP[1] && items[1].right === 1, 'right: next box, later');
q = D.drQueue(items, 'all', now, false);
ok(!q.some(x => x.k === 'b'), 'not due yet');
ok(D.drQueue(items, 'all', now, true).pop().k === 'b', 'practise anyway: later ones at the end');
D.drGrade(items[1], false, now);
ok(items[1].box === 0 && items[1].due === now && items[1].tries === 2, 'wrong: box 0, back soon');
for (let k = 0; k < 3; k++) D.drGrade(items[0], true, now);
ok(D.drLearned(items[0]) && !D.drQueue(items, 'all', now + 1e12, true).some(x => x.k === 'a'), 'three right: learned');
D.drGrade(items[0], true, now); ok(items[0].box === D.DR.LEARNED, 'box stays at the top');
// merging keeps progress and drops the oldest over the limit
const merged = D.drMerge(items, [mk('a', 'decl', 1, 1), mk('e', 'def', 1, 9)], 4);
ok(merged.length === 4 && merged[0].k === 'e' && !merged.some(x => x.k === 'a'), 'merge: newest kept');
ok(D.drMerge(items, [mk('b', 'def', 3, 2)], 10).find(x => x.k === 'b').tries === 2, 'merge: progress kept');
console.log(process.exitCode ? 'drills: FAILED' : `drills: ${probs} problems, ${positions} positions, grading and queue ok`);
