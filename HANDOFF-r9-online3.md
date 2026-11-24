# Round 9: online stability (r9-online3)

Files changed: `bridge/src/worker.js`, `bridge/tests/online-net.test.mjs` (new), `bridge/tests/online-sleep.pw.mjs` (new),
pings added to the clients in `bridge/tests/online.test.mjs`, `online-multi.test.mjs`, `online-adv.test.mjs`.
`bridge/node_modules` is an untracked symlink to the main repo's. Don't commit it.

## The bug: a sleeping phone held the table up for good
When a phone sleeps or loses its network, the WebSocket usually stays open on the server with nobody behind it. The
runtime may not notice for a long time. The table counted that player as present (`here()` only looked at `readyState`),
so they were never marked away. The automatic stand-in never came, and neither did the manual `sub` action, which also
needs `away`. The other three waited until someone left and came back. The same dead connections counted against
`MAX_PER_IP` (12), so after a dozen network drops on a flaky connection the player got a 429 and couldn't get back in.

## Changes (worker.js)
1. **A silent connection counts as gone.** A connection with no ping or message for `STALE_SOCKET_MS` (150 s live; the page
   pings every 25 s, or once a minute in a throttled background tab) is left out of `here()` and closed (`dropStale`,
   ~line 815). The player is then marked away and the usual stand-in follows 60 s later. A page that wakes up sees the
   close and reconnects (net.js already does this), and its hello hands the seat back.
   - During a board, `planAlarm` wakes the table when the next seated player's connection would go stale (`sweepAt`,
     ~line 832). This only happens while someone else is connected. Each wake is about 2 minutes after the oldest
     ping, so it adds at most one alarm per 2 minutes per table while the table waits on a person.
   - `alarm()` first closes silent connections and marks seated players who have no live connection as away (~line 885).
   - `apply` and `fetch` call `dropStale()`, so dead connections free up `MAX_PER_IP`, `MAX_SOCKETS` and the onlooker
     limit. `leftSocket`'s "still here in another tab" check ignores silent tabs.
   - `planAlarm` now only moves the alarm earlier, so it doesn't write on every move. An early alarm does no harm,
     because `alarm()` always plans the next one.
   - `TEST_STALE_MS` (env, tests only) overrides the 150 s.
2. **An away host hands on the job by alarm** (`hostDue`, ~line 436). Before this, `passHost` ran only inside `apply`,
   and a host-only action from another player fails before it gets there. So when the host left between boards,
   nobody could change settings, kick or swap until someone happened to chat.
3. The onlooker limit in `hello` doesn't count closed or silent connections.
4. **Review fix: robots stalled when someone went silent while a robot's move was waiting.** `alarm()` handles a
   silent connection (`dropStale`/`unmarkedAway`) or an away host (`hostDue`) before the robot branch, with an empty
   `apply`. That apply ends in `scheduleRobot()`, which saw the same position and kept the robot's due time, but did
   not arm an alarm. The alarm that had just fired was the robot's own, so the robot never moved. Now `scheduleRobot`
   re-arms the alarm on that path when none is pending (`worker.js` ~734). The test is section 2b of
   `online-net.test.mjs`: two people and two robots, a 5-minute board limit so the robots finish the board, then North stops pinging.
   - Unfixed server: the check FAILS (phase play, stalled). Fixed: passes. With the reviewer's repro
     (`rvrepro/stall.mjs`, 3 runs), 0 of 3 stalled and every run played all 52 cards. Before the fix the reviewer saw 3 of 3 stall.
   - Note: `wrangler dev` reloads only on changes in `js/` (`watch_dir`), not `src/`. Restart it after editing worker.js.

## Measurements and repros
Server: `npx wrangler dev --port 8831 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000`.
`BRIDGE_URL=http://localhost:8831 STALE_MS=3000 node tests/online-net.test.mjs` (about 2.5 min):

| check | main (cf26413) | r9-online3 |
|---|---|---|
| robot stands in for a silent seated player (no close, no pings) | FAIL (none after 9 s) | ok, 4.4-4.5 s (3 s silent limit + 1 s stand-in) |
| ... shown away / silent connection closed / stand-in plays | FAIL x3 | ok |
| 13 silent connections from one address, then a new one | FAIL (429) | ok |
| host leaves between boards, job passes with nobody acting | FAIL | ok (about 2 s = 2 min scaled) |
| player thinking 8.5 s with the page open (pinging) keeps the seat | ok | ok (no false away) |
| random claims/undos/answers/cards: 4 people; 2 people + 2 robots with a drop-out | ok | ok (never stuck, same version everywhere) |
| daily result posted twice at once / retried | ok (200 + 409, row once) | ok |

Real page in Chrome (`tests/online-sleep.pw.mjs`, server with `TEST_STALE_MS:30000`, page script paused through CDP like
a sleeping phone):
- main: no stand-in after 90 s, and the page was still "Reconnecting…" right after it woke.
- branch: a robot stood in after 29 s and called for South. The page reconnected 0.8 s after waking, had its seat back,
  and showed no page errors.

README now documents `online-net.test.mjs`, `online-sleep.pw.mjs` and `TEST_STALE_MS` (the Tests bullet under the server section).

Regression runs after the review fix: online.test 50/50, online-multi 45/45, online-adv 12/12, online-net all passed (twice), build + npm test + sim (errors 0, long 0) ok.

Earlier regression runs (branch, server with the 3 s silent limit): online.test 50/50, online-multi 45/45, online-adv 12/12,
daily.test passed. Baseline on main with the same server: the same 50/45/12. `npm test` passes, and `tests/sim.js` shows
"errors":0 and "long":0.

## Costs
- **Alarm wakes on the free plan.** With 4 people seated and connected, auto-response pings don't wake the table, so
  `sweepAt()` wakes each table mid-board about every 2 minutes to check for silent connections. Each wake is one
  alarm and one short request (storage writes only if someone is found silent). That is about 30 extra requests an hour
  per active table, which is small next to the free plan's 100k requests a day, but it counts.
- The fuzz's "boards" count is shown for information only. With robots taking 1-1.8 s a card, a board takes about 50 s,
  longer than the 40 s random phase, so 0-2 boards with robots is normal. The checks are "never stuck" and "the board
  finishes afterwards".

## What did not help or was not needed
- `Page.setWebLifecycleState('frozen')` doesn't freeze timers in headless Chrome (the page kept pinging every 25 s). I used
  `Debugger.pause` instead.
- Daily posting needed no server change: duplicate and retried posts get 409, which daily.js treats as posted, and
  the leaderboard keeps one row. Claim and undo races turned up no bug in about 1,100 random actions; the fuzz stays as
  coverage.

## Open findings (not my files)
- `js/daily.js:39` `onRender` posts only while the *current* board is `done` and a render happens. A board finished
  offline isn't posted until the next board is finished, and on the final result screen it waits for a render. It
  should retry on a timer or on `online`, whatever the phase.
- A host who isn't seated and closes the tab still hands on the job only at the next action (`leftSocket` only
  broadcasts for unseated people). This is minor.
- Hibernation can't be exercised under wrangler dev. The silent check uses `getWebSocketAutoResponseTimestamp`, which
  the runtime keeps across hibernation, plus attachment times.
