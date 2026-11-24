# Handoff: MiniBridge and rubber/Chicago scoring (feature: minibridge, rubber)

Practice only. Code: `bridge/js/minibridge.js` (MiniBridge + the New practice dialog), `bridge/js/rubber.js`
(pure rubber/Chicago scoring `Rubber.*`, and `RubberUI`: the log, deal set-up and the Results score sheet).
Tests: `bridge/tests/rubbertest.js`, `bridge/tests/minitest.js` (both in `npm test`). README section
"MiniBridge, rubber and Chicago (practice)".

## What works
- Home page: **New practice** is now always shown and opens a dialog: Game (Bidding and play / MiniBridge),
  Scoring (Duplicate / Rubber / Chicago), Honours. Choices are remembered in Prefs (`pmGame`, `pmScore`, `pmHon`).
  "Practice with robots" / "Continue practice" are unchanged (continue keeps the saved table's modes).
- MiniBridge: a new table phase `'mini'` after each deal (no auction). All four plates show HCP. Declarer: the
  side with more HCP, then the partner with more; ties: 20-20 the dealer's side; partners equal, the one nearer
  the dealer (clockwise from the dealer). Dummy face up at once. Declarer's panel in the middle of the table:
  part-score (1♣..1NT) or game (5♣ 5♦ 4♥ 4♠ 3NT). Scoring choice: the chosen target *is* the contract, scored
  normally (duplicate scoreNS, or rubber/Chicago), no doubles. Robot declarers wait (up to 6 s) for the page's DD
  table (`requestDD`/`ddEntry`, read-only) and take the best-scoring strain/target; fallback heuristic `Mini.guess`.
  With Options > "rotate so I'm declarer" on, a North declarer is turned round to South before choosing.
  Results' "Robots" column = the DD-best MiniBridge choice and its DD score (filled when the DD table is ready);
  hand records hide the empty auction and say "Best double dummy".
- Rubber / Chicago: `t.rubber = { mode, honours, log, setUp }`. Each finished board is logged; each new board gets
  dealer and vulnerability from the log (rubber: vul by games won, dealer by board number; Chicago: deal 1 none,
  2-3 dealer's side, 4 both, dealers N E S W, passed-out deals redealt by the same dealer). Results get a We/They
  sheet (above/below the line, games ruled off, totals, "if stopped now" for an unfinished rubber, a list of
  finished rubbers/Chicagos). Chat notes games and finished rubbers. Duplicate scores and IMPs vs robots unchanged.
  Chicago choices: game 300/500 at once, 100 for a part-score on deal 4 that doesn't complete a game, part-scores
  carry over within the Chicago.
- Hooks (all marked `feature: minibridge` / `feature: rubber`) in app.js: act() and startPractice() call
  PracticeModes; plateHTML (HCP tags), seatBlock (dummy face up), renderFelt (panel), renderAuctionPane,
  renderResultsPane (sheet + note), render() (Mini.onRender), showRecord/otherLine, renderPracticeBtn and the
  New practice click. index.html script tags; sw.js CORE (CACHE not bumped); style.css block at the end.
  js/table.js, engine.js and the server are untouched.

## How tested
- `node build.mjs && npm test` passes; `node tests/sim.js` errors 0.
- Playwright (playwright-core, channel chrome, python http.server): desktop 1280x800 and phone 390x844;
  MiniBridge+rubber (3 boards), MiniBridge+Chicago with honours (4 boards: totals checked by hand, N-S 20 / E-W 860),
  MiniBridge+duplicate (hand record), Bidding and play + rubber (vul follows the games), reload + Continue practice
  keeps mode/log. No page errors (only the lobby's CORS fetch from localhost). Screenshots looked at.
- Note for test scripts: Playwright's `click()` on dummy's cards sometimes timed out waiting for "stable" in my runs;
  clicking via `element.click()` in the page works. I didn't see a real-user problem but didn't dig further.

## Known gaps
- Online tables: out of scope. Would need: the `'mini'` phase and a `choose` action in js/table.js (validated like a
  call, server-side, robots choosing by DD in a friend's browser or by `Mini.guess` on the server), canSee for the
  early dummy, and the rubber log + dealer/vul set-up inside startBoard/finishBoard so the server owns it; the sheet
  sent to everyone.
- The rubber log is not trimmed (practice history is cut to 60 boards; the log keeps all boards, ~100 bytes each).
- Deal-type filters that depend on the dealer (preempts, 1NT openings) are dealt before rubber/Chicago sets the dealer.
- Skip deal isn't offered in the 'mini' phase (skip.js checks auction/play only); Hint isn't offered there either.
- Robots' card play doesn't know MiniBridge's dummy is up before the lead (they lead as usual from the empty auction).
- History/statistics (stats.js) record MiniBridge boards like any practice board (robotImps from the DD-best
  choice when it was ready at the end of the board).
- In a MiniBridge game the robot's choice uses DD tricks for its declarer only (not the other hand of the side).
