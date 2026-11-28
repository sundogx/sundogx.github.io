# r16-stab3: UI and online stability (branch r16-stab3)

## Resume here
- State: review fixes (REVIEW-r16-stab3.md items 1-4) done and committed; see "Review fixes" below. Nothing half-done.
- If resuming: only the open items at the end remain (offline worker patch belongs in analysis.js; online-net 2c flake).
- Playwright: `NODE_PATH=/private/tmp/claude-501/-Users-admin/c95d256f-4c77-4778-9fcf-01deefc13883/scratchpad/pw/node_modules` (playwright-core installed there). `bridge/node_modules` is an untracked symlink to the main checkout's; don't commit it.
- Server: `npx wrangler dev --port 8979 --inspector-port 9311 --var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000` (give each wrangler its own --inspector-port, or a second one fails with "Address already in use"), then `BRIDGE_URL=http://localhost:8979 STALE_MS=3000 node tests/online*.test.mjs`.

## Review fixes (after REVIEW-r16-stab3.md)
1. Desktop auction fits again: where the top bar keeps its places (practice tables, >560 px) the table height is
   `--feltH: clamp(320px, calc(var(--vh) - 417px), 530px)` (was -380 px, which assumed a one-row bar).
   Measured (probe, practice, auction then play): 1280x800: bar 66, felt 383 in auction and play, bidding box bottom 792 <= 800, scrollY 0
   (main: felt 420, box bottom 792). 1366x768: bar 66, felt 351 in both, box bottom 760 <= 768, scrollY 0.
   Screenshots: scratchpad/probe/fit-after-1280x800-{auction,play}.png, fit-after-1366x768-{auction,play}.png.
2. The reserved places now apply only at practice tables (`.topbar:has(#ltMoreBtn:not(.hidden))`) for all four buttons; online tables are as on main.
3. api(): AbortController + setTimeout (15 s) instead of AbortSignal.timeout (Safari < 16); the timer also covers reading the body and is cleared.
4. worker.js: the create route's 'bad request' is a sentence ("Could not open the table: the request was not understood. Reload the page and try again.").

## New test: `bridge/tests/ui-stab.pw.mjs`
`NODE_PATH=<dir>/node_modules node tests/ui-stab.pw.mjs [--vp=phone|desktop] [--only=api,offline,history]`
- api: "Open a table" against a server that never answers, and against a 503 with a JSON error.
- offline: first visit, no service worker, then the network drops: (all) every request fails; (imports) the workers' own
  scripts load but what they import doesn't. Plays 25 s of practice, opens Last trick and the hand record. Catches page
  errors, console errors, worker errors (CDP Log) and window `error` events.
- history: 230 boards in one practice session.

## Fixes (each reproduced first)
1. **api() had no timeout; non-OK answers hid the server's message** (`js/app.js` api(), createBtn).
   `fetch` gets `AbortSignal.timeout(15000)` (`API_TIMEOUT_MS`; skipped where the browser lacks it). The create toast shows
   the server's JSON `error` for every status, not only 429. The three create errors in `src/worker.js` are now sentences
   ("Enter your name first, then open the table.", "Could not open the table (its code was taken). Please try again.",
   "Could not open the table. Please try again.").
   Repro (ui-stab --only=api): before: button still disabled after 30.5 s, no toast; a 503 showed "Check your connection".
   After: button back after 15.0 s with "Could not open the table. Check your connection and try again."; the 503 shows the server's sentence.
2. **Home screen layout shift 0.075 after reload / back** (`js/ux.js`, `style.css`).
   Cause: with a daily deal in progress, "Daily deals, board 1 of 4" (193 px instead of 100 px) no longer fits the second
   row of mode buttons (row 690 px; 769 px needed), so Lead practice wraps to a third row and everything below moves 46 px.
   Chrome paints the default labels while the 30 scripts still load; init sets the saved labels only after `await loadMe()`.
   Fix: ux.js (the last script) sets the labels (`renderPracticeBtn()`, `Daily.renderHome()`) and then adds
   `html.home-ready`; style.css keeps `#home` below the title `visibility: hidden` until then (a 3 s CSS animation shows it anyway if a script fails).
   Setting the labels in ux.js alone was not enough in the soak (the paint comes before ux.js loads).
   Repro: `soak.pw.mjs --vp=desktop --mode=practice --secs=120 --seed=25` and `--mode=mix` seeds 22/25/26/27: before
   0.0754 in 7 of 7 runs; after: CLS 0.000-0.002 in 4 of 4 (seeds 22, 25, 27 mix and 25 practice), and in 6 more runs (seeds 31-33, phone and desktop).
   Probe (practice + daily saved, reload x2 + back at CPU x4): before 0.0754 each time, after none.
3. **Table top bar wrapped and unwrapped during a board on desktop (shift up to 0.58)** (`style.css`).
   Cause: at every desktop width (the table view is capped, so 1280 and 1440 behave the same) the practice top bar fits one
   row in the auction (1088 of 1156 px) but needs two once Last trick shows (1239 px), and goes back to one row when the board ends
   (Skip deal, Undo, Claim hide). Each change moved the whole table 37 px; when it follows a robot's card it is not near an input,
   so it counts (0.58 at 1280 CPU x4, soak seed 25 "after: background tab"; 0.029 seed 22).
   Fix: at practice tables on screens wider than 560 px (and not a phone held sideways) Last trick, Undo, Claim and Skip deal keep their place while hidden
   (`visibility: hidden` instead of `display: none`), and the table height allows for the two-row bar (review fix 1).
   Measured top-bar height (auction / +Undo / +Claim / +Last trick / board over): before 29/29/29/66/29 px at 1280, 1366 and 1440; after 66 throughout.
   Effect: the desktop practice table is 37 px lower in the auction than before, the same as in the play (matches the owner's "the table keeps one height in auction and play").
   The hidden places sit next to the title's free space, so they don't show as gaps, except Undo hidden between Last trick and Claim.
4. **Lead practice: score line pushed the menu down on phones** (`style.css`), found by the soak (phone seed 32, 0.0244 "after: tap #ltKind").
   The score ("Streak 3 · best lead 4 of 5 ...") appears after the first lead next to the contracts menu, which then wraps to a new row (hand moves 24 px at 390, 36 px at 600).
   Fix: at 760 px and below the score has its own line under the menu, kept while empty. Probe (bp-wrap y, empty -> score): before 92 -> 115 (390 px), 62 -> 98 (600); after 115 -> 115, 88 -> 88; 800 and 1000 px unchanged (no wrap there).
5. **T.history untrimmed in memory** (`js/table.js` finishBoard). A practice table keeps its last 200 boards in memory
   (`LOCAL_HISTORY`; 60 are saved, as before). Online tables are untouched (the server's record, team matches). The page's
   open hand record (`openRecord`, an index into it) is shifted with the trim so it still shows its board.
   Test (ui-stab --only=history): 230 boards -> 200 kept, last = board 230, an open record of board 151 still shows 151.
6. **online-stab limit test flake** (`tests/online-stab.test.mjs`). It drew one of 250 IPv4 addresses; two runs within the hour on the same
   server that drew the same one found its 20 tables used up. Repro: the limit section with the address pinned, run twice:
   second run "FAIL 20 tables in a row (0/20)" and "FAIL 30 at once: 0 open". Now each run uses a random IPv6 /64 in 2001:db8::/32 (2^32 choices): 3 runs in a row pass.

## Not fixed (other agents' files) / open
- **Offline worker errors reach window.onerror** (`js/analysis.js`, perf10's file; not committed here).
  ui-stab `--only=offline` mode "imports" FAILS on main and on this branch (phone and desktop): 5+ window `error` events
  `Uncaught NetworkError: Failed to execute 'importScripts' ... js/wasm/compiled.js` from `js/dds-worker.js` (also seen in the soak,
  phone seed 32, from a blob worker after "Claim 7"). The pools' `onerror` handlers drop the worker but don't `preventDefault()`, and
  `ddDropWorkers()` nulls `onerror` before late errors arrive. Verified fix (mode "imports" then passes, mode "all" still passes),
  for whoever owns analysis.js / learn.js:
  ```
  // analysis.js ddNewWorker(), after `const w = new Worker('js/dds-worker.js');`  (covers DD, RobotDD, LeadDD, lead trainer)
  w.addEventListener('error', e => e.preventDefault()); // handled by each pool's onerror: not an uncaught page error
  // analysis.js after `const w = PlayDD.w = new Worker(url);`, and the same in learn.js after `const w = Learn.w = new Worker(...)`
  w.addEventListener('error', e => e.preventDefault());
  ```
  Tried first: `e.preventDefault()` inside the 4 analysis.js `onerror` handlers: 5+ errors -> 1 (the nulled-handler case).
- Explorer on phones: shift 0.16 (`bx-main`, `exList`) 787 ms after choosing a dealer (soak phone seed 32). The render is synchronous on the change, so this
  is the input's own change painted late at CPU x4 (`exRender`), not a stray shift. Perf, not layout.
- Home fix residual: if the scripts take more than 3 s to load, the home screen shows with the default labels and can still shift once.
- Hint (when on in Options) still toggles its button each turn and can wrap the desktop top bar; not reserved, as most people have hints off.

## Online checks (branch server with the test vars)
online all passed, online-multi all passed, online-adv all passed, online-stab all passed (incl. limit x3 more).
online-net: 2c "the robot doesn't wait for an answer from a tab that went silent" is flaky on main too: fresh servers, branch 3/3 passed,
main 1st run FAIL (0 tries); on a long-running branch server that had already run all suites, 2b/2c failed 3 of 5. My server change is
only the three error strings, so this is not from the branch. Open: make 2c robust (it depends on which tab is asked and when).

## Final soaks (CPU x4, chaos on)
desktop mix seeds 41, 42 (180 s), desktop practice seed 25 (120 s), phone mix seeds 41, 42 (180 s), phone lead practice seed 32 (120 s):
0 findings, no console/page errors, CLS 0.000-0.002, listeners flat (w14 d32). stab.pw.mjs phone and desktop: all ok.
ui-stab.pw.mjs: api, offline (all), history ok; offline (imports) fails until the analysis.js patch above.

## Checks
`node build.mjs && npm test` all ok; `node tests/sim.js | tail -1` errors 0, long 0.
