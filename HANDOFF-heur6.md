# Heuristic play round 6 (botPlay in bridge/js/bots.js): declarer loser count

## What was added
- `loserCount()` inside `botPlay` (suit contracts, computed once per lead decision from `suitCount()`): for the
  long trump hand, the losers per side suit (the first three rounds not covered by our winners from the top), the
  ruffs the short trump hand can take of them (capped by its trumps), whether drawing trumps would leave the short
  hand too few trumps for those ruffs (`sT - ceil(oppT/2) < ruffs`), and whether a side suit still needs developing
  while we are short of tricks.
- Six new `dlF` features (BOT_DLEAD_NAMES; always 0 in notrump): `trumpKillsRuff` (lead trumps when that loses a needed
  ruff), `ruffLoser` (side suit with ruffable losers, up to 2), `sideDevFirst` (side suit needing development while
  opponents still have trumps), `trumpOkLosers` (lead trumps when losers minus ruffs fit the contract's allowance),
  `loserIn` (the suit's losers), `trumpWithDev` (lead trumps while a side suit needs developing).
- Commit fc40f39 added them with weight 0 (no play change).

## Refit
`Y=mix node tests/heurfit.js 6000 lead fit6 4` (about 4 minutes on 4 workers); only the suit weights pasted
(the NT refit was left alone). Suit: 27,870 decisions, fitted best 78.0% / loss 0.150 against current 77.6% / 0.155.
Fitted: trumpKillsRuff -1.4, ruffLoser +0.6, sideDevFirst -0.6, trumpOkLosers -0.3, loserIn -0.4, trumpWithDev -0.3
(the old weights moved too: trumpOppLeft 0.7 -> 1.1, partnerRuffs 2.3 -> 1.9, oppRuffs -1.8 -> -1.4, ...).

## Measured (decl side, cmp against tests/fixtures/basebots5.js)
| Run | Boards | IMPs a board | Tricks a board | Changed |
|---|---|---|---|---|
| dev (tuning) | 1991 | +0.109 ± 0.060 | +0.005 ± 0.013 | 367 |
| test (held out) | 1988 | -0.028 ± 0.060 | -0.002 ± 0.014 | 396 |
| test, OVER=1 | 1492 | -0.027 ± 0.105 | -0.004 ± 0.015 | 260 |

Result: no play change kept. The dev gain didn't hold up on the held-out seed (and test was -0.107 IMPs
at 1,500 boards), so the round-5 suit weights are back. The features stay in `dlF` with weight 0 (no play change;
loserCount runs only where dlF already does), so a later round can refit with them straight away. README not changed.

## Notes / next steps
- The fitted weight on `trumpKillsRuff` is clearly negative, so the feature is read, but the in-sample loss
  only improves 0.005 tricks a decision: most of the 0.50-trick leak is not about trump timing as these features
  see it. A finer count (which hand ruffs, entries back to the long hand, ruffing high vs. overruffs) is the next step.
- npm test and `node build.mjs` pass. Not pushed, not deployed, CACHE not bumped.
