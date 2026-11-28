# Round 16, feat17: "Your mistakes" (drills from your own boards)

## Resume here
- Status: done. The review fixes (REVIEW-r16-feat17.md items 1, 3, 4, 5, 8) are committed on `r16-feat17`. `npm test` passes, sim shows errors 0 and long 0, and `node tests/drilltest.js` passes. `tests/drills.pw.mjs` has 27 checks at each width, 54 in all, and every one passes.
- Nothing is half done. At merge, add `['drilltest.js']` to `TESTS` in `tests/all.js` (review item 2; feat16 edits that same line). Possible next steps: a "Practise these" link from "Where the IMPs went" in History, and bidding problems from your own boards.
- Key numbers: the first problem shows about 0.8 s after the screen opens with 12 new History boards (measured by the Playwright check). Checking one board takes about 0.1 s. Solving one problem takes 10-50 ms.

## Review fixes (2026-11-28)
1. **Play from here left the screen up.** Opening a table while the screen was open (for example Hand record > Replay > Play from here) left `#drills` drawn over the table. The scan timer and the worker kept running, and Escape then drew home over a live table. Fix: one line in `showTableView` (js/app.js), next to the bidding-practice and lead-practice lines: `if (typeof DR !== 'undefined' && DR.on) leaveDrills(false);`. `git merge-tree` is clean against r16-perf10, r16-stab3, r16-feat16, r16-bidding16 and r16-play16. A new Playwright check reproduces the bug: without the line it fails at both widths (`drills:true, on:true, timer, worker alive`); with the line it passes. A second check confirms Escape then stays at the table.
3. **Focus.** Focus now goes to a playable card when the screen opens and after Next or N. When nothing is shown, it goes to the first button or the kind menu. Two Playwright checks cover this.
4. **Idle worker.** The worker is now closed after `DD_IDLE_MS` (30 s) with no solve pending, and remade on demand.
5. **Blob URL.** It is revoked whenever the worker is closed: on idle, on Leave, and on a worker error.
8. **Docs.** README now gives the measured timing and notes that this screen also stores leak reviews. It also says a table opening closes the screen.
- **Merge conflict with r16-stab3.** After the first fix commit, `git merge-tree` showed a conflict with r16-stab3, which now adds rules right after the lead-practice CSS. I moved the `#drills` CSS block to after the bidding-practice rules, and all five branches now merge cleanly. I also borrowed stab3's idea for lead practice: on screens 760 px or narrower, the score line (`#drScore`) keeps its own row even while empty, so the problem does not move down after the first answer.
- Review item 6 is not changed: Play on from here comes back to the History record, as the hand record's Play from here does.

## What it is, and why this feature
Research (BBO, Funbridge, IntoBridge, RealBridge, Bridge Baron, NeuralPlay, and 2026 review sites): the app already has most solo-practice tools (play review against double dummy, leak finder, robot table IMPs, bidding and lead quizzes, deal setup from feat16, print recap). The most-cited gap for practising declarer play is **BBO's Bridge Master** (single declarer problems). Reviewers also say Funbridge's deal review shows where you stand but does not let you try again. So this feature turns **your own costly cards** into problems that you solve again, and brings them back until you have learned them. It uses the data the app already has: History plus the play review.

How it works:
- **Opening it.** Home page "Your mistakes" (after Lead practice), and the table's More menu at practice tables. Both buttons are added by js/drills.js itself, so index.html only gains a script tag.
- **A problem.** The position just before the costly card: the contract, the auction (calls can be tapped), "Tricks so far", your hand and dummy (dummy only after the lead), and a card count for the hidden hands. You tap a legal card. The position is solved for every legal card. The answer shows right or what your card costs, the tricks each card takes for your side over the whole board (a table, equal cards together), what you played at the table, and all four hands. The buttons are Next (N), Play on from here (PlayFrom.start, a what-if table), and Hand record. Escape or Leave goes home.
- **Coming back.** Leitner boxes: right sends a problem to the next box, and it comes back after 1, 3 and 7 days; it is learned after 3 right in a row. Wrong sends it to box 0, due at once, but another problem comes first. A menu picks all mistakes, declarer play, defence or opening leads.
- Details are in bridge/README.md, section "Your mistakes".

## Files (hooks kept small; merges with r16-feat16, bidding16, perf10, play16, stab3 checked clean with `git merge-tree`)
- New: `bridge/js/drills.js`, `bridge/js/min/drills.js`, `bridge/tests/drilltest.js`, `bridge/tests/drills.pw.mjs`, `screenshots/r16-feat17/*`.
- `index.html`: one script tag after leaks.js (away from feat16's lines).
- `js/app.js`: one line in `showTableView` (review fix 1).
- `sw.js`: one `CORE.push('js/min/drills.js')` line at the end. The CORE line itself is unchanged, so it merges with feat16. CACHE is not bumped.
- `style.css`: a `#drills` block after the lead-practice rules, in the middle of the file (feat16 appends at the end).
- `README.md`: one table row after js/net.js and a section before "Bidding explorer".
- `js/ux.js` is not changed (not needed).
- Owner's UI choices are kept: red ♥/♦ everywhere, the auction box is the app's own `auctionGridHTML`, thin gold outlines only, the table and its plates are untouched.

## Tests
- `node tests/drilltest.js`: 300 random legal boards (some cut short as if claimed), 1,088 problems and 7,100 positions. It checks which cards become problems and their kind (declarer: your cards and dummy's; defender: yours, with card 0 counted as the lead; dummy: none). It checks each position against the engine replayed to that point: mover, legal cards, trick so far, cards left, tricks won. It also checks the boxes, the queue order, the kind filter and merging.
- `NODE_PATH=<dir with playwright-core> node tests/drills.pw.mjs --shots=../screenshots/r16-feat17`: real Chrome, phone 390x844 and desktop 1280x800, 27 checks each, all ok. It checks the empty state, then seeds 12 boards bid by `botCall` and played by `botPlayH` into History. It checks that the first problem shows, that the playable cards equal the legal cards, and that the card played at the table really cost a trick by the solver's numbers. It answers once wrongly (cost shown, graded, saved) and once rightly (box 1, due in a day), then checks the full scan (6 problems; the leak-finder reviews were stored for all 12 boards), Hand record plus Escape, Play on from here (a what-if table at that card), the More-menu button (practice only, next to Lead practice), Escape leaving, and the kind menu. It also checks for no sideways scroll and no page errors.
- Screenshots: `screenshots/r16-feat17/{390,1280}-drills-{empty,problem,answer,right,playon}.png`.

## Tried / decided against
- I reused the play review's per-card results (`PlayDD.cache`) for the answer. They store only the best cards and the cost of the card actually played, not every card's tricks. So I added a small worker of my own that returns the full card-to-tricks map, rather than changing analysis.js.
- A wrong answer used to be due again in 60 s. That showed "All caught up" right after a miss, which was confusing, so it is now due at once, with another problem shown first.

## Open findings (outside my files)
- `tests/all.js` does not run `drilltest.js` yet (see Resume here).
- bridge/README.md: the "History" section says the leak finder works out reviews "only while the History window is open or no table is open". The drills screen now also stores them (through `Leaks.absorb`), which is harmless.
