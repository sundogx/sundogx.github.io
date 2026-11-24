# Heuristic play round 4 (botPlay in bridge/js/bots.js)

Baseline: `bridge/tests/fixtures/basebots4.js` (bots.js at a5bbe8a), now the default `BASE` of `tests/heurstim.js`.

## Tools added
- `tests/heurstim.js`: `OVER=k` makes every contract doubled, at the level where declarer needs k tricks more
  than the double-dummy result (an overbid, doubled; the auction stays the robots' own). Use it to measure play
  in doubled contracts, which the robots' own auctions rarely reach (`OVER=0` doubled and exactly makeable).
- `NEWEXP=a,b` sets `globalThis.BOT_EXP` for the new heuristic only; `EXP('a')` in bots.js reads it (no
  experiments are left in the code).

## Kept (defence)
1. Cashing the setting tricks (`setcash`, rule L103) only when the sure winners are exactly the tricks that beat
   the contract, and never in a doubled contract. With more winners than needed, or doubled, cashing early mostly
   set up declarer's cards (leak report under OVER=2: L103 lost 0.069 tricks a board, 15% of its decisions wrong).
   dev, 2,000 boards: OVER=1 +0.068 ± 0.054 IMPs (+0.023 tricks), OVER=2 +0.113 ± 0.054 (+0.022), normal neutral.
2. Trump lead against a crossruff (`trX`): in the defenders' fitted switch, +1.5 to trumps when declarer has shown
   out of a side suit, dummy has trumps and is short (<= 1) in a suit we (with partner) hold 3+, and we hold no
   trump honour that isn't a master. dev on top of 1: normal +0.03 IMPs, OVER=1 +0.04, OVER=2 +0.04.

## Held-out (seed test, 3,971 boards, against basebots4; declarer side unchanged)
`cd bridge && [OVER=k] node tests/heurstim.js 4000 cmp test`, defenders changed:

| Contracts | IMPs a board | Tricks a board | Boards changed |
|---|---|---|---|
| Robots' own auctions | +0.011 ± 0.012 | +0.002 ± 0.003 | 66 |
| Doubled, makeable exactly (OVER=0) | +0.002 ± 0.030 | +0.002 ± 0.004 | 152 |
| Doubled, one trick overbid (OVER=1) | +0.056 ± 0.034 | +0.013 ± 0.005 | 243 |
| Doubled, two tricks overbid (OVER=2) | +0.137 ± 0.038 | +0.024 ± 0.006 | 386 |

Timing unchanged (same mean/median/p99 as basebots4 on 400 boards, half of them doubled). npm test and
`node build.mjs` pass. Not pushed, not deployed, CACHE not bumped.

## Dropped (measured on dev, 2,000 boards)
- No setcash at all: OVER=2 as good, but normal contracts -0.012 IMPs; setcash only when dummy has a running suit
  or the end is near: same as dropping it.
- Trump lead bonus without the crossruff condition (declarer known void): normal -0.03 (+1.5) / -0.10 (+3) IMPs.
  +3 with the condition: no better than +1.5.
- High-low from a doubleton in partner's suit with trumps (ruff signal): neutral (+0.001 tricks), 11 boards changed.
- Second-seat `set2` off in doubled contracts: neutral.
- Declarer in a doubled contract three or more tricks short: cash winners instead of developing (`dblCash`):
  dev OVER=2 +0.017 ± 0.011 tricks, dev2 -0.006 ± 0.010; also with four or more short. Noise.

## Next steps
- The big leaks (leak report, 2,000 boards) are unchanged: declarer's leads in suit contracts 0.50 tricks a board
  (dlFit 0.17, drawTrump 0.10, drawTrumpToward 0.07), defenders' switches 0.33 suit / 0.20 NT, opening leads
  (js/leads.js, not botPlay) 0.24. Dumps (`DUMP='decl suit why=drawTrump'`) show drawing trumps with a sequence
  into the opponents' higher trumps when side winners should be cashed first, and drawing when declarer should
  crossruff.
- Signals: robots' discards are always the lowest card of the chosen suit (so partner reads them as discouraging);
  an encouraging discard (high spot in the suit we want led) was not tried this round.
- Refit the switch weights with the trX feature in swF (heurfit switch) instead of the fixed +1.5.
- When the bidding agent's penalty doubles land, rerun `OVER=1 node tests/heurstim.js 4000 cmp test` and the
  normal run: real doubled contracts will be a mix of OVER=0..2.
