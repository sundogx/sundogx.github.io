# Round 10 bidding11: narrower xlong (dropped), two competitive holes fixed

Status: DONE (~115 min). Branch r10-bidding11 from main 56bd996. Not pushed, merged or deployed; CACHE not bumped.
Changed: bridge/js/bidding.js (two rules), tests/fixtures/basebid11.js (new baseline = bidding at main 56bd996).
Not touched: README, tests/bidddsim.js usage line (a merger may add "basebid11: before the eleventh round, 56bd996").
All numbers below are against basebid11, i.e. what this branch adds to main.

## Kept
1. `r3g` (responder over interference, js/bidding.js ~line 1100): partner opened 1M and they jumped to the three level
   in a lower suit (1S 3C, 1H 3D): no cue bid is left below 3M, so responder with exactly three trumps and 13+ support
   points now bids 4M. Before, the only strong raise needed four trumps and 3M was "6-10": 1S 3C 3S P P P on
   Q87.AQ84.AQT943.- (13 tricks in spades; bidpar r6b board 1). Switch off with `--off=r3g`.
2. `xown` (doublerRebid, ~line 1416): after our takeout double and partner's non-forcing advance, the doubler's own
   5+ suit is counted with its length (HCP + length over five), and a major can go to game: at the four level when
   partner was pushed there (3D X P 4C P 4H on QJ4.AKQJ87.AQ.AT, which passed 4C before), or as a jump with six cards
   and 21+. A six-card suit no longer needs shortness in partner's minor (3C X P 3D P 3S). Knobs `--k=x4:20`
   (default 20; 18 was equal on three sets, worse on r6hold), `xj:21`, `xrb:18`; switch off with `--off=xown`
   (note: `--off=xreb` is an older key that switches off the whole doublerRebid table).

### Numbers
bidddsim, robots vs robots, IMPs a board (boards that differ):

| set | both | r3g only | xown only |
|---|---|---|---|
| r6a 4000 (tuning) | | -0.002 ± 0.002 (1) | +0.004 ± 0.006 (9) |
| r6b 4000 (tuning) | | +0.002 ± 0.001 (2) | +0.006 ± 0.006 (12) |
| r6hold 4000 (tuning) | | +0.006 ± 0.004 (3) | +0.007 ± 0.005 (11) |
| r7hold 4000 (tuning) | | +0.004 ± 0.004 (5) | +0.004 ± 0.004 (9) |
| **r9hold 4000 (held out)** | +0.003 ± 0.006 (9) | +0.003 ± 0.002 (3) | -0.000 ± 0.005 (6) |
| **r9b 3000 (held out)** | +0.011 ± 0.008 (8) | +0.002 ± 0.002 (1) | +0.009 ± 0.008 (7) |
| **r10a 4000 (held out)** | +0.005 ± 0.005 (10) | +0.003 ± 0.003 (4) | +0.002 ± 0.004 (6) |

Held out, 11,000 boards: **+0.006 ± 0.004 IMPs a board** (27 boards differ, +65 IMPs, about +2.4 per changed board).
Small (the situations are rare) but positive on every set for xown+r3g together.
- bidhuman (robot partner of a human), all deviation types, per deviation: r6a +0.033 ± 0.013, r6b +0.004 ± 0.006,
  r9b +0.034 ± 0.013, r9hold +0.010 ± 0.012, r10a +0.015 ± 0.010 (sum +237 IMPs over 12,536 deviations). Almost all from
  xLong (a human doubles with a long suit; the human then rebids by the system, which now shows the suit with game
  values: r6a xLong +0.46 ± 0.20 on 12 boards). 0 illegal calls/errors, 0 forcing calls passed.
- bidoverbid (reckless human): r10a +0.009 ± 0.007 (sum +61), r9hold +0.025 ± 0.009 (sum +159) per overbid.
- npm test, build, sim.js ("errors":0, "long":0) pass.

## Tried, measured negative (not shipped)
- **Narrowing xlong to 2-level or jump rebids** (the round-9 suggestion). It recovers the one bidoverbid deal (r10a vs basebid10:
  sum -35 -> 0, 1 board), but bidhuman shows the human xLong doublers mostly rebid at the three level without a jump (X, partner
  2S, then 3H on eight hearts), so the narrow rule gives back most of round 9's gain: against main, bidhuman per deviation
  r6a 0.000, r6b -0.024 ± 0.011 (xLong -0.40 ± 0.19), r6hold -0.023 ± 0.011. A middle version (also keep the void for any
  major rebid; only a non-jump 3-level minor rebid keeps the double's support): r6a +0.005, r6b -0.007, r6hold -0.009
  (sum -29) and bidoverbid r10a only +7. Both dropped; xlong stays as round 9 left it.

## Where the losses are (for the next round)
- bidloss r6a (4000): game when slam makes is still the largest (1,610 + 622 [strain] of 8,633 IMPs), spread over many
  sequences; the biggest single group is 1N 3N P (11 deals, 125 IMPs: 28-31 combined, 6NT or 6m makes double dummy).
  Mostly hindsight; quantitative 4NT is already at 16-17 (ntq knob, tuned before).
- bidpar contested "part made, par game" (r6b, about 1,300 IMPs) is spread thin, but a few kinds recur in the worst boards:
  - 1S P 1N 2D: opener with 20 HCP and 5-4 in the majors bids 2S (natural(): with no fit and target 3 it bids the
    cheapest level, js/bidding.js natural() `const lvl = target >= gl ? target : cheapS`). A strong 3H/X is missing.
  - 2D X P 2N(lebensohl) P: the doubler with 22 HCP must answer 3C (compMore, "Forced reply to lebensohl" accepts
    any hand, MM(0, 37)) and partner passes; a strong doubler should bid on instead of completing the relay.
  - Reopening: 1H 2C P P X P 2S P P with 18 HCP and four spades (opener passes a forced 2S).
- The meaning of the new 4M by the doubler at the four level says 17+ (MM(cx === 4 ? 17 - bal ...)) while the hand test
  needs 20 with length; harmless (partner passes game) but could be tightened.
- DD caches in the OS temp folder: r9b grew past 3000 deals (a stopped 4000-board run solved some extra deals; all r9b numbers here use 3000). r8hold (about 100 deals) and r10hold (about 1,600) are partial.
