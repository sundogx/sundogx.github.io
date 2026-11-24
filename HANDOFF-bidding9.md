# Bidding round 9: competitive holes found from bidpar's worst contested boards

Status: DONE (~110 min). Branch worktree-agent-aeee270ae68a0143e, on top of ed3bb87. Not pushed, merged or deployed; CACHE not bumped.
Changed: bridge/js/bidding.js (three rules), bridge/README.md (Competition bullet, ninth-round paragraph). Nothing in bridge/ben/, botCallSrc untouched.
Baseline fixture: tests/fixtures/basebid9.js (already in the repo: the bidding at 453c984, same as ed3bb87 apart from botCallSrc).

## Kept (js/bidding.js)
1. `lott22` (natural(), "law of total tricks"): with total >= 22 (my valuation + partner's expected points) compete one level higher
   than fitLen - 6, so an 8-card fit goes to the three level. Knob `--k=lt:N` (default 22), `--off=lott22`.
2. `ntovs` (compDirect, over their 1NT): never overcall naturally in a suit the opponents bid (1S P 1N 2S on KJxxxx went -1400).
   The rule stays in the table with its hand test failing, so the same call by someone else is still read as natural
   7-15 / 5+. That reading matters: removing the rule from the table instead measured about half the gain.
3. `xxlong` (runFromXX): after our takeout double is redoubled, pass with 5+ of their suit when no unbid suit is longer
   than 4 (before: only with 3 of AKQJT; 4-HCP hands ran to 2m on three cards and went -1400).

## Numbers (bidddsim vs basebid9, IMPs a board; boards that differ in brackets)
(diff) = all three minus the other column.

| set | all three | lott22 only (--off=ntovs,xxlong) | ntovs+xxlong only (--off=lott22) |
|---|---|---|---|
| r6a 4000 | +0.037 ± 0.016 (93) | +0.008 (diff) | +0.029 |
| r6b 4000 | +0.041 ± 0.015 (85) | +0.015 | +0.027 |
| r6hold 4000 | +0.030 ± 0.014 (81) | +0.010 | +0.021 |
| r7hold 4000 | +0.019 ± 0.016 (93) | +0.017 | +0.003 |
| **r9hold 4000 (new, held out)** | **+0.008 ± 0.012 (82)** | +0.008 (diff) | -0.000 |
| **r9b 3000 (new, held out)** | **+0.018 ± 0.014 (59)** | +0.014 (diff) | +0.001 |
The four older sets were used to choose the rules and the 22 threshold (lt 20/21/23 were a little worse). Held out, 7,000 boards:
**+0.012 ± 0.009**. The gap between tuning and held out is mostly ntovs/xxlong, which only held up on the older sets.
- bidoverbid (reckless human): +0.058 ± 0.013 (r6a), +0.073 ± 0.014 (r7hold), +0.065 ± 0.016 (r9hold), +0.039 ± 0.013 (r9b) per overbid
  (the "compete" overbids gain about +0.3 each).
- **bidhuman: negative, almost all from lott22**: per deviation r6a -0.024, r6b -0.010, r6hold 0.000, r7hold +0.003, r9hold -0.020,
  r9b -0.024 (all ± 0.012). With --off=lott22: -0.003, -0.003, +0.003, +0.006, 0.000, -0.007. So lott22 costs about -0.012 per deviation
  (about -0.008 a board) when the robot partners a human who opens light or with a four-card major: the robot credits partner with
  full values and competes to the three level. Against robots it gains about +0.012 a board, positive on all six sets. The owner may prefer to
  drop it: delete the `+ (!BID_OFF('lott22') && total >= ...)` term in natural().
- 0 errors in bidhuman, npm test, sim.js, describe.

## Tried, measured flat or negative (not shipped)
- Knob sweeps on r6a/r6b: sp 29/31, sd 1/3, n6 30, nts 30, ntq 30: all within ±0.02, mixed sign (slam knobs are tuned).
- Lighter balancing over their 1x-2x fit (bal2 1..3 HCP lighter, 3-level balance with 6 cards): -0.003..-0.009 on both sets.
- Slow (3M, slam-interest) raise in GF auctions with slamVal >= 30 - k instead of only slam values (k = 2..4): r6a +0.018..+0.025,
  r6b +0.012..+0.017, r6hold +0.003..+0.008, r7hold -0.013..-0.020. After the slow raise opener's RKCB is too keen on 29-30 points.
- Weak-two responses: game raise on 13-14 with three trumps, a weak 3-trump game raise when favourable, 3M raise only to 12, a 3NT
  on 14 with stoppers: all within ±0.004.
- Takeout-double shortness test also requiring their other bid suit short (`xshort`): -0.000 averaged over four sets.
- LOTT +1 level when favourable (-0.037 / -0.015), -1 level when unfavourable with 8 trumps (0 / -0.006); totLo >= 20 instead of total >= 22
  (same for robots, worse in bidhuman: -0.031 on r6a).
- Overcalling a good six-card suit at the one/two level instead of a takeout double (under 17 points): tuning +0.012, +0.014, -0.002,
  +0.021, but held out -0.005 (r9hold) and -0.003 (r9b). At the three level too it was worse (over weak twos: 3D on six went -1100,
  3C instead of X missed 7NT). Dropped.
- Doubler bidding a new 5+ major at the four level over a forced 4m advance (23 HCP passed 3D X 4C): +0.000 (2 boards a set).

## Where the losses are (for the next round)
- bidloss: the biggest constructive loss is still game when slam makes (about 2,200 IMPs on 4,000 boards); with 31-32 combined HCP slam
  makes 85-90% double dummy but is bid ~40-50% of the time. Knobs don't help: the misses come from auctions with no table (natural()):
  responder's second call in 2/1 GF auctions (1S 2D 2N, 1D 2C 2H, 1H 2D 2H ...), 2C-3x positive (opener rebids 3NT with AKQJTx).
  Scratch tool idea: group losses by the first call with botCallSrc() !== 'table' (natloss.js in the scratchpad did this; about 360
  constructive deals of 4,000 have one, mean loss 5.5-5.9 against 4.5 overall).
- 1S 2H 3S (sets trumps) 4H?: responder with a singleton in partner's self-set suit bids his own suit and opener with a heart void passes;
  natural() ignores `agree` from a 6-card suit with a 1-card fit.
- bidpar contested: missed games after partner competed (an 18-count with three trumps passing 3H after partner's free 2S).
- DD caches in the OS temp folder: r9hold (4000) and r9b (3000) are new and were used as held-out once each here (r9hold also saw the
  x6 and ntovs-refinement checks, so r9b is the cleaner one).
