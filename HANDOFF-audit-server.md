# Round-8 audit: server and online tables

Area: `bridge/src/worker.js`, `bridge/js/table.js`, `bridge/js/net.js`, `bridge/build.mjs`.
New adversarial test: `bridge/tests/online-adv.test.mjs` (`BRIDGE_URL=http://localhost:<port> node tests/online-adv.test.mjs`, about 40 s).
It also runs without `TEST_TIME_SCALE`. Every check in it failed on the old code (except the hello check, see 7) and passes now.

## Bugs fixed

1. **An onlooker who saw every hand could sit down mid-board** (information leak). The host turns "spectators see all
   hands" on during a board, an onlooker looks, the host turns it off again, and the onlooker takes an empty seat
   (a robot the host removed, or a seat someone stood up from). `seatBlock` only checked the current `kibSee`.
   Fix: `settings` records `t.kibSeen = t.board` when kibSee goes off during a live board, and `seatBlock`
   treats that board as if onlookers still see everything (worker.js `seatBlock`, `ACTIONS.settings`).
   Test: "that onlooker cannot then take the empty seat during the board".

2. **Friends mode: an onlooker handed a robot's cards could then take a robot's seat mid-board.** With nobody
   seated, `askThink` sends the robot's view (its hand, and dummy's) to an onlooker's browser; `A.sit` lets anyone
   replace a robot, and `seatBlock` allowed it because kibSee was off. Fix: `askThink` sets `t.kibSeen` when the
   browser asked is not a seated player's (saved with the robot's move that follows). Test: "that onlooker cannot
   then take a robot's seat during the board".

3. **Team match: onlookers got the players' table talk and the claim lines of a board the other room hasn't
   played** ("spades are 5-0, the slam is off", "South claims 12 of the remaining 12 tricks"). The cards were
   masked (`hideBoard`) but the chat wasn't. Fix: while `hideBoard`, an onlooker gets only chat lines from before
   the board started plus other onlookers' lines (worker.js `viewFor`). Once both rooms have played the board the
   lines show again (a connection already past them in the chat sync skips them; a reconnect gets them all; the
   result line still comes as the kib copy from `announceBoth`). Test: "an onlooker of a match board the other room has not played does not get that talk".

4. **Silent connections made the table resend itself to everyone.** `leftSocket` broadcast the full state to all
   connections whenever any socket closed, including ones that never said hello (which change nothing anyone
   sees). Opening and closing raw WebSockets in a loop cost one full broadcast each. Fix: only broadcast when the
   closed connection had an identity. Test: 10 silent connect/close cycles sent the seated player 10 updates
   before, 0 now.

5. **No limit on how fast one address may open connections.** `MAX_PER_IP` (12) capped connections open at the
   same time, not the rate: connect, hello, close in a loop gave 2 broadcasts per cycle with no limit. Fix:
   `fetch` uses the existing token bucket (`allow('c:' + ip, false, 0.5)`): 10 at once, then 5 a second per
   address per table; the rest get 429 (the page's reconnect backoff retries). Test: 40 connections in a burst,
   0 refused before, 30 now. A household of four reconnecting after a deploy fits in the burst.

6. **Request bodies were read in full before any size check.** `POST /api/tables` (`req.json()`) and the admin
   purge read whatever was sent; `POST /api/daily` checked the length only after `req.text()`, so a body without
   a Content-Length was read completely. An 8 MB chunked body to `/api/tables` was read and answered 200 (it even
   opened a table). Fix: `readJson(req, max)` reads the stream and keeps at most `max` bytes (4000 for tables
   and daily, 64000 for purge); past that the rest is read and dropped, then 400. (Answering before the upload
   ends made wrangler dev's proxy fail with 500, so the body is drained, not cancelled; a Content-Length over the
   limit is still refused at once.) Test: "an 8 MB body without a length to /api/tables|/api/daily is refused"
   (200 and a new table before, 400 now).

7. **A second hello on a connection overwrote sync counters set during its hash** (race). `hello` read the
   attachment, awaited SHA-256 (not a storage call, so other events run meanwhile), then wrote back the old
   `hl/cl/ol` values: a broadcast in between would be resent, duplicating chat lines on that client. Fix: read the
   attachment again after the await. The page sends one hello per connection, so this needs a hand-made client;
   the test checks a re-hello does not duplicate chat (it passed before too, as the race window is small locally).

8. **Table creation retry could give the table the wrong host.** `POST /api/tables` set the module-global person
   (`G.setMe`) once, then retried `newTable` after an `await` when a code clashed; another request in the same
   isolate could have changed it, making a stranger `host`/`createdBy`. Fix: the builder sets `t.host` and
   `t.createdBy` to the caller's id. (Not reproduced: needs a 1 in 8 million code clash and an interleaved request.)

## Performance

- **Claim answers are remembered** (`claimAnswer` in js/table.js, used by `resolveRobotClaim` and the server's
  stand-in answers in `tidyPresence`). A person can claim, be rejected by the robots, and claim again 10 times a
  second; each answer was a fresh search of up to 20,000 nodes. Measured on src/game.js, 60 random boards after
  one trick, claims of 12/11/9: one answer median 5 ms, p90 51 ms, max 181 ms. Ten identical claims: median
  178 ms, p90 348 ms, max 604 ms before; median 4.5 ms, p90 50 ms, max 134 ms after (one search, then a lookup).
  The key is the position (playKey, all four hands, strain, declarer, claimer, n, node budget); 64 entries.
- **Broadcast builds each big JSON once per role, not per connection** (worker.js `broadcast`: `hj`, `oj`, `cj`).
  In a team match every board finished in the other room sent each connection the whole other-room history,
  stringified per socket. With 100 boards (186 KB): 12 sockets 77 ms before, 27 ms after; 60 sockets 339 ms before,
  18 ms after. Full-history resend (everyone reconnects): 12 sockets 107 -> 26 ms, 60 sockets 329 -> 13 ms.
  (Node micro-benchmark of the same JSON calls; the messages sent are byte-identical.)

## Unfixed findings

- **Daily leaderboard results are not checked** (worker.js `dailyRoute`, ~line 1110). The auction check runs only
  if the page sends `auction`, and js/daily.js (`onRender`) never does; tricks are never checked. Anyone can POST
  7NT redoubled making 13 for 100%. Sending the auction would not help much (any contract can be reached
  legally); a real check needs the play (legal cards, and claims checked with `claimHolds`). The deals are
  computable in the browser from the seed, so the leaderboard can never be cheat-proof. Each new secret is a new
  player, 40 results an hour per address.
- **Daily leaderboard rebuilds after every post** (worker.js `dailyPost` sets `dailyCache = null`; `dailyTable`
  lists every `r:` key, up to 20,000). Under heavy use each GET after a post re-reads all results. Fine at today's
  scale; if it grows, keep the 5 s cache and patch in the new row instead.
- **Time limit set mid-board counts from the board's start** (`deadline`): a host who sets 5 minutes 6 minutes
  into a board makes the robots finish it at once. Host power, but probably surprising.
- **Lobby ghost entries:** `reportLobby` fires `update()` without waiting; a close right after can let `remove()`
  arrive first (different stubs, no ordering), leaving the closed table listed up to 12 hours. Clicking it says
  the table has closed.
- **Friends mode hands robot declarer's cards to a defender's browser** (`askThink` takes seated players in turn,
  whatever side). Documented trade-off of friends mode; preferring the robot's own side when it has a human would
  narrow it.
- **Table names keep control/bidi characters** (`tableName` is only trimmed; `cleanName` only folds whitespace):
  a name with U+202E can look like something else in the lobby. HTML is escaped, so no XSS.
- **Rate limits are in memory** (`this.rate`): they restart when the table hibernates (about 10 s idle), which
  only allows a fresh burst of 20.
- A match counts as one table against the 20-an-hour creation limit but opens two rooms.

Not found: no card leaks to a claimer's partner (the robot's claim put to a human partner only happens when that
partner is dummy, who already sees declarer), dummy, or someone who stood up (they keep their seat's view);
action names and arguments are validated; races between simultaneous moves are serialised by the object.

## Files changed

- `bridge/src/worker.js`: fixes 1-8, broadcast JSON memo.
- `bridge/js/table.js`: `claimAnswer` (memo of `claimAccept`), used by `resolveRobotClaim`.
- `bridge/build.mjs`: exports `claimAnswer` to the server.
- `bridge/tests/online-adv.test.mjs`: new.

## Test runs (final code, `wrangler dev --var TEST_TIME_SCALE:0.0167`)

`npm test` passes, `tests/sim.js` "errors":0; online.test.mjs all checks passed (one random skip: "a robot
declarer's claim with a human dummy", no such board came up); online-multi.test.mjs all 45 passed;
daily.test.mjs passed; online-adv.test.mjs 12/12. Before the changes: online 50/50, multi 45/45, adv 5 failures.
