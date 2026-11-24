# feat-stats: personal history and statistics

## Done
- New file `bridge/js/stats.js` (loaded before `js/app.js`). It saves every finished board you sat at, practice or online, to IndexedDB (`bridge-history`, store `boards`) and keeps the newest 2,000. Each record holds the full history entry (deal, auction, play, contract, result, N-S score, and the robot table's result in practice), plus the date, your seat, the mode, the table name, your role (declarer, dummy, defender or passed), your side's score, IMPs against the robot table (practice) and IMPs against par (filled in once the double-dummy table is ready, now or when History is opened later).
- Options has a new "History and statistics" button that opens a window with:
  - date filters (all, today, 7 days, 30 days) and role filters (declaring, defending, dummy);
  - stats: boards played, average IMPs against par and against the robot table, declarer made %, defence set %, made by level as declarer, and doubled contracts;
  - the running IMPs over the last 50 boards as a tiny inline SVG;
  - a list of the newest 300 boards. Tapping a row, or pressing Enter on it, opens the usual hand record (diagram, auction, DD analysis, play review, replay, exports). This works from home and from inside a table: a stand-in `T` is swapped in only while the record is drawn, and a poll fills in the DD and review as they finish.
  - Export (a JSON download) and Clear all (needs a second tap).
- Hooks, each marked `feature: stats`: one line at the end of `render()` in app.js, one button in `showOptions()`, one script tag in index.html, and CSS at the end of style.css.

## Tested
- `npm test` passes.
- Playwright (Chrome) scripts are in `/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/feat-stats/` (`t.js`, `t2.js`). Each plays practice boards with a robot in the South seat, then:
  - checks that the boards are saved and survive a reload;
  - opens History from Options and checks the stats and the role filter;
  - opens a board's hand record from home, and from inside a table on a phone viewport, where the table carries on afterwards;
  - checks that Export downloads and that Clear empties the list.
- No page errors.
- Online boards use the same `Stats.note` path (the seat comes from `rec.players`), but were not tested against a live Worker.

## Left
- "Play this deal again" is hidden for history boards (the stand-in table's phase is `history`).
- The row's IMPs column shows the robot-table IMPs if there are any, else par.
- There is no import of an exported file.
- Team-match boards are saved, but there are no other-room IMPs.

## sw.js CORE
- Add `js/stats.js`.
