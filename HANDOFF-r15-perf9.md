# Round 15, perf9: robot claim answers off the main thread; idle robot solver workers closed

Branch `r15-perf9` (from main 1056dbe). Scripts in scratchpad
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/perf9/`:
`claimeq.js` (Node equivalence harness), `soak.js` (Chrome, 390x844 phone, practice with four robots, speed fast,
Next board automatically, page timeouts over 200 ms scaled by 0.2; samples heap after GC, DOM counters, workers,
timers, localStorage, claim timings every 10 boards), `idle.js` (Chrome: two boards, then the home screen during the
third auction; workers and renderer RSS 0/35/70 s later), `mainsrc/` (git archive of main for the before runs).

## 1. The opponents' answer to a robot's claim is worked out in the DD worker
Not by making the claim flow asynchronous: the worker already works out the robot's claim (robotClaimPre, r14
perf6) a second or more before the robot acts, so it now also works out the robot opponents' answer to exactly that
claim, and the page finds it ready. resolveRobotClaim / A.claim stay synchronous (the server and the Node harnesses
are untouched), and nothing can change between asking and answering.
- js/analysis.js robotDDCardStd: `table.ans` = some seat of the other side is controlled by a robot (the case where
  resolveRobotClaim calls claimAnswer). A human defender alone answering = no work in the worker.
- js/dds-worker.js robotClaimPre: if the robot would claim (n != null) and `t.ans`: `ans = claimAccept(t, by, n,
  CLAIM_NODES_PAGE)` (CLAIM_NODES if not local), `akey = robotClaimKey(t, by, nodes) + ';' + n` (deal, every card with
  seats and leaders, contract, claimer, budget, n: everything claimAccept reads). Its time counts with prefer's.
- js/table.js: `claimAnswerPre` (16 entries) filled by robotClaimNote; claimAnswer looks it up (only when non-empty,
  so the server never builds the key) before calling claimAccept. The daily wrapper (js/daily.js) still applies.

Identical decisions (Node, claimeq.js, 400 seeded boards, all four seats robots, local table, A.robotStep flow, md5 of
every board's record plus every chat line): main bundle, branch bundle without worker, branch with a separate worker
bundle running robotClaimPre on a structured clone of the table the page sends: all `aa0a54963e0de46519844d71fb59e8b1`.
387 robot claims; in worker mode all 387 answers came from the worker (0 claimAccept calls on the page).
claimAccept cost moved off the page in that run (Node, M-series, unthrottled): 50.4 ms total, p99 1.6 ms, max 16.0 ms.

Chrome (soak.js), claimAccept calls on the main thread:
| run | boards | claimAccept on page (calls / ms) | claimAnswer (calls / ms) |
|---|---|---|---|
| main, 1x | 50 | 52 / 10.8 | 52 / 12.0 |
| branch, 1x | 50 | 1 / 0.0 (a claim at trick 2: split path, no table sent) | 51 / 1.2 (map lookups) |
| main, 4x throttle | 10 | 9 / 1.9 | 9 / 3.7 |
| branch, 4x throttle | 10 | 0 / 0 | 10 / 1.1 |
These seeds' claims are mostly late and cheap; the ~28 ms outliers perf6 saw at 4x are the rare early big ones, and
those are now in the worker too (except claims after trick 1-2, see open).

## 2. Long session: memory, workers, timers (Chrome soak, 50 boards, main vs branch)
| | board 0 | 10 | 20 | 30 | 40 | 50 | +15 s idle |
|---|---|---|---|---|---|---|---|
| JS heap after GC, main (MB) | 1.18 | 3.63 | 4.33 | 4.29 | 4.50 | 4.71 | 4.77 |
| JS heap after GC, branch (MB) | 1.35 | 3.66 | 4.17 | 4.56 | 4.45 | 4.65 | 4.69 |
| DOM nodes, main | 579 | 1024 | 1444 | 1619 | 1800 | 2016 | 2125 |
| localStorage bytes, main | 0 | 24k | 49k | 72k | 92k | 113k | 117k |
- Heap levels off at ~4.5 MB; the slow growth (~25 KB/board) is most likely T.history (kept whole in memory, only the last 60
  boards are saved) and the sidebar's board list (DOM nodes ~+29 per board). Not a leak; see open.
- Event listeners 90-98 and live page timers 1-5 throughout: no leaked listeners or timers.
- Workers: 4 lead workers made and closed every board (by design), the 2 analysis workers closed after 30 s idle
  (DD_IDLE_MS), live workers 3-7. localStorage bounded (the saved practice keeps the last 60 boards, ~2.3 KB each).
- Leak found: the robot's solver worker (RobotDD.w) and the lead workers warmed during an auction were never closed:
  leaving practice for the home screen kept 5 workers (each a DDS instance, 20-30 MB) alive for the rest of the visit.

Fix (js/analysis.js robotDDIdle): when no robot decision has used the robot workers for 60 s (ROBOT_IDLE_MS; reset on
every decision end and every warm-up), close RobotDD.w and the lead workers (not while a robot is thinking). They are
made again on the next decision / warmed in the next auction, as the lead workers already are every board.
idle.js (real timers), workers alive on the home screen after leaving during an auction:
| after leaving | main: workers / renderer footprint | branch: workers / renderer footprint |
|---|---|---|
| 0 s | 7 / 254 MB | 7 / 243 MB |
| 35 s (analysis workers closed, both) | 5 / 193 MB | 5 / 193 MB |
| 70 s | 5 / 192 MB | 0 / 113 MB |
| 110 s | 5 / 195 MB | 0 / 109 MB |
Footprint = macOS `footprint` (phys_footprint) of the renderer processes (dedicated workers live there); ~-82 MB on
the home screen. Plain RSS is noisier (main 337 vs branch 292 MB at 110 s; an earlier run without footprint showed
325 vs 323 MB at 70 s, so use the footprint numbers). Cost: after 60 s with no robot decision (a person thinking
that long mid-board), the next robot card makes its worker afresh (script load + solver instance, well inside the
1.5 s budget); the lead workers are already made afresh every board.

## Checks
build + npm test pass; sim.js errors 0, long 0; wrangler dev + online.test.mjs and online-multi.test.mjs: all checks
passed (table.js is in the server bundle; the new map is empty there).

## Not done / open
- Human claims: claimAnswer for a person's claim still runs on the main thread (up to CLAIM_NODES_PAGE = 300,000
  nodes). Moving it needs resolveRobotClaim to go asynchronous on the page only (js/table.js:201): keep t.claim open
  with the robots' answers pending, post the position to RobotDD.w, then act() to apply the answer if t.claim and the
  position are unchanged; the UI (js/app.js claimBanner) would need a "robots are checking" state. Not attempted.
- Robot claims after trick 1 or 2 (robotDDSplit path sends no table) still compute claim and answer on the page.
- T.history grows without limit in memory during a session (js/table.js:73 finishBoard push; storage keeps 60), and
  the sidebar renders every board: fine for 50 boards (+3.5 MB heap, +1,400 DOM nodes), could matter at several
  hundred. Owner of app.js/table.js history: consider capping the in-memory list like the saved one.
- Harness note: crypto.subtle is missing on the http test origin (idFromSecret throws once); same in main.
