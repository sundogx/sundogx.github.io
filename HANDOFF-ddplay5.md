# Handoff: robot solver card play, round 5 (bridge/)

Branch of worktree agent-a5c0f21e222c075d3, on top of main 4ee44ec. npm test passes. No sw.js bump, nothing pushed. **No behaviour change ships:** the robots play exactly as before. New pieces are all opt-in or test-only:
- `ddView` option `xpen` in js/ddplay.js (off). It caps the trump minimum read from a penalty double of the final contract.
- tests/ddacc.js `FROM=n`: skip the first n cards. `FROM=1` leaves out the opening lead, which most play options can't change, and saves about half the time.
- tests/ddacc.js `XONLY=1`: only boards whose auction ended doubled.
- README robot-play "Round 5" paragraph.

Load was 10-43 on 15 cores. Each run used one worker, with at most 4 at once.

Scratch is in the scratchpad's `dd5/` folder: run1-5.sh, the logs (w06, w10, k36, pen05, xpen2, xpen2B, xpen0, phone24, phone36), and xpen.js (a histogram of penalty doublers' real trump length and HCP). The phone proxy is still `dd4/phone.js`; point it at this tree with `R=<bridge/js/>`.

## Results
All runs: ddacc with 200 boards, every 5th card, FROM=1, seed normF (odd auctions: oddF), against CUR = the page's options (K 24).

| Change | decl IMPs/decision | def IMPs/decision | changed | verdict |
|---|---|---|---|---|
| K 36 / pool 128 | −0.015 ± 0.011 | +0.002 ± 0.002 | 20/1,295 | no; +24% time |
| wOpp/wPart 0.6 | +0.007 ± 0.010 | 0.000 | 14/1,295 | flat |
| wOpp/wPart 1.0 | +0.004 ± 0.011 | −0.006 ± 0.011 (defX −0.045 ± 0.045) | 50/1,295 | flat |
| penBase 0.5, ODD | 0 | 0 | 1/311 (50 boards) | stopped: no effect |

- Phone proxy (F = 4, one thread, 8 boards, 285 decisions):
  - K 24: mean 130 ms, median 104, p90 247; 23.5 layouts; leads median 504 ms.
  - K 36/128: mean 161 ms, median 127, p90 331; 34.8 layouts.
- Penalty doubles: `shown()` already reads `xpen` as 3+ trumps and 10+ points. It reaches both `ddAuctionLimits` and `leadLimits`; they agree, as checked with probes.
  - `judgeX` doubles come from a defensive-trick estimate. In 4,000 ODD=1 auctions, 584 ended in a doubled suit contract, and the doubler's real trump length broke down as 0:10, 1:45, 2:107, 3:139, 4:184, 5:71, 6:22, 7:6. That is 24% below the 3 minimum. HCP was outside the limits in 11% of cases.
  - So reading the double as *more* trump length would be wrong. The test was the other way: lower the minimum with `xpen`. Measured with `ODD=1 XONLY=1`, every second card, `xpen` 2 against 3. On seed `xpenA` (450 boards, 107 doubled), declarer gained +0.008 ± 0.018 IMPs a decision and the defenders +0.012 ± 0.013. On the held-out seed `xpenB` (400 boards, 88 doubled), declarer gained +0.031 ± 0.022, the defenders −0.006 ± 0.029 and the lead +0.06 ± 0.06. On `xpenA`, `xpen` 0 gave +0.013 ± 0.023 and +0.026 ± 0.032 (150 boards). Everything leans positive but stays inside 1.5 standard errors, so it stays off. It would need about four times as many doubled boards.

## Next
- penBase and the play-reading weights are settled: leave them.
- K: only worth revisiting with a faster solver.
- Penalty doubles: a cleaner fix would be in bidding.js: `shown()` for a judgement double could give 2+ trumps, plus the points behind the estimate. That is the bidding agent's file.
- Ship `xpen: 2` only if a ~1,500-doubled-board run (ODD=1 XONLY=1, 4 workers, about an hour) keeps it positive.
