// BEN against the app's robots on the same deals, as a team match: room 1 BEN sits N-S, room 2 BEN sits E-W.
// The app's robots bid with botCall and play with the page's double-dummy sampler (js/analysis.js RobotDD settings).
// Usage: node ben/tools/benvs.mjs from to [seed=benvs]   prints one JSON line per board (BEN's IMPs, both results)
// OPP=ben: the other side is BEN too (base settings) and the BEN side gets NEW='{"bidms":..,"adjK":..,"playms":..}'.
// DDSCORE=1: no play, each contract scored with its double-dummy tricks (bidding compared with less noise).
// Env: DET=1 fixed BEN sample counts (reruns repeat exactly); BIDK={..} knobs of js/bidding.js for the app;
//   BOARDS=a,b only those boards.
// Env: PLAYMS, BIDMS, LEADMS budgets for BEN; BENPLAY=0 lets the app play for BEN too (bidding only compared).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { setup, D, B } from './benenv.mjs';
const require = createRequire(import.meta.url);
if (process.env.BIDK) globalThis.BID_K = JSON.parse(process.env.BIDK); // knobs of js/bidding.js for the app's robots
const R = require('../../js/bots.js'); globalThis.shown = R.shown; Object.assign(globalThis, R);
const [from, to, seed = 'benvs'] = [+process.argv[2] || 0, +process.argv[3] || 10, process.argv[4]];
const { nn, dd, inst } = await setup();
const create = require('../../js/wasm/compiled.js');
const solve = D.ddSolver(create, await WebAssembly.compile(readFileSync(new URL('../../js/wasm/compiled.wasm', import.meta.url))));
const CUR = { k: 24, minK: 8, lead: 'conv', leadTol: 30,
  declarer: { pool: 96, weigh: 1, wOpp: 0.8, relax: 0.05, stop: 1 }, defender: { pool: 96, weigh: 1, wOpp: 0.8, wPart: 0.8, relax: 0.05, stop: 1 } };
const BIDMS = +process.env.BIDMS || 1100, LEADMS = +process.env.LEADMS || 1500, PLAYMS = +process.env.PLAYMS || 2400;
const DDSCORE = !!process.env.DDSCORE, ddMemo = new Map();
// DET=1: BEN bids with fixed sample counts instead of time budgets, so reruns repeat exactly (for A/B tests of the app's bidding)
const DETB = process.env.DET ? { ms: Infinity, budget: Infinity, maxBoards: 4000, step: 2000, need: 30 } : {};
const benPlay = process.env.BENPLAY !== '0', OPP = process.env.OPP === 'ben', NEW = JSON.parse(process.env.NEW || '{}');
const opt = v => v === 'new' ? { bidms: NEW.bidms || BIDMS, leadms: NEW.leadms || LEADMS, playms: NEW.playms || PLAYMS, x: NEW } : { bidms: BIDMS, leadms: LEADMS, playms: PLAYMS, x: {} };
async function room(hands, dealer, vul, side, rand) { // side(seat) -> true for the BEN (variant) side
  const ben = s => side(s) ? 'new' : OPP ? 'base' : false;
  const auction = [];
  while (!auctionOver(auction)) {
    const s = auctionTurn(dealer, auction);
    let call;
    if (ben(s)) { const O = opt(ben(s)); call = (await B.bid(nn, dd, { hand: hands[s], seat: s, dealer, auction: auction.map(a => ({ call: a.call, by: a.by })), vul }, { ...O.x, ms: O.bidms, budget: O.bidms * 2.4, t0: B.now(), ...DETB })).call; }
    else call = R.botCall(hands[s], s, dealer, auction, vul).call;
    if (!isLegalCall(dealer, auction, call)) { call = 'P'; }
    auction.push({ call, by: s });
  }
  const ct = finalContract(auction);
  if (!ct) return { auction: auction.map(a => a.call).join(' '), score: 0 };
  if (DDSCORE) { // contracts scored double dummy: bidding only, no play noise
    const k = ct.strain + ct.declarer;
    if (!ddMemo.has(k)) ddMemo.set(k, B.declTricks(dd, 'NESW'.split('').map(x => hands[x]), ct.strain, 'NESW'.indexOf(ct.declarer)));
    const tr = ddMemo.get(k), sc = scoreContract(ct, tr, vul);
    return { auction: auction.map(a => a.call).join(' '), ct: ct.level + ct.strain + (ct.doubled ? 'X'.repeat(ct.doubled) : '') + ct.declarer, tr, ns: sameSide(ct.declarer, 'N') ? sc : -sc };
  }
  const t = { hands, auction, contract: ct, vul, dealer, play: { tricks: [] } };
  for (let i = 0; i < 52; i++) {
    const s = playTurn(t.play, ct), view = D.ddView(t, s), legal = D.ddLegal(view);
    let card = legal[0];
    if (legal.length > 1) {
      if (ben(s) && benPlay) {
        const O = opt(ben(s));
        if (i === 0) card = (await B.lead(nn, dd, { hand: view.known[s].slice(), seat: s, dealer, auction: auction.map(a => a.call), vul, contract: { ...view.contract } }, { ...O.x, ms: O.leadms, budget: O.leadms * 2.4, t0: B.now() })).card;
        else { const r = await B.play(nn, j => D.ddRun(inst, j), view, { ...O.x, ms: O.playms }); card = r && r.card; }
      } else {
        const o = { ...CUR, prefer: R.botPlay(t, s), rand };
        const r = await D.ddChoose(D.ddView(t, s, o), solve, o); card = r ? r.card : o.prefer;
      }
      if (!legal.includes(card)) { console.error('illegal', card, legal); card = legal[0]; }
    }
    applyPlay(t.play, ct, s, card);
  }
  const tr = tricksWon(t.play, ct).decl, sc = scoreContract(ct, tr, vul);
  return { auction: auction.map(a => a.call).join(' '), ct: ct.level + ct.strain + (ct.doubled ? 'X'.repeat(ct.doubled) : '') + ct.declarer, tr, ns: sameSide(ct.declarer, 'N') ? sc : -sc };
}
const list = process.env.BOARDS ? process.env.BOARDS.split(',').map(Number) : null; // BOARDS=3,17,..: only these
for (let g = from; g < to; g++) {
  if (list && !list.includes(g)) continue;
  const rand = seededRand(seed + ':' + g), hands = deal(rand), dealer = boardDealer(g + 1), vul = boardVul(g + 1);
  const t0 = Date.now(); ddMemo.clear();
  const r1 = await room(hands, dealer, vul, s => s === 'N' || s === 'S', seededRand(seed + ':r1:' + g));
  const r2 = await room(hands, dealer, vul, s => s === 'E' || s === 'W', seededRand(seed + ':r2:' + g));
  const n1 = r1.ns || 0, n2 = r2.ns || 0;
  console.log(JSON.stringify({ g, imp: toImps(n1 - n2), r1, r2, s: ((Date.now() - t0) / 1000) | 0 }));
}
process.exit(0);
