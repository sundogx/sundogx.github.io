# Feature: Play from here; Just declare / Just defend (round 8)

Code: `bridge/js/playfrom.js` (all logic), test `bridge/tests/playfromtest.js` (not in `npm test`; add it there when merging if wanted). README: two bullets under "Practice aids".

## Hooks outside playfrom.js (all marked `feature: playfrom`)
- `index.html`: script tag after skip.js; `#whatIfBack` button in the topbar (after Hint).
- `app.js`: `act()` calls `PlayFrom.afterAct(s)` after `dealsAfterAct`; `render()` calls `PlayFrom.render/onRender` just before `scheduleRobot()` (onRender returns early once when a fresh table needs the robots' auction); `Stats.note` skipped for `T.whatIf`; `savePractice`/`flushPractice` skip `T.whatIf`; `resultBanner` swaps the buttons for what-if tables; `startReplay` gets its start step from `PlayFrom.startStep(h)` and a second `.ctl` row with the button; `playTableHTML` adds a per-costly-card button (`bad` items now carry their index `i`); Options HTML + wire.
- `skip.js`: `Skip.ok` false for `t.whatIf`. `sw.js`: `js/playfrom.js` in CORE (CACHE not bumped). `style.css`: `.pftry` link style at the end.

## What works
- Play from here from: practice records (Review / Replay), daily records, online-table records (seat from `h.players`, rotated so your seat or declarer's is South; Back rejoins the table with `openOnline` and waits for its history), History (Stats.record) records, shared/imported deals (showSharedDeal).
- Calls and the first k cards are applied with `A.call`/`A.card` on a fresh local table before it opens, so no robot moves happen in between. Partner declared: you take declarer (180-degree turn). Opponents declared: you defend from your seat. Quarter turns swap NS/EW vulnerability so scores are unchanged (node test checks).
- End panel: "Hand record +X: n IMPs", Back to the hand record (reopens the record at card k), Play again (same start point). No Next board, so Auto-next and the N key do nothing there.
- Just declare/defend: robots bid all four hands with `botCall` (~11 ms per auction), redeal (keeping the chosen deal type, quietly) until the right side declares, up to 40 deals / 0.4 s, else turn the board. Undo before your first card is hidden; if an undo does reopen the auction the robots bid it again.

## How tested
- `node build.mjs && npm test` pass; `node tests/sim.js | head -1` errors 0; `node tests/playfromtest.js` ok.
- Playwright (playwright-core, channel chrome, files served by request interception at http://localhost:8999 since starting a local http server was refused here) at 1280x860 and 390x844 (mobile, touch): scripts in the session scratchpad `pw/t1.js` (replay → what-if → finish → Play again → Back), `t2.js` (stand-in online record where you sat East, History record, Just declare and Just defend, Options), `t3.js` (bad play by South, then the review's per-card buttons). Screenshots checked: replay button row, what-if table, result panel on phone, review list, Just defend start, Options.

## Known gaps
- A real online table was not tested end to end (no local Worker here): the stand-in test checks the origin, seat and rotation; Back's `openOnline` + wait for history isn't exercised.
- A what-if table isn't kept across a reload (deliberately not saved), and its origins map lives in memory.
- Undo in a what-if table can go back past the record's cards (even into the auction when k = 0): treated as a feature.
- On a phone the panel's "Back to the hand record" wraps to two lines.
- Just declare ignores the BEN option for the robots' auction.
