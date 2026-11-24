# Bidding round 7: contract consistency, 4-level doubles

Status: DONE (time-boxed, ~45 min). Branch of this worktree on top of 14aea9f. Not pushed or deployed, CACHE not bumped.
Robot bidding is UNCHANGED in play: both tried changes measured no better and are off or removed.
Changed: js/bidding.js (logging + an opt-in knob only), tests/bidoverbid.js (penlog tags), tests/bidddsim.js (doc line),
tests/fixtures/basebid7.js (new, = js/bidding.js at 14aea9f), README bidding section (one paragraph).

## Step 1: "the contract fits what they showed" (dropped)
- `fitsShown(ctx, h)` computes consistency features: points/cards over-claimed (`ptOver`, `trOver`, `cardOver`), shortfall of
  their shown points for the level (`shortHi`, `shortMid`), whether the call that set the contract is a system table call
  (`tbl`), jump size, bidder's shown range, passed hand (`bPH`), declarer's partner silent (`pardSilent`), number of their
  bids, whether we bid, bidder = declarer (`sameBid`). Only computed when logging or with `--k=fitx:1`.
- Residual (DD defence minus estimate) on r6a, 4000 boards: robot contracts suit -0.30 / NT -0.16 tricks; human-side
  contracts +0.08 / +0.34. But within every bucket of every feature the human/robot gap stays ~0.35: the features don't
  separate them (rmse 1.493 -> 1.482). The gap comes from the unseen hands.
- Fitted correction `fitAdj` (pardSilent +0.3, bPH +0.16, sameBid -0.27 in suits ...), applied on r6b: -0.033 ± 0.016
  IMPs/overbid at bar 3.5, -0.022 ± 0.015 at bar 3. Off by default (`--k=fitx:1` turns it on).
- Harness gotcha found: the baseline fixture also pushes to BID_PENLOG, so round 6's penlog mixed in baseline rows.
  New rows carry `lbBy`; drop rows without it. Rows also carry `hum` (contract bid by the human's side).
  Note BID_K/BID_OFF apply to the base fixture too: `--k=pxm:3` changes both sides (compares 0 vs 0).

## Step 3: card-showing double of 4-level (dropped)
- Advancer passes partner's takeout X of 4♥/4♣/4♦ with defence (defTricks - (7-lv) >= 0.5) and no 6-card suit, 5-card
  major or 5-5. r6b overbid: +0.004 ± 0.005 (12 deals differ, same at threshold -0.5); robots vs robots r6b: -0.003 ± 0.003
  (1 board, -10). Removed. The advance table (advanceX) rarely bids here anyway; a real gain probably needs the doubler's
  side (doubling 4♥ more often with a flat 15+) and its advance together.

## Not done
- Step 2 (closer meaning of the judgement double for metas/card play): not attempted; needs ddacc/playsim runs.
- Step 4 (penlog hunt for undoubled overbids): not done beyond the residual analysis above.
- Held-out seed r7hold: the DD cache was being built (`node tests/bidddsim.js 4000 r7hold --base=basebid7`) when the
  round ended; it may be incomplete in the OS temp folder. Since no behaviour change was kept, nothing to measure on it.
  bidhuman not run (no behaviour change).

## Next steps
- Look at the hands rather than the auction: the residual's human/robot gap is unexplained by auction features. Try
  features of my hand against their shown suits (honours sitting over the bidder, length in partner's likely suits).
- The 4-level card-showing double needs the doubler's criteria widened with it; measure both together.
- Analysis script used: residual means by feature bucket and least squares (it's ~15 lines; rows filter `r.lbBy`).
