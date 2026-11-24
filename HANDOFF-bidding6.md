# Bidding round 6: doubling people who overbid

Status: DONE. Branch of this worktree, on top of a5bbe8a. Not pushed or deployed, CACHE not bumped.
Changed: js/bidding.js, tests/bidoverbid.js (new), tests/fixtures/basebid6.js (= js/bidding.js at a5bbe8a),
tests/bidddsim.js (doc line), README bidding section.

## What changed (js/bidding.js)
- `judgeX` / `defTricks` / `pointShares` / `penaltyGain`: a penalty double by judgement. It applies only when
  dblMeaning already says 'xpen' (high-level doubles, 3NT, after our side bid, sacrifices), so the takeout,
  negative, responsive and reopening doubles are unchanged. The defence estimate is a linear fit to the
  double-dummy defence on about 15,000 decisions (features: my trump tricks, side tricks, partner's expected
  points, my HCP, trump length, shortness, their shown trump length, level, slam, whether partner bid or passed).
  Partner's points: the shown ranges of partner, LHO and RHO, scaled to the points I can't see, so a game the
  opponents' calls don't support leaves partner more. Doubles when the expected IMP gain (their tricks
  normal around 13 - D, sd 1.5, 1 for slams; doubled vs undoubled at the vulnerability) is >= 3.5 IMPs (`pxm`).
- Applied in chooseCall: instead of a pass; instead of a competitive bid/sacrifice with +2 more (`pxb`); in a
  game-forcing auction +3.5 more (`pxf`, the forcing-pass case).
- `xpass2`: partner leaves a two-level penalty double in (not when void in their suit with a 6-card suit, not
  in a GF auction, not with 25+ combined). Three-level and up was already left in.
- `xconv` (`convertX`): advancer of a takeout/reopening double passes it (converts) with 4+ trumps, two honours,
  and a defence estimate one and a half tricks over what's needed (trap pass).
- Fallback penalty doubles at the 3-level and up are explained "Penalty: expects to beat the contract".
- Robustness: tablesFor guarded against a null partner call (fuzz found it after the new doubles).

## Numbers (held out, seed r6hold, 4000 boards; tuned on r6a and r6b)
- bidoverbid vs basebid6: +3.10 ± 0.08 IMPs per overbid (6,346 overbids). Per kind: jump4M +2.6, jump5m +6.6,
  ovc3 +3.3, ovc2 +0.8, nt3 +6.2, psych +1.8, raise4 +3.1, bidOn +2.2, compete +2.0.
- bidddsim robots vs robots: +0.180 ± 0.039 vs basebid6 (462 boards differ), +0.190 ± 0.040 vs basebid5.
  (Tuning sets: r6a +0.26, r6b +0.16.)
- bidhuman (2000 boards r6hold, --base=basebid6): +0.04 ± 0.04 a deviation, 0 errors, 0 forcing passes.

## Dropped / measured
- Lower IMP bars (0.7, 1.2, 1.8, 2.5): overbid set about the same (+2.86..2.89 on r6a) but robots vs robots
  0 to +0.15 instead of +0.21 (r6a), -0.00 at 1.8 on r6b. 5.0: robots same, overbid -0.26.
- An extra bar for partscores that would be doubled into game (`pxg` 1.5..3): worse on both; removed.
- The first, hand-written defence estimate (before the fit) was biased about 0.5 tricks low in suits, 1.1 in NT.

## Next steps
- Against robots the fitted defence is about 0.3 tricks optimistic (their contracts are sounder than a human's);
  a feature for "the contract is consistent with what they showed" might let the bar come down for humans.
- The judgement double keeps the meaning 10+ / 3+ trumps; the real doubles can be lighter (partner-based). A
  meaning closer to what it shows would help card-play sampling.
- Doubles of 4♥ (or lower) when our side hasn't bid are still takeout; no "card-showing" double at the 4 level.
- Refit the weights with `node tests/bidoverbid.js 4000 <seed> --off=pjx --penlog=file.json` (fit script was
  numpy least squares; trivial to redo).
