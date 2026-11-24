# Handoff: robot solver card play, round 6 (bridge/)

Branch `worktree-agent-a5859800b0f8eb7df`, on top of main ed3bb87. npm test passes. No sw.js bump, nothing pushed.

**What ships:** the robots choose exactly the same cards as before, faster. js/ddplay.js's play check (BEN-style consistency of 96 dealt layouts with the play so far) got three exact shortcuts, each with an off switch for tests:
- `memo`: a layout dealt more than once is checked and solved once.
- `skipEq`: no heuristic replay of a choice where all the player's legal cards were equal.
- `floor`: a layout's check stops once its weight is below the k-th best so far (it can't be solved then; ties already went to the earlier layout).

Same layouts and weights in 415/415 decisions (scratch `profn.js`), 37% of the heuristic (`botPlay`) calls overall, 1-11% at tricks 10-12. `memo` and `skipEq` together give 42%, `floor` alone 90%. With all three, ddacc changed 0 of 876 decisions (80 boards, every 3rd card). `tests/ddtest.js` now checks the equivalence. `memo` alone: ddacc 0 of 1,898 decisions changed from trick 6 on; Phone proxy, all three against all off: tricks 7-13 at 24 ms of CPU instead of 42 (p90 51 instead of 71), median wall time 177 against 215 ms. Fallbacks were 64 and 56 of 357; that is wall-clock time under the other agents' load, not the shortcuts.

The machine was very loaded for most of the round (load 100-170 on 15 cores, from other agents' playsim, bidddsim and bidhuman runs). So wall times are unreliable, work is counted in heuristic calls instead, and no playsim was run.

Scratch is in the scratchpad's `dd6/` folder: base.log (the loss map), ex300.log, k48def.log, lb4/lb10.log, trw100/trw400.log, dump.txt, phone_memo/phone_nomemo.log, prof.js (time by part and trick), profn.js (heuristic-call counts plus an equivalence check), and phone.js (the dd4 phone proxy with an early/late split).

## Where it still loses (ddacc BY=trick, 300 boards, seed base6, every 2nd card; IMPs per decision against the best card on the real deal)
- Declarer: 0.08 on average. Leads at tricks 2-3: 0.27, at 4-6: 0.09. Following at tricks 2-3: 0.18, later 0.03-0.08.
- Defenders: 0.15 on average. Opening lead 0.75. Switches at tricks 2-3: 0.30, at 4-6: 0.37, at 7-9: 0.17. Following and discards under 0.03.
- Doubled contracts' defenders: 0.47.
- Tricks 10-13: under 0.01. The endgame is not where it loses against double dummy.
- `DUMP=5` examples look information-limited (e.g. a diamond switch instead of the heart that beats 4S, with no signal pointing to hearts).

## Measured and dropped (knobs left in, off)
| Idea | Result |
|---|---|
| `exact: 300`: all layouts late in the play, soft-weighted | def −0.015 ± 0.009, decl −0.004 ± 0.003 (400 boards, from trick 7) |
| K 48 / pool 192 for the defenders after trick 3 | −0.004 ± 0.004 (400 boards), twice the time |
| `leadBeta` 4 / 10: the opening lead read by the lead prior | 3% of decisions changed; decl +0.007 ± 0.007, def −0.013 ± 0.029 (50 boards, stopped) |
| `trW` 100 / 400: average tricks added to the defenders' score | 1% changed; +0.001 ± 0.010 / ± 0.014 (150 boards) |

## New in tests/ddacc.js
- `BY=trick`: report by stage and lead/follow.
- `TO=n`: stop after card n.
- `LEADDD=1`: the lead played is the solver's, not botLead, so the lead-reading tests aren't flattered.
- `DUMP=x`: print the costly decisions.
- With no NEW, it no longer runs the decision twice.

## Next
- Anti-peeking and tie-breaks can only be seen in full playouts. Run `playsim ndecl/ndef` with about 1,500 boards on an idle machine.
- Caveat on ddacc: all four seats play `botPlay`, which is exactly the play model of the consistency check. ddacc therefore flatters stronger play-reading. In the page, the robot partner and declarer play by the solver.
- A playout mode in ddacc where the robots play their solver cards would be realistic, but it costs as much as playsim.
- The 0.3-0.37 IMP switch losses are the biggest target. The ideas tried here (more layouts, other averaging) did not move them.
