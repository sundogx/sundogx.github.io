# Handoff: robot solver card play, round 4 (bridge/)

This is the branch of worktree agent-a277907c0229534ce. The code commit is bb993c3, and this note is committed after it. npm test passes. No sw.js bump, nothing pushed. **No behaviour change ships this round:** js/leads.js gains only a comment, and the robots play exactly as on main cd2bd54. What is new is the `tunex` mode in tests/leadsim.js and the README's round-4 measurements.

The machine was very loaded throughout, by other agents' simulations (load 25-50 on 15 cores). Several runs were cut short, so the board counts below are what finished.

Scratch is in the scratchpad's `dd4/` folder:
- Scripts: run2.sh, run3.sh, run4.sh.
- phone.js, the phone proxy.
- Logs: rep05, r02, r10, tie, pen05, w06, lr02, lr10, phone_base, phone_dbl.
- Lead data sets: ldx.jsonl (692 boards) and ldy.jsonl (~640 boards), both made with `leadsim gen ... 48 0`.

## Results
1. **Odd-auction relax replicates.** ddacc `ODD=1 SIDE=def`, seed oddD, every second card, relax on the defenders only (`NEW='{"defender":{"relax":0.05}}'`, against a CUR without relax), 200 boards: defenders +0.027 ± 0.011 IMPs per decision and +0.006 ± 0.003 tricks; 75 of 1,554 decisions changed. Last round's +0.052 used a top-level relax, which also touched the lead.
   - **ddacc caveat:** the `def` row includes the opening lead (i = 0). Put relax-type options under `defender`/`declarer` to keep the lead out of the comparison.
   - Threshold 0.1 against 0.05: 1 decision changed in 1,188 (150 boards). Threshold 0.02: −0.005 ± 0.004. 0.05 stays.
   - Relax on the lead (ODD, leads only, 50 boards): 0.1 gave −0.39 ± 0.28 IMPs; 0.02 changed 5 leads, all neutral. Dropped again.
2. **Other ddacc tuning** (normal auctions, seed normD/normE, every third card):
   - Tie-break: lowest equal card instead of the heuristic's (`tie: 'dd'`, since removed). 201 of 1,162 decisions changed, with a double-dummy difference of 0 ± 0.002. ddacc can't see the value of a tie-break, and playsim would need ~1,500 boards. Kept the heuristic.
   - penBase 0.5 against 0.7: 0 decisions changed in normal auctions. It might matter only in ODD auctions; untested.
   - wOpp/wPart 0.6 against 0.8: declarer −0.017 ± 0.025, defenders +0.017 ± 0.017 (50 boards). Neutral, killed early.
   - K 36 from a pool of 128 against 24 from 96: killed before its first report (too slow under the load).
   - playsim confirmation wasn't run: nothing won in ddacc except relax, which already ships.
3. **Leads against doubled contracts**, measured with the new `DBL=1 node tests/leadsim.js tunex <files>`. It scores every contract doubled and compares the score metric (prior weights 1-6) and IMP averaging (weights 4-12) against tricks plus twice the prior.
   - ldx: score2 measured +0.041 ± 0.104 and +0.020 ± 0.082.
   - ldy (held out): score2 measured −0.031 ± 0.063 and −0.063 ± 0.076, and every variant was negative there.
   - Pooled about −0.01, so it was **dropped**. The change was committed in 21627f8 and reverted in bb993c3.
   - Average tricks is a steadier estimate on 48 layouts. The play after the lead already uses the doubled score.
4. **Phone proxy.** `taskpolicy -c background` (efficiency cores) was starved by the load and useless. Instead, phone.js runs with the page's budgets divided by F = 4, in one thread, timing CPU time per decision.
   - Undoubled: 528 decisions, mean 67 ms, median 56, p90 111. 10% fell back (wall time under the load). 22.9 layouts on average. Lead median 409 ms.
   - Doubled: 358 decisions, mean 140 ms, p90 264. 2% fell back. Lead median 635 ms.
   - Nothing that changes how much is computed shipped, so there is no regression.

## Ideas not tried / next
- Run the K and pool comparison and wOpp on an idle machine, with ~200 boards.
- penBase with ODD auctions.
- For doubled leads, if revisited: more layouts (96) with the score metric, since the score's variance is the likely problem. Or let the penalty doubler's shown trumps and values reach `leadLimits`: what does `shown()` give for a penalty X? That belongs to the bidding agent.
- Synrey/新睿 and Ben: Ben's `use_real_imp_or_mp` was tried in rounds 2 and 4 (IMP averaging) and did not help.
