# Audit: performance (round 8)

Branch `worktree-agent-a489d3a1d4d85c0de`. Files changed: `bridge/js/app.js`, `bridge/js/analysis.js`. No CACHE bump.
All measuring was done in Playwright + Chrome DevTools Protocol, with the site served over HTTP from the worktree (so the service worker runs too).
Baseline = the same tree at 1fcc87c, served side by side. Runs alternate between baseline and new.
Scripts are in the scratchpad `perf/` folder (load.js, play.js, cmp.sh, real.js, wmem.js, resume.js, review.js, idle.js, check.js, click.js).

## Fixes

1. **The whole table was rebuilt on every state change** (app.js `renderFelt`, `renderHand`). Each card or call replaced all of `#felt` and `#myHand` with `innerHTML`, wrote `--handW` on `<html>` (which restyles the whole page), and wrote identical text into the top bar.
   Now `patchHTML(el, parts)` replaces only the parts whose HTML changed: corner, 4 seats, centre, hand. `feltGeom()` is computed once per `renderFelt` instead of up to 5 times. `--handW` is written only when it changes. `setText` and `setHTML` skip identical writes in `renderTop`, `showWatchers` and `renderPlayInfo`. `renderSeatRequests` and `renderChatHint` skip their writes when nothing changed.
   Measured on a 390x844 phone viewport at 4x CPU throttling, over 10 boards and 511 state changes (seeded deals, one change per frame, median of 3 alternating runs):

   | | before | after |
   |---|---|---|
   | layouts | 1523 | 918 (-40%) |
   | style recalcs | 1913 | 1308 (-32%) |
   | layout time | 679 ms | 491 ms (-28%) |
   | style time | 440 ms | 341 ms (-22%) |
   | mean synchronous step (includes robot logic) | 4.7 ms | 4.3 ms |

   An earlier pair of runs, with only the felt/hand patch in place and the machine under more load, gave layout 1179 to 965 ms and style 778 to 568 ms. CPU profile over 10 boards: `render()` inclusive time was 2742 ms of samples before and 1300 ms after.
   Check: `check.js` compares the patched felt and hand with a full rebuild after every state change. It ran 313 checks in each of 3 viewports (390x844, 1280x860, 844x390) with 0 mismatches. `click.js` plays real boards with taps against the page's own robots, on phone and desktop, with no errors.
2. **Continuing a practice re-solved all of its saved boards** (app.js `renderResultsPane`). It called `requestDD` for every history board, but practice's Results pane shows no par. Resuming the saved 60-board practice queued 300 solver jobs (60 boards x 5 strains). On a desktop that kept 2 worker cores busy for about 15 s; on a phone it would be minutes, running alongside the robots.
   Fix: only online tables (which show a par column) analyse the whole history. Practice boards are still analysed when they end (render) or when opened (hand record), and History/Stats still asks for whatever it lacks (`Stats.show`, leaks.js). Resuming the same 60-board save now sends 5 jobs (the current board), down from 300 (`resume.js`).
   Side effect: "Download all boards (PBN)" leaves out `[OptimumScore]` for boards from earlier sessions until each one has been opened.
3. **Idle solver workers kept 20-30 MB each for the rest of the session** (analysis.js). The 2 hand-record workers (`DD.workers`, 1 on devices with 4 cores or fewer) and the play-review worker (`PlayDD.w`) were never closed. Every board's analysis runs when the board ends, so these workers sat idle through the whole next board.
   They are now closed after 30 s with nothing queued (`ddIdleCheck`, `reviewIdle`) and made again on the next job. The page's compiled wasm is reused, so a new board's table took about 150 ms instead of about 100 ms on desktop.
   Measured RSS of warm workers (`wmem.js`): 1 worker added 31 MB, 2 added 51 MB, 4 added 82 MB. In `idle.js`, live workers went from 8 to 5 after 33 s idle; the baseline stays at 8. Board 2's table and review still complete normally.

`node build.mjs && npm test` passes, and `tests/sim.js` reports `"errors":0`.

## Measured, no change needed

- **Page load** (390x844, 6x CPU, median of 5). Cold: 680 kB over 33 requests (30 scripts), DOMContentLoaded 312 ms, FCP 244 ms, no long tasks. Warm: everything (33 requests) comes from the service worker, 0 bytes from the network, DOMContentLoaded about 180 ms. Script compile and run total about 45 ms cold and 13 ms warm.
  With network throttling (150 ms RTT, about 800 KB/s, HTTP/1.1, uncompressed), a cold first visit reaches DOMContentLoaded at 1129 ms.
- **Lazy-loading the feature modules** (explorer, flashcards, leadtrainer, leaks, card, daily, share). Tried by dropping the 7 tags. With network throttling, a cold first visit went from 1129 to 821 ms and from 680 to 585 kB. A warm load went from 90 to 80 ms.
  I didn't ship it, because the gain is mostly an artefact of the setup and it isn't a clear win:
  - GitHub Pages serves gzip over HTTP/2, so about 95 kB raw is about 28 kB on the wire and the request queueing goes away.
  - The service worker install downloads these files anyway (they are in CORE for offline use).
  - daily.js and share.js run at startup (home button, `#deal` links).
  - The other modules are reached through `typeof X` hooks in app.js.
- **Memory over 60 boards** (`play.js`, 60 boards, 3054 state changes): the JS heap stays between 6 and 17 MB, swinging with GC with no upward trend. Event listeners stay at 111-112 and DOM nodes don't grow. No leak.
- **localStorage:** `bt:practice` is 146 kB at the 60-board cap: about 2.3 kB per board, of which tricks are 1.25 kB, plus 4.6 kB of chat. `JSON.stringify` of it takes 0.22 ms on desktop. Saving is debounced at 400 ms. Fine.
- **Hand record and play review time** (`review.js`, 4 boards): the double-dummy table takes 77-624 ms (median about 300 ms). The play review takes 57-84 ms on desktop, and 136-207 ms with the page throttled 6x (CDP doesn't throttle workers). Fast enough. The board's table is usually done before the record is opened, because render asks for it as the board ends.
- **Worker lifecycle in real play** (`real.js`): up to 7 workers during the auction on an 8-plus-core machine: RobotDD 1, lead workers 4, DD 2. That is 3 after trick 2 (lead workers close), and 1 (RobotDD) once the DD workers idle out with this change. Phones get 1 DD worker and 1-2 lead workers.

## Unfixed findings

- analysis.js `leadWorkers`/`leadWorkersClose` (about lines 430-440, solver area): on an 8-plus-core device, 4 lead workers are made again on every board. Each worker's `importScripts` parses about 290 kB, including bidding.js. That is roughly 5-6 worker start-ups per board. It is a deliberate memory-versus-start-up trade-off; keeping them for the next board would save the start-ups but hold 4 x 25 MB. Left for the solver owners.
- app.js `goHome` (about line 1475) clears `DD.queue` but not `PlayDD.queue`, so a play review still running keeps solving after you leave the table. It costs at most a few hundred ms of one worker. I didn't fix it, because leaks.js shares `PlayDD.cache` from the History view.
- app.js `renderBidBox` rebuilds the three bidding-box rows on every render while you sit in the auction. They are small (17 buttons), so I left them alone; `setHTML` would cover them if needed.
- table.js `robotClaim` (inside `A.robotStep`) is about 1 ms per robot step at 4x and shows up in profiles at the same level as rendering. It is robot logic, so I left it.
- No problems found in sw.js or style.css.
