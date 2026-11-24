# HANDOFF-ui4: UI for the round-2 server features, round-3 leftovers, seated online play in a browser

Files changed: `bridge/js/app.js`, `bridge/style.css`, `bridge/index.html` (one line), `bridge/README.md` (two UI sentences in the Online section). CACHE not bumped. Nothing pushed or deployed.

How it was tested: `cd bridge && node build.mjs && npx wrangler dev --port 8795 --var TEST_TIME_SCALE:0.0167`. Playwright (Chrome, `channel: 'chrome'`) with several browser contexts (separate identities) at once. Each context answers `config.js` with `BRIDGE_API = ''`, so the page talks to the local Worker. Scripts are in `/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/ui4/`:
- `lib.js`: helpers (person, createTable, join, playBoard; humans bid and play with the robot logic by clicking).
- `seated.js <tag> <boards>`: host, a 390 px phone player and a desktop player, plus one robot, playing full boards.
- `features.js <tag>`: Seats window (rotate, then swap), a player leaves, Next refused, Add robot, a player away mid-board with the robot standing in, the player coming back, the replay of board 1 (vs line), Results with per-person totals, and the hand record.
- `phone.js <tag>`: host on a 390 px phone, a player on a phone held sideways (844x390), a desktop player and a spectator.
- `hintwrap.js`: hint outline on Pass, and long suits in phone side hands.
- `play.js`: the ui3 practice script, pointed at :8795. Card clicks now hit the visible corner (`position`); before, the harness's "click fail" errors came from clicking the centre of an overlapped card, not from the app.

## Done (commits afa8e7d, 2294fb2)
1. **Seat moves (host, between boards):** the end-of-board panel has a small **Seats** button next to Next board. Table settings also has **Move players**. Both open one Seats window: the four seats, "Swap [seat] and [seat]", and "Rotate seats" (`act('swap', a, b)` / `act('swap', 'rotate')`). The list refreshes live, and the window closes once a board starts. Hidden in team matches (the rooms' seats make the teams).
2. **Empty seat:** online, while a seat is empty, the panel shows "South is empty." with **Add robot** in place of Next board (more than one empty seat gives "Robot N", "Robot E"). The empty seat's own Sit here / Add robot stay as before. The server's "Fill the empty seat first" toast still appears if Next is sent anyway.
3. **Stand-in:** the existing plate tag "robot playing" now has a darker pill on the gold turn plate, so it can be read there. Checked: the auto stand-in comes in, the chat line appears, and the player takes back the seat on return.
4. **Per-person totals:** online Results (not team match) has a small Player / Boards / IMPs table: each person's IMPs against par over the boards they played (from `hist[i].players`, E-W sign flipped), and "You" for yourself.
5. **Replayed board:** the panel and the hand record say "Board 1 again: N-S +3 IMPs" (or "no swing"), from `vs`.
6. **Leftovers from round 3:**
   - The phone side hands' rank spacing is tighter, so 4- and 5-card suits fit one line at 390 px (checked with Q1096 and AKJ87).
   - The hint on Pass has a gold ring with a thin dark edge inside it, so it shows on green.
   - Windows have one close button, the sticky ✕ (the bottom Close is gone). Questions with their own answer buttons (Close the table?, Leave during the board?) have no ✕. The sideways-phone drawer's "Close" is a ✕ too.
7. **Found by playing seated online, fixed:**
   - Once a board ended, the phone side hands showed empty "♠ – ♥ –" rows. After a claim, the leftover cards stayed on the table and were still drawn after a seat swap, under the wrong people. Now no hands are drawn in the done phase (the hand record has them).
   - Clutter: every turn plate ticked "0:00, 0:01…" and every online board showed "Time 0:06" under the board box. Now the plate clock appears only after 20 s of thinking, and the board clock only with a time limit.
   - The panel's third small button (Seats) overflowed the panel on desktop, so it moved to the Next row. On a 390 px phone it wraps under Next board, which looks tidy but makes the panel a row taller.

Checked and fine: joining by link, sitting, 3 humans + robot, bidding and play by clicks on a phone, a phone held sideways and on desktop, a spectator (dummy visible, Take seat on a robot seat), claims accepted, results for every viewer, no page errors in any tab.

## For the server (not changed)
- Nothing blocking. `swap` is allowed in a team match on the server, while the UI hides it there. Consider refusing it server-side.
- When a stand-in robot finishes a whole board for an away player, `players[seat].sub` is set, but the per-person totals still credit that person. A future option is to skip or mark `sub` boards. That is a UI choice, and the data is already there.

## Left / ideas
- On 390 px, the result panel with Seats is a row taller (Next / Seats / Hand record + Review).
- Results could mark a replayed board's row (e.g. "3 = 1"). Not done, to keep the table plain.
- The spectator count "N watching" includes yourself while you are unseated.
