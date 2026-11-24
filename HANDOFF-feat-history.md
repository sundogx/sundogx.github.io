# feat-history: History flags, notes, exports, leak finder; chat suit symbols

## Done
- `bridge/js/stats.js` (History window), marked `feature: history`:
  - ☆/★ flag on each row (toggles in place, saved); "Flagged" checkbox filter; Lead column (opening lead card); a note shows in a line under its row; Date column hidden under 480 px.
  - Saved board's hand record gets a bar: "‹ History" (back to the list), the flag, and a note field (200 chars, saved on typing/Enter).
  - "Select" shows tick boxes (with select-all). "PBN file" and "Print recap" use the ticked boards, else all filtered boards; a line under the buttons says which.
  - PBN: `% PBN 2.1` header plus `pbnBoard()` per board, the Date tag replaced by the record's date, flag/note as `{comment}` after `[Board]`.
  - Print recap: a print-friendly HTML window (diagram, auction, result, par, lead, note; one board never splits across pages); if pop-ups are blocked it downloads the .html.
  - `Stats.fillPar` also stores `r.par = { ns, c (par contract), ddT (contract's DD tricks) }`.
- `bridge/js/leaks.js`: "Where the IMPs went" section (a `<details>`, open by default) in the History window. Over the last 20/50/100/all filtered boards it shows IMPs lost by kind: missed game, missed slam, overbid game/slam, part-score battles, doubled contracts, other (strain/sacrifices) from contract-at-DD vs par, and declarer play / defence / opening lead from the play review (tricks your cards gave away, converted to IMPs on that board). Each kind lists up to 8 board buttons (worst first) opening the hand record.
  - Background work: a 1-1.5 s ticker; works only when the History window is open or no table is in auction/play, the tab is visible and no robot solver is busy (`ddRobotBusy`). One board at a time via `playReview(h)` (read-only use); the result is stored as `r.rv = { v, decl, def, lead }` in IndexedDB.
- `bridge/js/chatsym.js`: `ChatSym.convert` on send (hook in app.js `sendChat`); option "Suit symbols in chat" (Options, `Prefs.noChatSym`, on by default). Word-like pairs (ha, da, ca, st, dj, sk, ct, hq, ht, sq) convert only in capitals; links/emails skipped.
- Hooks: index.html (2 script tags after stats.js), app.js (`sendChat` one line, one line in `showOptions`), style.css block at the end, sw.js CORE (`js/leaks.js`, `js/chatsym.js`; CACHE not bumped). README section "History: flags, notes, leaks; suit symbols in chat".

## Tested
- `node build.mjs && npm test` pass; `node tests/sim.js` errors 0.
- Playwright (Chrome, service workers blocked), scripts in `/private/tmp/claude-501/-Users-admin-Documents/15b6824a-a1d9-49bc-a61c-0049209dc3e7/scratchpad/t/` (`t.js` desktop 1200x900 and phone 390x844, `t2.js` options): chat conversion and red symbols, option off/on and persistence; 3 practice boards played by a robot in South; flag, flagged filter, note in record and under the row, back button; PBN of all shown (3 boards, comment present) and of 2 ticked; print recap popup (2 sections); leak section filled (e.g. "Declarer play −10", "Opening lead −5") with working board links; flags/notes/rv survive reload. No page errors. Screenshots checked (hist, rec, recap, leaks, chat on both sizes).

## Known gaps
- If a table starts while a board's review is half done, its remaining positions (about 0.1 s of solving in total) still run; the review worker already pauses while a robot is thinking.
- Play kinds count every trick given away double dummy, even if the other side gave it back later; they are not added to par IMPs.
- No import of exported files (as before). Online boards were not tested against a live Worker.
- The modal focuses the first button, which is now a star in the list (a focus ring shows on it).
