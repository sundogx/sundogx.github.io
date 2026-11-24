# Round 10, heur9: heuristic card play (botPlay in bridge/js/bots.js)

Branch `r10-heur9`. Only `bridge/js/bots.js` changed. I did not edit sureTricks, exactTricks or the claim code; the new code only calls `claimSolver`/`claimPos`. Not pushed, not merged, not deployed, CACHE not bumped.

## Where the loss was
The leak report (`node tests/heurstim.js 2000 leak dev`, main) shows 1.325 tricks a board lost by the declaring side and 1.214 by the defenders. A scratch copy of heurstim split the leak by tricks left. **About 0.25 tricks a board per side is lost in the last 5 tricks, and 0.4 in the last 7.** By then most of the deal is known, so a small double-dummy search over the possible layouts can recover most of it. I dumped samples of the rule-level leaks (drawTrumpLow, 3rd hand, L206 ruffs, defSwitch, NT discards, NT devHigh). They were mostly double-dummy peeking with no single pattern, as rounds 5-9 found.

## Kept: endgame search (`endSim`)
- `botPlay` is now a wrapper. `botPlayH` is the old heuristic, unchanged.
- With 7 or fewer cards left and at least two distinct legal cards, `botEndgame` does the following:
  - It deals the cards this seat can't see at random between the two hidden hands. Suits a hand has shown out of go to the other hand.
  - For each candidate card (one card of each run of equals), it solves the layout with `claimSolver`. The heuristic's card gets an exact `value()`. The other cards get `win()` calls stepping up or down from that value.
  - It adds up the side's duplicate score (`scoreContract`) over the layouts and plays the best card. The heuristic's card wins ties.
- Limits:
  - At most 24 layouts, and it stops after 8 layouts if every card has scored the same.
  - The node budget is `END_NODES` = 8000 on the server (about 2.5 ms at 0.3 µs a node, measured) and `END_NODES_PAGE` = 30000 when `t.local`.
  - With fewer than 4 layouts solved inside the budget, it plays the heuristic card.
  - Seeding is deterministic (a hash of the position).
- When it runs:
  - Only at a real table: `t.phase === 'play'`, or `BOT_EXP` includes `end` for the harness.
  - Never in js/ddplay.js's layout weighting, which calls `botPlay` for every past card of every layout and builds a `t` without `phase`.
  - Never for practice robots set to Beginner (`Learn.robotLevel(t, seat).heuristic`).
  - `BOT_OFF` `end` turns it off. `tests/sim.js` and `simulateBoard` don't set `phase`, so they are unchanged.
- `botEndStats()` is exported for timing scripts.

### Measured
I used `BASE=<copy of main's bots.js> NEWEXP=end node tests/heurstim.js N cmp seed`. My copy of heurstim also passed END_* env values into globals for the variant runs. The seeds `test` and `test2` were not used for tuning.

| Seed, boards | Setting | decl IMPs/board | decl tricks | def IMPs/board | def tricks |
|---|---|---|---|---|---|
| dev 993 | first try: 5 tricks, 24 layouts, 15000 nodes | +0.436 ± 0.068 | +0.128 ± 0.015 | +0.387 ± 0.058 | +0.126 ± 0.015 |
| dev 993 | 4 tricks, 6000 | +0.273 ± 0.049 | +0.080 ± 0.011 | +0.241 ± 0.045 | +0.080 ± 0.013 |
| dev 993 | 6 tricks, 15000 | +0.539 ± 0.075 | +0.160 ± 0.018 | +0.446 ± 0.069 | +0.153 ± 0.018 |
| dev 993 | 7 tricks, 8000 (server default) | +0.529 ± 0.074 | +0.150 ± 0.017 | +0.437 ± 0.069 | +0.132 ± 0.017 |
| dev 993 | 7 tricks, 30000 (page) | +0.686 ± 0.083 | +0.192 ± 0.020 | +0.513 ± 0.078 | +0.151 ± 0.020 |
| dev2 1487 | 7 tricks, 8000, 16 / 32 layouts; 9 tricks | +0.52 to +0.53 (± 0.06) | +0.15 | +0.51 to +0.54 (± 0.06) | +0.15 |
| **test 3971** | **server default** | **+0.534 ± 0.039** | **+0.150 ± 0.008** | **+0.412 ± 0.037** | **+0.121 ± 0.009** |
| **test2 3977** | **server default** | **+0.579 ± 0.040** | **+0.153 ± 0.009** | **+0.421 ± 0.037** | **+0.124 ± 0.008** |
| **test2 3977** | **page budget (30000)** | **+0.776 ± 0.046** | **+0.213 ± 0.010** | **+0.518 ± 0.041** | **+0.152 ± 0.010** |
| test 1988, OVER=1 | server default | +1.079 ± 0.086 | +0.151 ± 0.012 | +0.812 ± 0.084 | +0.117 ± 0.012 |

At 8000 nodes, the number of layouts (16/24/32) and the trick limit (7 vs 9) make no difference. The node budget is what limits the gain. Leak after the change (dev 2000, server budget): declaring side 1.140 tricks a board (was 1.325), defenders 1.065 (was 1.214).

### Cost
These are CPU times measured while the machine was shared (load 60-70), 7 tricks, 15000 nodes. They include the heuristic's own time: p50 1.0 ms, p90 3.8 ms, p99 6.1 ms, max 21 ms (probably GC or another process). About 0.3 µs a node. With the 8000-node server budget, about 35% of the searches stop at the budget and decide on the layouts solved so far.

**Risk for the caller:**
- Is the server's 10 ms CPU a request enough? A robot's card on the server now costs up to about 8000 nodes plus overhead, on top of the robot-claim check (6000 nodes).
- worker.js `askThink` also calls `G.botPlay` for `prefer`, so in friends mode one request can run the search twice.
- If that is too much, lower `END_NODES` to about 4000. From the curve above, expect roughly +0.4 IMPs a side.
- `js/analysis.js` robotDDCardStd also calls `botPlay` for its tie-break `prefer` card, so the page spends a few ms more there.

## Tried and dropped
- `END_TRICKS` 4: about half the gain of 7.
- More layouts at the server budget: flat, as shown in the table.

## Open findings / notes
- The sampler deals the hidden cards uniformly. It ignores the auction (`oppShare`) and signals, so weighting layouts the way js/ddplay.js does is the next step. Starting the search earlier (8-9 tricks) only pays with a bigger budget (page).
- README's heuristic section (`bridge/README.md` around line 330) could mention the endgame search. It isn't my file.
- Earlier open items from heur8 remain: the endgame master-discard choice (#375) is now mostly covered by the search.

## Checks
- `node build.mjs`, `npm test` (all ok), `node tests/sim.js` (errors 0, long 0).
- `npx wrangler dev --port 8797` with `tests/online.test.mjs` and `tests/online-multi.test.mjs`: all checks passed.
