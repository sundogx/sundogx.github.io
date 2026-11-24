# r15-stab1: UI stability soak (branch r15-stab1)

## Scripts (new)
- `bridge/tests/soak.pw.mjs`: random-tap soak/fuzz in Chrome (playwright-core, `channel: 'chrome'`). Serves bridge/ from a
  local HTTP server (service worker blocked, config.js -> no server). Options: `--mode=practice|daily|bp|lt|explorer|flash|mini|rubber|replay|mix`,
  `--vp=phone` (390x844 touch, taps) or `desktop` (1280x800), `--cpu=4` (CDP CPU throttle), `--chaos=1` (reloads, offline toggle,
  rotation, back/forward, hidden tab + pagehide, double taps, Escape, taps at random points), `--storage=ok|off|full`, `--secs`, `--seed`,
  `--shots=<dir>` (screenshot of stuck screens). Reports page errors, console errors, unhandled rejections, layout shifts without
  recent input (PerformanceObserver), screens with no progress for 25 s, two screens/stacked modals/horizontal scroll, "my turn to bid
  but the box is idle", and window/document listener counts by type (duplicate handlers). Exit 1 if anything found.
  `NODE_PATH=<dir>/node_modules node tests/soak.pw.mjs --vp=phone --secs=150 --seed=1`
- `bridge/tests/stab.pw.mjs`: targeted checks: reload (and hidden tab + reload) right after a card, inside the 400 ms save debounce,
  restores the same board/auction/cards; a double tap on a card plays one card; double taps on each home button open one screen;
  storage blocked and storage full: practice, daily, explorer, flash cards (incl. Reset), lead and bidding practice run without errors.
  `NODE_PATH=<dir>/node_modules node tests/stab.pw.mjs --vp=phone` (and `--vp=desktop`).

Layout-shift reports give the shift, its sources, their y before->after and ms since the last input.

Soak runs (about 35 runs of 100-180 s, phone and desktop, CPU x4, chaos on, storage ok/off/full, about 10,000 random actions).

## Fixed
1. **Flash cards Reset threw with storage blocked** (Safari private mode / blocked site data): `js/flashcards.js:179` called
   `localStorage.removeItem` outside a try, so the tap threw `SecurityError` and the stats were not reset.
   Repro: `stab.pw.mjs --vp=phone` before the fix: `FAIL storage off: ... SecurityError: The operation is insecure.`
   (soak: `--storage=off --seed=23`, "pageerror: The operation is insecure. after: tap Reset"). After: `all ok`, phone and desktop.

## Checked, no bug found
- Reload / pagehide right after a card: board, auction and cards come back exactly (flushPractice on pagehide works).
- Double taps on cards and on all home buttons: one card, one screen, no stacked modals.
- Listener counts on window/document stay flat over long soaks (w11 d32 after hundreds of boards; the early "growth" was the
  harness counting `{once}` listeners that had already fired).
- No "my turn but bidding box idle", no two screens at once, no horizontal scroll at 390 px, no stuck screen that was not a harness
  artifact (offline reload without a service worker shows Chrome's error page; the soak now goes online before reload/back).

## Open findings (not fixed, need a repro first)
- Desktop 1280x800 CPU x4: one large layout shift (0.58) whose sources are `.layout` and the table's topbar buttons (`#ltMoreBtn`,
  `.btn.small`), more than 500 ms after the tap that entered a table (seen after "click What do you bid?" and after "click 4 of
  diamonds", seeds 22 and 25). Likely the table view's first render landing late under throttling (input then counts as not
  recent), possibly the topbar wrapping when ltMoreBtn/skipBtn toggle. Not reproduced in isolation in the time left. Rendering is perf7's area.
- Home screen shift 0.0754 at load (sources `.block` x2, `#practiceNote`, `#practiceBtn`, `#flashBtn`; the note and the blocks
  below move 46 px down, about one extra row of buttons, 50-80 ms after navigation). Reproduces in the soak:
  `soak.pw.mjs --vp=desktop --mode=practice --secs=120 --seed=25` (also seeds 26-28), 3 of 4 runs, after a reload or back/forward,
  always the same numbers. Not reproduced by a plain reload script (with a saved practice, a daily in progress, high contrast,
  no-store caching, 1280/800/600/390 wide: CLS 0 each time).
  Tried: calling `renderPracticeBtn()`/`Daily.renderHome()` before `await loadMe()` in init (app.js:1580): no change (3 of 4 runs
  still shift), so reverted. Next step: dump the hero row's button labels/widths before and after in the soak (some saved state the
  soak builds, e.g. a mode or Options pref, makes a label longer after init).
- Offline with no service worker, `js/dds-worker.js:15` `importScripts('ddplay.js')` (and the solver's `js/wasm/compiled.js`, seen
  after "Last trick") throws uncaught in the worker. With the real
  service worker the files are cached, so this only matters on a first visit that goes offline.
