# Round 14, perf6: the robot's claim search moves to the DD worker (practice page)

Branch `r14-perf6` (from main 5c31e49). Scripts in scratchpad
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/perf6/`:
`claimeq.js` (Node equivalence harness), `cbench.js` (Chrome, 390x844 phone, 4x CPU throttle, real practice play with
all four seats robots, robotLevel strong, speed fast; wraps robotClaim / robotClaimCount and times them),
`mainsrc/` (git archive of main for the before runs).

## Change
- js/dds-worker.js: `robotClaimPre(table, seat)`. When the page sends the table with a robot's card request (the
  `table` field, since perf4) and the robot is about to lead to a new trick, the worker runs robotClaimCount for the
  controlling seat (dummy -> declarer) with the page budget (`table.local` -> ROBOT_CLAIM_NODES_PAGE) and sends
  `claim: { key, n }` on both the `preMs` message and the final card message. Its time counts with prefer's (preMs),
  so it doesn't eat into the card search budget.
- js/bots.js: `robotClaimCount(..., known)` returns `known` as is when given; `robotClaimKey(t, seat, maxNodes,
  maxLayouts)` = deal + every card played with seats and leaders + contract + seat + budgets (everything the count
  depends on).
- js/table.js: `robotClaimPre` map (16 entries) + `robotClaimNote(c)`; robotClaim looks the key up (only when the map
  is non-empty, so the server never builds a key) and passes the answer as `known`. Everything else in robotClaim
  (who may claim, robotClaimAt, the daily wrapper in js/daily.js, which forwards `...a`) is unchanged; a miss (first
  two tricks use the split path without the table, Beginner level, solver failed or late, BEN) computes on the main
  thread as before.
- js/analysis.js (NOT my file, one line, needed for delivery): robotDDWorker's onmessage calls
  `robotClaimNote(m.claim)` first. Whoever owns analysis.js: please keep it when merging.

## Identical decisions (Node, claimeq.js, 300 seeded boards)
3,289 robot-on-lead trick-start positions (tricks 1-11), 1,070 claims. Mode `main`: robotClaimCount in place, in order
(the old page path). Mode `worker`: robotClaimPre on a structured clone of exactly the table the page sends, in
reverse order with botPlay run after each (worker state left behind), key checked against the page's key, then the
page's robotClaimCount(..., known). md5 of the 3,289 results identical: 004b9314be832d7b982df9345788ad23 both.

## Main-thread time (Chrome, 4x throttle, cbench.js, 240 s per run, main and branch run side by side)
| run | boards | robotClaim calls | robotClaimCount main-thread ms (total / per call / p90) | robotClaim total ms | worker hits | claims |
|---|---|---|---|---|---|---|
| main 1 | 10 | 456 | 405.8 / 1.18 / 2.3 | 499.4 | 0 | 9 |
| branch 1 | 11 | 455 | 46.4 / 0.13 / 0 | 154.5 | 62 | 9 |
| main 2 | 10 | 470 | 338.0 / 0.97 / 2.8 | 453.2 | 0 | 10 |
| branch 2 | 12 | 468 | 51.3 / 0.15 / 0 | 193.3 | 59 | 11 |

Both runs: robotClaimCount's main-thread time -87% / -85% (406 -> 46 ms, 338 -> 51 ms per ~10 boards); robotClaim
per call 1.10 -> 0.34 ms and 0.96 -> 0.41 ms. The worker answer was there for 59-62 trick starts per run (every
solver-path trick start); the rest are the cheap early-trick ones (budget 500 nodes) and non-trick-start calls.
Checks: build + npm test pass; sim.js 3000 games errors 0, long 0; wrangler dev + online.test.mjs and
online-multi.test.mjs all checks passed.

(robotClaim total includes A.claim -> the opponents' claimAnswer search at 300,000 nodes when a robot claims; that is
the max-ms outlier, ~23-28 ms, and is not moved by this change.)

## Not done / open
- The remaining main-thread claim work: trick starts in the first two tricks (robotDDSolve's split path computes
  prefer on the page and doesn't send the table; the claim search there is capped at 500 nodes), misses when the
  worker answers late, and the opponents' claimAnswer (claimAccept, js/table.js claimAnswer, up to 300,000 nodes on
  the page, up to ~28 ms at 4x per robot claim). Moving claimAnswer to the worker would need the claim flow to go
  async (resolveRobotClaim is synchronous inside act()).
- Server (src/worker.js): unchanged behaviour; the map is empty there, robotClaim takes the old path.
