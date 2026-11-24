# Heuristic play round 7 (botPlay in bridge/js/bots.js)

## Where it loses (leak report, `node tests/heurstim.js 3000 leak dev`, 2,987 boards, against perfect play)
Declaring side 1.38 tricks a board, defenders 1.23 (unchanged from round 4). Largest: declarer's leads in suit
contracts 0.51 (dlFit 0.17, drawTrump 0.09), defenders' switches 0.34 suit / 0.21 NT, declarer's leads in NT 0.27,
opening leads 0.24 (leads.js, not botPlay), declarer's third hand 0.14 suit / 0.10 NT, defenders' NT discards 0.11.
Dumps (`DUMP=...`) of dlFit, devHigh, 3rdTop, defSwitch and declarer ruffs: mostly double-dummy peeking, no single
pattern. The exception was L182 (declaring side in second seat takes the trick with a master): many cases where
partner, playing fourth, holds a master too (dummy plays the K from K2 opposite a singleton A, the Q from AQ72
opposite KT8, the K from KT8 opposite A6 when the Q is led).

## Kept: `p2low`
Declaring side in second seat, partner (fourth, visible) holds a master that beats the card led: play low and let
partner's master win (rule `p2low` before L182; the follow fit is skipped for it). The first version (commit 3e2cc34)
lacked "beats the card led" (a master 9 under a led J counted); fixed in the second commit.

Measured with `node tests/heurstim.js N cmp seed` against `tests/fixtures/basebots5.js`, declarer side changed:

| Seed, boards | Version | IMPs a board | Tricks a board | Changed |
|---|---|---|---|---|
| dev 1991 | first, only when this hand isn't shorter | +0.107 ± 0.043 | +0.023 ± 0.009 | 164 |
| dev2 2977 | same | +0.068 ± 0.038 | +0.030 ± 0.008 | 308 |
| dev 1991 | first, any length | +0.147 ± 0.052 | +0.035 ± 0.011 | 237 |
| dev2 2977 | any length on top of the length-limited one | +0.052 ± 0.024 | +0.009 ± 0.004 | 86 |
| dev3 1986 | first, any length | +0.107 ± 0.047 | +0.030 ± 0.012 | 254 |
| test 3971 | first, any length | +0.010 ± 0.035 | +0.009 ± 0.008 | 456 |
| dev / dev2 / test | "beats the card led" fix on top of the first | +0.036 / +0.059 / +0.066 (± 0.012-0.014) | +0.008 / +0.013 / +0.014 | 17 / 37 / 56 |
| **test 3971** | final | **+0.076 ± 0.033** | **+0.023 ± 0.008** | 407 |
| **test2 3977 (untouched)** | final | **+0.107 ± 0.031** | **+0.019 ± 0.007** | 388 |
| test 1988, OVER=1 | final | +0.132 ± 0.076 | +0.020 ± 0.012 | 218 |

`test` was looked at once before the fix (the dump of p2low losses on `test` found the bug), so `test2` is the clean
held-out figure. Leak report on 1,492 `test` boards: declarer's 2nd-seat follows in suit contracts lose 0.066 tricks a
board (0.078 before), NT unchanged at 0.046; p2low itself is wrong in 6-7% of its decisions (DD-only cases such as
AJT8 opposite K64, where the T would have kept the K).

## Tried and dropped (dev, 1,991 boards, on top of p2low: `BASE=js/bots.js NEWEXP=x`)
| Idea | IMPs a board | Tricks a board | Changed |
|---|---|---|---|
| `rhi`: declaring side ruffs with its cheapest master trump when a later opponent is known void in the suit led (may overruff) | +0.003 ± 0.013 | +0.000 ± 0.003 | 23 |
| `rhi`+`rhi1`: also when at most one card of the suit is unseen | -0.003 ± 0.021 | -0.006 ± 0.004 | 40 |
| `rhi2`: ruff above every unseen spot trump (2-T) instead of with a master | +0.015 ± 0.015 | +0.004 ± 0.004 | 32 |
| `p2disc`: second seat void, partner (fourth) holds the master of the suit led: discard instead of ruffing in the long or equal trump hand | -0.024 ± 0.025 | -0.009 ± 0.006 | 101 |
| `p2discA`: same in either hand | -0.023 ± 0.026 | -0.011 ± 0.006 | 108 |
| `p2ruff`: second seat, partner void with fewer trumps: play low and let it ruff | +0.004 ± 0.003 | +0.002 ± 0.001 | 2 |

The experiment code was removed (not left behind EXP switches).

## Tools
- `tests/heurstim.js`: `OLDEXP=a,b` turns experiments on for the old heuristic, so `BASE=js/bots.js NEWEXP=a,b OLDEXP=a`
  measures b on top of a. `DUMP` now also matches the kind of decision (`DUMP='decl suit 2nd ruff'`), not only the rule.
- The machine was shared with other agents (load 100-130 on 15 cores), so a 2,000-board cmp took 45-90 s.

## Next steps
- The same "let the visible partner's card do it" idea may apply elsewhere for the declaring side: third seat when
  partner led and the fourth hand is void (known), or choosing which hand wins for entries (keep the master in the
  hand that needs an entry). The flFit weights for decl1n/decl1s were fitted before p2low and could be refit
  (`Y=mix node tests/heurfit.js 6000 follow fitN`), now that p2low takes some of their decisions.
- The big leaks (declarer's suit leads, defenders' switches) are unchanged and look like single-dummy limits of a
  linear score; round 6's loser-count features are still there at weight 0.
- npm test, `node build.mjs` and `node tests/sim.js` (errors 0) pass. Claims code not touched. Not pushed, not
  merged, not deployed, CACHE not bumped.
