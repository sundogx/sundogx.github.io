# Handoff: robot solver card play round 3 (bridge/)
Branch of worktree agent-a21adab6670f7ba5b. Code commit eb47aa1; this note is committed after it. npm test passes. No sw.js bump, nothing pushed.
Scratch scripts and logs: scratchpad dd3/ (probe.js times the sampler alone; accOdd.log, accNorm.log, oddB.log).

## Changes
- `ddSample` (js/ddplay.js) takes options. `relax: 0.05`: if fewer than 5% of dealt layouts meet a hidden player's auction limits, those limits are ignored when the spare layouts are ranked. This handles a human's odd bid, or a system meaning that is wrong. `stop: 1`: stop dealing once at least 400 tries are done and the hit rate projects fewer than 0.75k fits. Both are on for play after the lead (`RobotDD.DECL`/`DEF` in js/analysis.js) and off for the opening lead. leads.js passes its opts through, but the page doesn't set them for the lead.
- New `tests/ddacc.js`: decision accuracy. Each robot decision, made with the current options and with the NEW options (same seed), is scored by its double-dummy cost on the real deal. The comparison is paired per decision and about 20x cheaper than playouts for the same error. `ODD=1`: one seat per board bids from a fake random hand. `DBL=1`/`2`: every contract doubled or redoubled. `SIDE=decl|def`. Results are reported separately for decl, def, declX, defX and lead.
- playsim.js: the same `ODD`/`DBL` modes. Its CUR base, and ddacc's, now include relax/stop (the page's settings).
- ddtest.js checks that doubled contracts are scored right: a doubled declarer takes the safe one-off over a 30% gamble that goes three off, and takes the gamble undoubled. The defenders do the mirror image. It also checks that impossible limits still yield k valid layouts.

## Numbers (ddacc, every 2nd card, IMPs per decision, positive = new better)
- ODD auctions, 300 boards (seed oddC; machine shared with other agents' sims):
  - defenders +0.052 ± 0.014 (tricks +0.012 ± 0.005; 193 of 2,388 decisions changed)
  - declarer +0.005 ± 0.004 (tricks +0.004 ± 0.002)
  - lead (relax/stop also on there): -0.014 ± 0.039 IMPs, -0.028 ± 0.019 tricks, so it was left off for the lead
- Normal robot auctions, 200 boards (normC): 31 of 4,000 decisions changed. Declarer -0.006 ± 0.005, defenders -0.001 ± 0.001. Neutral.
- playsim playouts were too noisy to settle this: ODD 100 boards ndef +0.47 ± 0.35, ndecl +0.26 ± 0.17; oddB 150 boards ndef +0.12 ± 0.21, ndecl +0.01 ± 0.07.
- Time: the sampler alone on ODD auctions (Node, loaded machine) had a 90th percentile of 48 ms before and 36 ms with stop; the median is about 1.4 ms either way. ms per decision in ddacc is unchanged (contaminated by other agents' load, so compare only relative numbers).

## Findings / dropped
- Doubled contracts needed no play change. `ddPick` already values each card by `scoreContract`, which includes doubled undertricks, so declarer minimises the set and defenders maximise it. I didn't measure whether a lead metric of `score` would beat `tricks` against doubled contracts. The run would be `DBL=1 NEW='{"metric":"score"}' node tests/ddacc.js 700 13 dbl 52`, where every=52 means leads only.
- Lightner / doubled-3NT lead conventions: the robots don't make such doubles, so the sims can't measure them. A human partner's slam double would need a prior feature, roughly "partner doubled a slam: lead dummy's first suit, not trumps". Not done.
- Defence anti-peeking: ddacc scores against the real deal double dummy, so it can't measure it. Testing it needs playsim against heuristic or other defenders, with about 1,500 boards. Not attempted.
- Declarer "win in more samples": average score already carries the game/slam bonus jump; agg imp was tried in round 2 (-0.02).

## Next steps
1. Run ddacc ODD on a fresh seed to confirm (+0.05 for defence should replicate), and run a phone-timing check (scratchpad dd2/phone.js from round 2).
2. Try relax thresholds 0.02/0.1, and relax for the lead with leadLimits (the lead measured slightly negative at 0.05).
3. Use ddacc to tune other per-decision options cheaply (wOpp/wPart, penBase, K), then confirm the winners with playsim.
