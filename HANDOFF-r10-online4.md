# Round 10: online4 (fix the r9-online3 robot stall)

Branch `r10-online4` is rebased onto main b72c764, which already has r9-online3 squashed in (f81b782, including the
same scheduleRobot fix from r9-online3's 88025c3, README lines and online-net section 2b). So on this branch the stall
fix below is main's single copy, and the branch adds the review fixes, a build fix and tests on top (one commit plus
this note). The pre-rebase history is kept on local branch `r10-online4-pre-rebase`. Files changed:
`bridge/src/worker.js`, `bridge/tests/online-net.test.mjs`.
`bridge/node_modules` is an untracked symlink to the main repo's; don't commit it.

## The bug (r9 reviewer, high)
r9-online3's `alarm()` first handles silent connections (`dropStale() || unmarkedAway()`) and an away host
(`hostDue`) with `apply({}, () => {})`, then returns. `apply` ends in `scheduleRobot()`. When a robot's move was the
reason the alarm fired, nothing has moved, so `scheduleRobot` takes its "same position, keep the robot's time" early
return (`askThink(rd.due); return;`) and never re-arms the alarm. The alarm was spent, so the robot never moves until
a person acts, chats or reconnects. Live this happens whenever the 150 s silent limit or the host's 2-minute away limit
runs out during a robot's 0.65-1.8 s pause.

## Fix (worker.js `scheduleRobot`, ~line 730)
In the keep-the-time branch, if no alarm is pending (`alarmAt == null`, which `alarm()` sets on entry, or an
`alarmAt` already in the past) set it to `max(now, rd.due)`. Every other alarm duty is unchanged: the order in
`alarm()` stays (deadline, silent connections, host, stand-in, robot, idle), and each of those still runs in its own
alarm; the robot's move simply follows in the next alarm at its original due time (already passed, so at once). An
alarm that is still pending (e.g. the think wait set by `alarm()`, or a chat line during the pause) is left alone, so
no extra writes per move.

## Repro and results
Server: `npx wrangler dev --port 8841 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000`.
New section 1b of `tests/online-net.test.mjs` (Alice S host, Bob N, robots E and W):
- *silent*: Bob pings once then goes silent; Alice calls 2.65 s later so West's call (0.65 s) comes due just after
  Bob's connection counts as gone.
- *host*: Alice (host) closes at Bob's turn; Bob calls 1.65 s later so East's call comes due just after the host's
  job should pass (2 s scaled).

| check | r9-online3 | r10-online4 |
|---|---|---|
| robot calls when a seated connection goes silent during its pause | FAIL (no call in 5 s) | ok, 663-726 ms (5 runs) |
| robot calls when the host's job passes during its pause | FAIL (no call in 5 s) | ok, 663-673 ms (5 runs) |
| reviewer's repro (`.../f1461e61.../scratchpad/rvrepro/stall.mjs`, robots finish a timed-out board, N goes silent) | froze 3/3 (reviewer) | 52 cards played, 3/3 |

Full runs on the fixed branch: online-net 24/24 checks, online.test all passed, online-multi all passed,
online-adv all passed, daily.test 29/29 (server with the test vars above); online.test and online-multi also pass on a
plain `wrangler dev` (no test vars; the scaled-time checks skip). `npm test` passes; `node tests/sim.js | head -1` shows
"errors":0 and "long":0.

## Test flake fixed
online-net section 1, "the table gets to Alice's turn", failed 1 run in 12: when robot North declares with Alice
dummy, the robots play the whole board (~1 s a card since today's owner change) and the 30 s wait ran out at 34 cards.
Not a stall (the robot was to move and moving). The wait is now 90 s.

## Build fix (main is broken)
On main b72c764 (heur9), `src/worker.js:784` in `askThink` reads
`try { ...; prefer = G.botPlayH(t, ts); } // (the heuristic card only: ...) catch (e) { ...; return; }`.
The `//` comment swallows the `catch`, so the worker does not build (`wrangler dev` fails with "Expected finally but
found const"). `npm test` does not build the worker, so it passes anyway. Fixed here by moving the comment to its own
line. **Main can't be deployed until this is merged or fixed there.**

## r10 review fixes (fix pass)
1. Merged r9-online3's 88025c3 (now through main, see above): one copy of the fix.
2. `alarm()` ignored `apply()`'s result: if the save failed, nothing set the next alarm. The deadline, silent-connection,
   host and stand-in duties now set a 2 s retry when apply fails (the robot step already did).
3. `unmarkedAway()` ran on an empty idle table after a restart and its apply reset `updatedAt`, putting off deleting
   the table. It is now checked only during a board or with someone connected.
4. `dropStale()`: when the connection it closes was the one asked for a robot's card, the request is marked answered
   (no card), so the robot plays its heuristic card at its due time instead of waiting out `THINK_MS` (2.5 s).
   Test: online-net section 2c (Rex seated N with two tabs that answer, robots E/S/W, Ann watching; on Rex's turn his
   second tab goes silent and he plays 2.3 s later, so the next robot card is due just after that tab is closed; tried
   until the silent tab is the one asked). Without the fix: 2520 ms; with it: 1025 ms (normal pause 1 s).
5. `othersHere()` ignores silent connections, as `here()` does.

## Reviewer's other r9 findings
- (low) With people connected, `sweepAt()` wakes each table mid-board about every 2 minutes (pings answered by the
  runtime don't wake the object). Cost: at most one extra alarm per 2 minutes per table while it waits on a person.
  Accepted as is.
- (low) The two-robot fuzz finished 0 boards in its 40 s random phase (again here). With 1 s robot cards a board takes
  ~50 s, so 0 is expected; the check relies on "never stuck" and "the board finishes", which pass. Not changed.
- README now documents online-net, online-sleep and `TEST_STALE_MS` (through main).
- Section 2c retries until the silent tab is the one asked (the server alternates between the two tabs). It gives up
  after 8 tries or 150 s and then fails. Once, on a server already used for many runs, it got no tries at all.

## Open findings (carried from r9-online3, not changed)
- `js/daily.js:39` posts a finished board only during a render while the current board is `done`; it should retry on
  a timer or `online`.
- An unseated host who closes the tab hands on the job only at the next action (`leftSocket` broadcasts only for
  unseated people; minor).
- Hibernation can't be exercised under wrangler dev. After hibernation `robotDue` is gone, so the new branch isn't
  reached there; `scheduleRobot` then plans a fresh due time and sets the alarm, as before.
