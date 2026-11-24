# Heuristic play round 5 (botPlay in bridge/js/bots.js)

Result: no play change kept. `bridge/js/bots.js` is unchanged; nothing measured positive on both tuning seeds.

## Tools
- `bridge/tests/fixtures/basebots5.js`: bots.js at da98301 (after round 4), now the default `BASE` of `tests/heurstim.js`.
- `tests/heurfit.js`: `EXP=a,b` sets `globalThis.BOT_EXP` while fitting, so features can be fitted with an experiment on.
- Runs are fast: `node tests/heurstim.js 2000 cmp dev 5` takes about 60 s, and three can run side by side on 15 cores.
  `Y=mix node tests/heurfit.js 6000 switch fit5 7` takes about 2 minutes.

## Tried and dropped (cmp against basebots5, robots' own auctions)
| Idea | Seed, boards | Side | IMPs a board | Tricks a board | Changed |
|---|---|---|---|---|---|
| `disc1`: before losing the lead in trumps (no master trump), cash a side suit with more sure winners than the short hand has cards when that hand has fast losers (opponents hold the top card, other hand can't ruff) | dev 2000 | decl | -0.046 ± 0.023 | -0.013 ± 0.005 | 55 |
| `disc1` + `disc2` (same before developing a suit) | dev 2000 | decl | -0.044 ± 0.025 | -0.011 ± 0.006 | 67 |
| `disc2` alone | dev 2000 | decl | +0.007 ± 0.011 | +0.003 ± 0.003 | 17 |
| `disc1`+`disc1s` (only if the opponents' length makes a ruff a bad split) | dev 2000 | decl | -0.008 ± 0.019 | -0.002 ± 0.004 | 26 |
| `disc2`+`disc1s` | dev 2000 | decl | +0.008 ± 0.009 | +0.001 ± 0.002 | 11 |
| `encDisc`: defender's first discard a 7-T spot from a 4+ suit headed by A or touching honours | dev 2000 | def | -0.024 ± 0.021 | -0.004 ± 0.005 | 54 |
| `encDisc` from 3+ cards | dev 2000 | def | -0.031 ± 0.024 | -0.004 ± 0.006 | 80 |
| `sigDisc`: +1 to the switch score of the suit partner's first discard asked for (with `sigDn`, -0.7 for a low one) | dev 2000 | def | -0.007 ± 0.006 / -0.006 ± 0.022 | +0.001 / -0.002 | 7 / 60 |
| `encDisc` + `sigDisc` +2 | dev 2000 | def | -0.031 ± 0.025 | -0.006 ± 0.006 | 71 |
| Switch weights refit (Y=mix, 6000 boards seed fit5) with features discUp/discDown | dev 3000 | def | -0.014 ± 0.038 | -0.002 ± 0.010 | 432 |
| Same refit fitted with `encDisc` on, played with `encDisc` | dev 3000 | def | +0.018 ± 0.040 | +0.007 ± 0.011 | 500 |
| (same) | dev2 3000 | def | -0.025 ± 0.038 | -0.007 ± 0.010 | 455 |
| (same, held-out, looked at only after dev2 was negative) | test 4000 | def | +0.040 ± 0.034 | +0.008 ± 0.009 | 634 |

Notes:
- The fitted weight for partner's high discard was +0.6 in suit contracts once the robots discard encouragingly (0.1
  before), so the signal is read; it just doesn't win enough against what the spot card costs.
- Refitting the switch on a new sample changes ~15% of boards but the score stays within noise: the switch weights
  look converged for these features.
- A dump of costly declarer leads (`DUMP='decl suit why=(drawTrump|dlFit)' node tests/heurstim.js 120 leak dev`)
  showed no single dominant pattern: losing trump draws when a side winner (or a ruff) was right, and dlFit
  choices of the wrong side suit, each case different.

## Next steps
- The declarer suit-contract leak (0.50 tricks vs double dummy) is probably not fixable with one more rule; a loser
  count per hand (quick losers vs slow, ruffs available in the short hand vs trumps needed to draw) feeding new
  dlF features and a refit of BOT_DLEAD_W is the more promising route.
- Signals need a partner model that acts on them more strongly than a linear switch score, or a measurement against
  a human-like partner (the heuristic partner only half-uses them).
- npm test and `node build.mjs` pass. Not pushed, not deployed, CACHE not bumped.
