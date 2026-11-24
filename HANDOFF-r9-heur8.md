# Round 9, heur8: heuristic card play (botPlay in bridge/js/bots.js)

Branch `r9-heur8`. Only `botPlay` changed. sureTricks, exactTricks and the claim code are untouched. Not pushed, not merged, not deployed, CACHE not bumped.

## How I looked for silly plays
I wrote a scratch scanner: heuristic play in all four seats, every decision solved double-dummy, and decisions costing a trick put into human-visible buckets. The buckets were overtaking partner's winning card, discarding a master, a fourth hand that doesn't win, and anything at tricks 11-13. I didn't commit it. A copy is at
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/h8/scan.js` (`EXP=… SHOW='bucket' node scan.js N seed`).
It found three patterns a human would notice:

1. **The declaring side overtakes its own equal card in third seat.** Board #43 (seed `scan`), 4♥ by North, trick 11: dummy leads ♦Q and North plays the ♦K from KT5. East still holds ♦AJ4, so the K just falls under the A. The same pattern shows up in #98: 4♥X, dummy leads ♥Q and East's ♥K from K7 drops under South's ♥A.
2. **The fitted follow choice (flFit) overrides "play low under partner's sure winner" (L162).** Defenders throw an honour on partner's master. Examples: #53 (2NT, trick 12: S plays ♥K under partner's master ♥Q), #284 (1♦, S plays ♠K on partner's ♠Q when the ♠A is gone), #228 and #26.
3. **Discarding a master while holding a loser elsewhere.** Examples: #191 (3NT, trick 12: N throws ♥A and keeps ♠T under W's ♠J), #101 (3NT, trick 10: E throws ♥A and keeps ♠KQ9) and #104.

## Kept (commit afc3d15)
- `p3eq`: declaring side in third seat. Partner's card is winning and is as good as our cheapest winner (the same number of unseen cards above it), so play low.
- `p3void`: declaring side in third seat, the fourth hand is known void and can't ruff, partner's card is winning. Play low instead of the cheapest winner (heur7's "third seat when the fourth hand is void" idea).
- `fit162`: when the rule chose L162 (partner's card surely wins), the flFit candidates are not consulted. In practice only the defenders change.
- `dmast`: a discard never comes from a suit whose lowest card is a master while another suit has a non-master to throw. This applies to both sides; the old code was the discFit/L216 suit choice.

Each rule has an `OFF` switch.

Measured with `BASE=<copy of main's bots.js> node tests/heurstim.js N cmp seed`:

| Seed, boards | What | decl IMPs/board | decl tricks | def IMPs/board | def tricks |
|---|---|---|---|---|---|
| dev 1991 | p3eq only | +0.019 ± 0.008 | +0.005 ± 0.002 (10 changed) | | |
| dev 1991 | p3void only | +0.010 ± 0.011 | +0.003 ± 0.002 (6 changed) | | |
| dev 1991 | fit162 | | | +0.028 ± 0.015 | +0.007 ± 0.004 |
| dev 1991 | dmast, defenders only | | | +0.027 ± 0.016 | +0.010 ± 0.004 |
| dev 1991 | dmast, declarer only | +0.015 ± 0.017 | +0.009 ± 0.003 | | |
| dev2 2977 | p3eq+p3void | +0.023 ± 0.009 | +0.004 ± 0.002 | | |
| dev2 2977 | fit162 | | | +0.035 ± 0.015 | +0.011 ± 0.004 |
| dev2 2977 | dmast def / decl | +0.031 ± 0.012 (decl) | +0.010 ± 0.002 | +0.018 ± 0.011 | +0.006 ± 0.003 |
| **test 3971 (held out)** | all four | **+0.032 ± 0.011** | **+0.013 ± 0.003** (92 changed) | **+0.008 ± 0.017** | **+0.007 ± 0.004** (178) |
| **test2 3977 (held out)** | all four | **+0.032 ± 0.013** | **+0.008 ± 0.003** (78) | **+0.040 ± 0.019** | **+0.015 ± 0.005** (160) |
| test 1988, OVER=1 | all four | +0.071 ± 0.024 | +0.012 ± 0.004 | +0.043 ± 0.043 | +0.003 ± 0.005 |

Ablation on test (3,971 boards; each component switched off again with `NEWOFF=trlead,holdup,X`; negative means switching it off loses):

| Switched off | Declarer | Defenders |
|---|---|---|
| fit162 | | −0.012 ± 0.012 IMPs (−0.002 tricks) |
| dmast | −0.008 ± 0.009 IMPs (−0.005 ± 0.002 tricks) | +0.001 ± 0.011 IMPs (−0.005 ± 0.003 tricks) |
| p3eq + p3void | −0.018 ± 0.007 IMPs (−0.006 ± 0.002 tricks) | |

Note: `NEWOFF` replaces `BOT_DEFAULT_OFF`, so it must repeat `trlead,holdup`. Leaving them out switches hold-ups and trump leads on.

Baseline leak report (current main, `heurstim 2000 leak dev`): declaring side 1.284 tricks a board, defenders 1.121.

## Tried and dropped (experiment code removed)
| Idea | Result |
|---|---|
| `p3low`: third seat, let partner's card ride whenever its unseen-above count is within the finesse limit (`lim`), not just equal | dev −0.010 ± 0.021 IMPs, −0.004 ± 0.005 tricks (39 changed) |
| Skipping flFit for p3eq/p3void | identical (flFit never overrode them) |
| `p3eqD`: the same "partner's card is equal, play low" for defenders in third seat | dev 2987: +0.006 ± 0.008 IMPs, +0.002 ± 0.002 tricks (29 changed) |
| `cashBlk`: cashIn leads high (not low to partner's shorter master) when the opponents hold nothing above our lowest card. Repro #313, C97 opposite C8 at trick 12 | dev 2987: +0.005 ± 0.012 IMPs, +0.001 ± 0.003 tricks |
| dmast on the declaring side only when partner is shorter in the suit | dev −0.037 ± 0.020 IMPs, −0.009 ± 0.004 tricks (the unconditional version is the one kept) |
| Refit of the follow weights (`Y=mix heurfit 6000 follow fit5`, with the new rules on) | decl1n/decl1s: fitted loss no better than current in sample (0.135 vs 0.130; 0.052 vs 0.055), not tried |
| New decl2s / decl2n weights from the same fit | dev −0.144 ± 0.036 and −0.151 ± 0.026 IMPs (as round 4 found, no weights there) |
| def1n refit | dev +0.023 ± 0.012, dev2 −0.010 ± 0.011 IMPs |

## Open findings
- `bridge/js/bots.js` signal() (line 540): a defender's encouraging card returns `high(spots)` without `R(...)`, so botWhy shows the caller's label (L162/L163). Cosmetic for the leak report only.
- Endgame discards on the declaring side where both suits are masters: the bot should keep the master in the suit that the hand about to lead can reach. Repro #375 (1NT, trick 12: dummy throws ♥A and keeps ♦A, then North leads ♥5). It's rare, so I didn't measure it.
- Defenders' third-hand unblocking, for example #355 (DQ led, partner holds AT; overtaking unblocks). Not addressed.
- The remaining large leaks (declarer's suit leads, defenders' switches) are unchanged.
- README's heuristic section (`bridge/README.md` around line 330) could get a round 9 sentence. I didn't edit it because it isn't my file.

## Checks
`node build.mjs`, `npm test` (all ok) and `node tests/sim.js | head -1` (errors 0, long 0) pass on the commit.
