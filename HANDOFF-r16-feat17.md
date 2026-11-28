# Round 16, feat17: "Your mistakes" (drills from your own boards)

## Resume here
- Status: done and committed on branch `r16-feat17`. `npm test` passes, `tests/sim.js` has errors 0 and long 0, `node tests/drilltest.js` and `tests/drills.pw.mjs` (390 and 1280 px) pass.
- Nothing is half done. Possible next steps: (1) add `['drilltest.js']` to `TESTS` in `tests/all.js` at merge time (left out on purpose: feat16 edits the same line); (2) a "Practise these" link in the History window's "Where the IMPs went" (that is in js/stats.js / js/leaks.js, not mine); (3) bidding problems from your own boards (your call against `botCall`), as a second kind.
- Key numbers: the first problem shows about 0.4 s after the screen opens with 12 new History boards; checking a board takes about 0.1 s; solving one problem takes 10-50 ms.

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
- `sw.js`: one `CORE.push('js/min/drills.js')` line at the end. The CORE line itself is unchanged, so it merges with feat16. CACHE is not bumped.
- `style.css`: a `#drills` block after the lead-practice rules, in the middle of the file (feat16 appends at the end).
- `README.md`: one table row after js/net.js and a section before "Bidding explorer".
- `js/ux.js` is not changed (not needed).
- Owner's UI choices are kept: red ♥/♦ everywhere, the auction box is the app's own `auctionGridHTML`, thin gold outlines only, the table and its plates are untouched.

## Tests
- `node tests/drilltest.js`: 300 random legal boards (some cut short as if claimed), 1,088 problems and 7,100 positions. It checks which cards become problems and their kind (declarer: your cards and dummy's; defender: yours, with card 0 counted as the lead; dummy: none). It checks each position against the engine replayed to that point: mover, legal cards, trick so far, cards left, tricks won. It also checks the boxes, the queue order, the kind filter and merging.
- `NODE_PATH=<dir with playwright-core> node tests/drills.pw.mjs --shots=../screenshots/r16-feat17`: real Chrome, phone 390x844 and desktop 1280x800, 25 checks each, all ok. It checks the empty state, then seeds 12 boards bid by `botCall` and played by `botPlayH` into History. It checks that the first problem shows, that the playable cards equal the legal cards, and that the card played at the table really cost a trick by the solver's numbers. It answers once wrongly (cost shown, graded, saved) and once rightly (box 1, due in a day), then checks the full scan (6 problems; the leak-finder reviews were stored for all 12 boards), Hand record plus Escape, Play on from here (a what-if table at that card), the More-menu button (practice only, next to Lead practice), Escape leaving, and the kind menu. It also checks for no sideways scroll and no page errors.
- Screenshots: `screenshots/r16-feat17/{390,1280}-drills-{empty,problem,answer,right,playon}.png`.

## Tried / decided against
- I reused the play review's per-card results (`PlayDD.cache`) for the answer. They store only the best cards and the cost of the card actually played, not every card's tricks. So I added a small worker of my own that returns the full card-to-tricks map, rather than changing analysis.js.
- A wrong answer used to be due again in 60 s. That showed "All caught up" right after a miss, which was confusing, so it is now due at once, with another problem shown first.

## Open findings (outside my files)
- `tests/all.js` does not run `drilltest.js` yet (see Resume here).
- bridge/README.md: the "History" section says the leak finder works out reviews "only while the History window is open or no table is open". The drills screen now also stores them (through `Leaks.absorb`), which is harmless.
