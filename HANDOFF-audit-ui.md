# HANDOFF-audit-ui: main UI audit (app.js, index.html, style.css, sw.js)

Round-8 audit of the practice table UI and the service worker's update logic, driven in a real browser
(Playwright, Chrome) at 1280x860, 1440x800, 390x844 (touch) and 844x390 (touch, landscape).

## How it was tested

Scripts are in the session scratchpad `ui/` folder (not committed; they use the shared `smoke/lib.js`):

- `play.js W H mobile boards seed speed`: plays practice boards end to end with random human actions: bids by
  mouse/touch and by keyboard (1-7 + strain, P, X), plays cards by tapping a visible part of the card and by
  arrow keys + Enter, claims with random counts, Undo, Hint (button and H), Last trick (button and L), the
  sidebar tabs / drawer, Options, Leave + Continue practice, reloads mid-board, the hand record, Review and
  its replay buttons, Next board (button and N). After every step it checks for page/console errors, a
  position that doesn't move while it isn't your turn (stuck), buttons off the screen, the page scrolling
  sideways, plates overlapping each other, trick cards over plates or hands, hands/plates off the felt, the
  result panel over a hand, and two modals at once. `runall.sh boards seed speed` runs the four sizes at once.
- `screens.js`: switches screens quickly (home buttons, every More menu entry, Options, system card,
  explorer, flashcards, lead practice, bidding practice, daily, leave buttons, shortcut keys on the other
  screens) and checks that exactly one screen is visible, no top bar or drawer stays open on a hidden screen,
  and the page is never left inert without a modal.
- `probe.js`: the two reproductions below.
- `swtest.js <bridge dir>`: a real local HTTP server and a persistent Chrome profile (service worker on):
  serves version A, lets its SW install, then switches the server to version B (CACHE bumped, every JS file
  marked with its version) and reports which version the page, its scripts and a newly started solver
  worker get, before and after reloads.

About 100 boards were played across the four sizes (fast and normal robot speed) and ~500 screen switches made:
no page errors, no console errors, no stuck states, no layout overlaps found besides the two bugs below.

## Bugs fixed (js/app.js)

1. **N (next board) did nothing on a phone held sideways.** The shortcut looked for the Next button inside
   `#felt`, but in the landscape-phone layout the end-of-board panel is drawn in `#playInfo` under the hand.
   Repro: `probe.js` at 844x390 (finish a board, press N): board stayed 1. Fix: look inside `#tableView`.
   After: board 2.
2. **The sidebar drawer (phone held sideways) stayed open into the next table.** Open "Auction & chat",
   leave the table, Continue practice: the new table opened with the drawer over it, and not inert. The More
   menu's open state had the same leak path. Fix: `leaveModals()` (called by goHome, openTable, openOnline and
   the explorer/flashcards screens) now also closes the drawer and the More menu (`closeTableMenus()`).
   Repro/after: `probe.js` "after leave+continue drawer open?" true -> false, inert false -> true.

## Service worker

`swtest.js` result (A = old version, B = new version with CACHE bumped):

```
A loaded, SW A controlling     html A, scripts A, solver worker A, caches bridge-vA
B deployed, A page still open  html A, scripts A, solver worker B, caches bridge-vB, update toast shown
reload 1                       html B, scripts B, solver worker B
reload 2                       html B, scripts B, solver worker B
```

So after an update every reload is consistent (all B). Not fixed, an inconsistency remains for a page that
stays open across an update: the new SW skips waiting, deletes the old cache and claims the page, so anything
the old page loads afterwards comes from the new version. The solver workers (`js/dds-worker.js` with its
importScripts of engine/bidding/leads/bots/ddplay, the PlayDD blob worker, `compiled.wasm`) are started
lazily, so an old page that starts practice after the update runs new worker code against old page code. If
a deploy changes the analysis.js <-> dds-worker.js messages, the robots fall back to heuristic play (errors
are caught) until the user reloads; the "new version" toast offers that, but only for 15 s.
Also, per-file stale-while-revalidate writes the server's current file into the live cache, so even without
a version change a file requested a second time in one session (workers are started many times) can come back
newer than the page.
Possible fixes, none done because each changes how updates reach people (owner's call):
- (simple) when the page gets the `updated` message, reload at the next safe moment (going home, or
  between practice boards, where the practice is saved anyway);
- (precise) keep the previous cache after activation and serve the clients that existed then from it.
  Chrome gives a dedicated worker's script request a `resultingClientId` and its importScripts that id as
  `clientId` (checked with `swclient.js`), so the old page's new workers can be followed too; blob workers
  can't be, and the ids would have to be kept in Cache storage because the SW is stopped when idle;
- drop skipWaiting and let the toast's Reload button activate the waiting worker (the usual pattern, but then
  a plain reload no longer updates while the tab stays open).
Smaller: `caches.match()` searches every cache, and an old SW's in-flight refresh can write into a cache the
new SW just deleted (it is recreated with one entry until the next update deletes it). Harmless today.
The CORE list matches every file index.html loads (checked by script).

## Checked and fine

Undo during the auction and play (and the probe in renderTop doesn't mutate the table), claims (accept,
reject, a trick finishing while the claim window is open), hints by button and H (the popup goes once you
act), Last trick, hand record and replay arrow keys, Options toggles mid-board, Leave/Continue and reload
mid-board (the board comes back where it was), double Next (A.next refuses the second), screens opened from
a table's More menu (the explorer's own key handler keeps the table's keys away), the bidding box and own
hand within the screen at all four sizes.

## Unfixed observations (minor)

- Landscape phone: with the drawer open there is no backdrop, so taps on the table do nothing until ✕ or Esc
  (by design?). Rotating to portrait keeps `.side.open`, so rotating back reopens it.
- From reading the code (not reproduced): an alert/explanation bubble opened by keyboard can stay up to its 6 s
  timer into the next board (any tap closes it).
- Landscape phone (844x390): the claim banner ("North claims 2 of 7") covers the bottom few pixels of a dummy
  shown across the top and half of South's plate; the cards stay readable (style.css `.bwrap`/`.banner` sizing).
- Last trick button stays visible after the board ends (shows the final trick; maybe intended).

No bugs found in the other agents' files during this audit.
