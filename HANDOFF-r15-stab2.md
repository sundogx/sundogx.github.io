# Round 15: online stability (r15-stab2)

Files changed: `bridge/src/worker.js`, `bridge/tests/online-stab.test.mjs` (new), `bridge/tests/online-restart.test.mjs` (new),
`bridge/tests/online-net.test.mjs` (test bug). `bridge/node_modules` is an untracked symlink; don't commit it.

## How to run
- `npx wrangler dev --port 8787 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000`, then
  `BRIDGE_URL=http://localhost:8787 STALE_MS=3000 node tests/online-stab.test.mjs` (about 4 min; `ONLY=sleep,tabs,think,host,race,end,flood,limit` runs some sections).
  Restart wrangler between comparisons: it reloads on `js/` changes, not `src/`.
- `node tests/online-restart.test.mjs` starts and kills its own `wrangler dev` (port 8961, storage in a temp folder), about 1 min.
- The limit section sends `cf-connecting-ip` (wrangler dev passes it through), so it exercises the real 20/hour path
  with random test addresses; restart the server to reset it if you run it many times from the same address range.

## Before/after (same test file, servers started the same way)
main = 1056dbe in a detached worktree, branch = r15-stab2.

| check (online-stab) | main | branch |
|---|---|---|
| long sleep with a robot call pending, then reconnect: seat back, robots made the moves, next call works, stale socket closed | ok | ok |
| two tabs, one seat: same call from both taken once; closing one tab keeps the player present; a silent extra tab is closed without marking away; last tab closed -> away; new tab takes the seat back | ok | ok |
| friends mode: the tab asked for a robot's card closes before answering (another tab open) | **FAIL** 2558 ms (THINK_MS wait) | ok 932-1010 ms (normal 1 s pause) |
| host (S) leaves mid-board, Bob N + robots E/W + an onlooker: stand-in ~1.0 s, host job to Bob ~2.4 s (scaled), board finishes, Bob deals next, Alice gets her seat back | ok | ok |
| claim/undo races between two people (claim + undo from both in the same tick, random answers/cancels, 25 s, 59-129 rounds) | ok | ok |
| a concession sent just before closing ends the board; closer shown away; record kept; reconnect gets the whole record | ok | ok |
| flood (2000 acts + 200 oversized + 200 binary + 500 junk): another person's chat through in <1 s; 5 spam lines got through | ok | ok |
| ... replies to the flooder | **FAIL** 1995 "slow down" messages | ok 1 |
| an oversized message gets an answer | **FAIL** silently dropped | ok "That message was too long, so it was ignored." |
| 20 creates in a row from one address all open, 21st 429 at once (<100 ms), bad request not counted, 30 at once -> exactly 20/10 | ok | ok |
| 429 message | **FAIL** "too many tables, try again later" | ok "You have opened 20 tables in the last hour, the most from one address. You can open another in 60 minutes, or join a table with its code now." + `retryAfter` (s) in the JSON and a `Retry-After` header |

online-restart (memory lost, storage and alarm kept, connections dropped; the nearest wrangler dev gets to hibernation/eviction):
table, board, record, chat and version come back; the pending robot call is played by the stored alarm with nobody
connected (3 moves in 4 s); Alice's seat is hers on reconnect; with an immediate reconnect the robot move still comes. Passes on the branch
(no change was needed; worker state that lives only in memory — `robotDue`, rate buckets, `think` — is either rebuilt or read back from the socket attachments).

## Fixes (worker.js)
1. **Think request on a tab that closes** (`leftSocket`, ~line 634). In friends mode the server asks one browser for a
   robot's card. If that tab closed (a duplicate tab, a refresh) the robot waited the full `THINK_MS` (2.5 s) for an answer
   that could not come. r10 fixed this for a *silent* connection (`dropStale`); now a closed one is handled the same way:
   the request is marked answered with no card, and if the robot's pause is already over the alarm is set to now.
2. **Flood replies** (`complain`, ~line 1004). Every rate-limited message got its own "Slow down" error, so 2000 junk
   messages produced 2000 replies. Errors for floods and oversized messages are now sent at most once a second per connection.
3. **Oversized messages** (`webSocketMessage`, ~line 565) were dropped without a word; the sender now gets one "too long" error
   (same once-a-second limit). Binary frames count as oversized.
4. **20 tables an hour** (`Lobby.allowCreate`, ~line 1086; POST /api/tables ~line 111): returns the seconds until the oldest
   of the 20 is an hour old; the 429 says how many minutes to wait and that joining by code still works, with `retryAfter`
   and `Retry-After`. `CREATE_PER_HOUR` constant. The response comes at once (no hang) before and after.

## Test bug fixed
`passOrBid` in online-net (and my first draft of online-stab) bid `'7NT'`, which is not a legal call string (`'7N'` is),
so a human who should have kept the auction alive sent an illegal call, got no error, and the table waited forever.
It made my race section fail 2 of 7 runs on both main and the branch (auction stuck at P P P, W to call). Now `'7N'`.
In online-net it only bites when the robots also pass throughout, which is why it had not shown.

## What I tried that did not help / was not a bug
- Serialising `allowCreate` (the address hash is a non-storage await, so two creates could in theory read the same count).
  30 parallel creates from one address gave exactly 20/10 on main as well, so I left it out (not measured as a bug).
- Hibernation proper can't be triggered in wrangler dev; the restart test is the stand-in.

## Open findings (not my files)
- **`js/app.js:1457-1466`**: `api()` throws `HTTP 429` and the create button shows "Could not open the table. Check your
  connection and try again." for the hourly limit (and for every other error). It should read the JSON `error` (now a full
  sentence) on a non-OK response and show it. `fetch` there also has no timeout, so a server that never answers leaves the
  button disabled until the browser gives up; an `AbortSignal.timeout(15000)` would end that.
- README's Tests bullet (README.md:122) should mention `online-stab.test.mjs` and `online-restart.test.mjs`.
- An illegal call/card from a client gets no error message (`ACTIONS.call` returns false with no `G.fail`). The page never
  sends one, but it made the test bug above silent.
- Carried: an unseated host who closes the tab hands on the job only at the next action; `js/daily.js` posting retry.

## Checks
`node build.mjs && npm test` all ok; `node tests/sim.js | head -1` errors 0, long 0. On a branch server with the test vars:
online.test all passed, online-multi all passed, online-adv all passed, online-net all passed, online-stab all passed, online-restart all passed.
