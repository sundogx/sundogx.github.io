# Feature: bidding-only practice

## What was done
- New file `bridge/js/bidpractice.js`, loaded with a script tag just before `js/app.js`. It builds its own `#bidPractice` screen the first time it's used and inserts it after `#home`. The rest of the app's markup isn't touched.
- Home page: a new "Bidding practice" button next to "Practice with robots" (`index.html`, marked `<!-- feature: bidpractice -->`). **No `app.js` changes.**
- You bid South and the three robots (`botCall`, read-only) bid the other seats right away. Dealer and vulnerability follow the board number. When the auction ends:
  - your contract's double-dummy result and N-S score, the par contract and score, and your IMPs against par;
  - "Robot in your seat": the robots bid the whole deal with a robot in South, with that contract's DD result and IMPs against par;
  - a table of your call and the robot's call at each of your turns, judged on the real auction, with the robot call's `describeCall` text. A call that differs gets a thin gold outline;
  - the auction grid, where every call is explained (tap for the bubble, using the existing `showExplain`);
  - a "Next deal" button that takes the focus, or press N.
- Speed: each deal's DD analysis (`requestDD`, urgent) starts when the deal is dealt, and the next deal is analysed in the background during the current review. In Playwright, 5 deals including the analysis took about 3 s.
- The session score ("N deals, ±X IMPs") is in the top bar. It is kept in memory only, so it resets when you leave the screen or reload.
- "Uncontested" checkbox in the screen's top bar: East and West always pass. It is saved in localStorage `bridge-bp-unc`. It applies at once if you haven't called yet, otherwise from the next deal.
- CSS is at the end of `style.css` under `/* feature: bidpractice */`. It reuses `.bbox`/`.bcard`/`.agrid`/`.topbar`. On phones the auction moves above your hand.

## Tests
- `cd bridge && npm test` passes.
- Playwright (`channel: 'chrome'`, scratch scripts `t.js`/`t2.js` in the scratchpad `feat-bidpractice/` folder):
  - desktop 1100x900: 5 deals with bids and passes, all results showing, score adding up, Leave returns to home;
  - phone 390x844: 6 uncontested deals (East and West never bid), the N key, the explanation bubble.
  - No page errors. The only console error is the lobby's CORS fetch from a local origin, which isn't from this feature.

## Left / ideas
- The session score isn't saved across reloads, and there's no per-deal history list.
- The bid box bids on a strain tap with no confirm step. The `Prefs.confirm` option isn't respected here.
- The robot-auction line is plain text, not a grid.
- No browser back-button handling: Leave is the way out.

## sw.js CORE
Add `js/bidpractice.js` to CORE (without it, offline launches fail to load the script, though the rest of the app still works).
