# Online round 2 (worktree agent-abe6bc2e6ed8c169d)

Scope: `bridge/src/worker.js`, `bridge/js/table.js` (finishBoard only), `bridge/tests/online.test.mjs`, new `bridge/tests/online-multi.test.mjs`, README online section.

Dev server: `cd bridge && npx wrangler dev --port 8793 --var TEST_TIME_SCALE:0.0167` (restart it after edits).
Tests: `BRIDGE_URL=http://localhost:8793 node tests/online.test.mjs` (about 4 min) and `node tests/online-multi.test.mjs` (about 2 min). Both pass. `npm test` and `npx wrangler deploy --dry-run` pass.
`bridge/node_modules` is a symlink to the main repo's (untracked; delete it before merging if it gets in the way).

## Fixes and changes
- **Robots stand in by themselves for an away player** the table is waiting for (their turn, or a claim or undo request that needs their answer), 60 s after they left, but only if someone else is connected. They hand back on reconnect as before. Before this, a stranger who closed the page held up the other three until someone used `sub`.
- **One alarm plan** (`planAlarm`): the board's deadline, the auto stand-in and idle deletion. Before this, an alarm that fired early with nothing to do (say a robot's alarm after its seat was taken over) reset the alarm to the idle time, so the deadline was lost.
- **Players whose close was never reported** (a server restart drops connections without telling the table) are marked away on the next action or connection, so the stand-in can come in.
- **No new board while a seat is empty.** Before this, the board couldn't finish: with onlookers seeing every hand, a newcomer can't sit down mid-board. A player the host removes mid-board is replaced by a robot for the same reason.
- **Seat moves** (host, between boards): `swap(a, b)` swaps two seats, `swap('rotate')` moves everyone one seat clockwise. Away and stand-in marks move with the people.
- **Session record**: each `hist` record has `players` ({N: {kind:'human', id, name, sub?} | {kind:'robot'} | null, ...}). A replayed board has `vs: { board, imps }` (N-S IMPs against the N-S result of the board it repeats).
- **Lobby**: a table with nobody there (`people: 0`) is hidden after 30 idle minutes (the lobby stores `emptyAt`) and comes back when someone opens it. A public table where no board was ever dealt is deleted after a day (private tables, and tables that have played, after 3 days as before). The 20-tables-an-hour limit per address is now kept in storage under a hash of the address. Before this it lived in memory, so it reset whenever the lobby slept (after about 10 s idle). Loopback addresses are exempt, for local tests.
- **Rate limits**: there is now a third bucket per address (3x the per-person allowance), because new identities cost nothing to make.
- **Think requests** (friends mode) skip connections that haven't pinged for 150 s (`getWebSocketAutoResponseTimestamp`), because a dead socket the runtime hasn't noticed would make the robot wait.
- **Team match**: a room pulls the other room's boards when someone connects (at most every 30 s), so a missed `setOther` catches up without waiting for the next board.
- Test fix: `humanMove` in online.test.mjs now accepts robots' claims. Before this, the stand-in test stalled whenever a robot claimed.

## Multi-client scenarios covered (tests/online-multi.test.mjs)
Four people send the same call at once, the same opening lead at once, a claim together with an undo, two claims at once, and accept, reject and withdraw at the same moment. Also covered: four Next presses at once, two tabs for one seat (closing one doesn't mark the player away; play goes on from the other), the player to act dropping mid-trick and reconnecting, 24 junk or hostile messages, an action flood and chat spam, two people racing for one seat, a connection switching identity, adding and removing robots mid-session, a mid-board kick, the auto stand-in and hand-back, and the lobby hiding and showing an empty table.

## UI needed (protocol is ready; the UI agent owns app.js/net.js)
1. **Seat moves**: between boards, show host buttons such as "Rotate seats" (`act('swap', 'rotate')`) and "Swap with..." on a seat (`act('swap', 'N', 'E')`). Errors come back as `{type:'error'}` toasts.
2. **Per-person totals**: the online results pane shows N-S/E-W totals. With `hist[i].players`, it can sum each person's IMPs against par (already computed client-side) over the boards they played, with the sign flipped for E-W. A replayed board can show `vs.imps` ("+3 IMPs against board 1").
3. **"Fill the empty seat first"** error after Next: the UI could offer "Add robot" on empty seats at that point.
4. The chat line "A robot is playing for North while Bob is away" is all the UI needs for the stand-in. The `subs` and `away` maps are already in the state.

## Not done / ideas
- Hibernation itself can't be exercised under `wrangler dev`. The code keeps everything that matters in storage or on socket attachments, but `robotDue` and `botFails` are memory only (harmless: a robot's pause may restart once after waking).
- Server-side robot comparison (`rec.other` as in practice) would need `simulateBoard` on the server, probably too much CPU for the free plan. A browser could compute it and send it back, but that needs trust handling.
- A board that keeps failing a robot move (5 retries) waits for a human action. Never seen in tests.
