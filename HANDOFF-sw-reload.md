# HANDOFF-sw-reload: no version mixing after a deploy; the page reloads itself at a safe moment

Files: `bridge/sw.js` (logic; CACHE not bumped), `bridge/js/app.js` (block marked `feature: swreload`, plus a
one-line hook in `doAct` and one in `init`), `bridge/README.md` ("Updates (service worker)"), tests
`bridge/tests/swupdate.pw.js` and `bridge/tests/swonline.pw.js`.

## The problem (from HANDOFF-audit-ui.md)

The new service worker skipped waiting, deleted the old cache and claimed open pages, so a page left open across
an update kept its old scripts while workers it started later (`dds-worker.js` and its importScripts, the blob
workers, `compiled.wasm`) got new ones. The per-file stale-while-revalidate refresh also wrote the server's
current files into the live cache mid-session. The "new version" toast went after 15 s.

Reproduced with `swupdate.pw.js` against the old sw.js (via the audit's `swtest.js`): after B was deployed the A
page's new solver worker was B. With the new code, before the fix of a pinning race (below), the same test showed
`worker: "BA/B"`, i.e. mixed inside one worker.

## What it does now

sw.js
- Cache first, and a saved copy is never replaced. The background refresh is gone, so **every deploy must bump
  CACHE** (it already is, "Cache vNN" commits); the README says so. Files outside CORE (BEN's scripts) are fetched
  on a miss and added to the current copy only.
- The new worker still installs everything with `cache: 'reload'`, skips waiting and claims. On activate it pins
  every client open at that moment (pages and their workers, `clients.matchAll({type:'all', includeUncontrolled})`,
  limited to the scope and same-origin blob workers) to the previous CACHE and keeps that copy. Pins are stored in
  Cache storage (`bridge-meta`) because the SW is stopped when idle.
- Each request is served from its client's copy. A worker started by a pinned page is followed through its script
  request (Chrome gives `clientId` = parent page, `resultingClientId` = the worker). A blob worker has no such
  request: it gets the old copy when every open page is on one version (one tab, the usual case), else the current
  one. Navigations always get the current version.
- Old copies are deleted once no pinned client is alive (checked on activate, on the page's `hello` after load, and
  at most once a minute while a pinned client fetches). A worker pinned at its script request gets 10 s grace,
  since it is not listed among the clients until it has loaded (without this it lost its pin and its imports came
  from the new copy: the "BA/B" bug).
- On activate pinned pages get `{type:'updated'}`; a page that missed it gets it in reply to `hello`.

app.js (`feature: swreload`)
- On `updated` (or `controllerchange` when the page already had a controller) it sets `swUpdate` and checks once
  a second for a safe moment. No toast any more.
- Safe: the home screen (no table, connect not pending), or an online table in `waiting`/`done` without a claim.
  Never with a modal open, a text box focused, or unsent text in chat / alert / table code / table name (or a name
  typed but not saved). Other screens (explorer, flash cards, lead/bid practice, daily) wait until home.
- Practice: `doAct('next')` (Next button, N key, auto-next) on a finished practice board flushes the table, checks
  that `bt:practice` holds exactly this board, sets `sessionStorage['bridge-swresume']='next'` and reloads; `init`
  then reopens the saved practice (`startPractice(false)`) and deals the next board. Daily, what-if and one-off
  tables are not reloaded (wait until home).
- An open page also calls `registration.update()` when it comes back to the screen after 30 min or more.

## Tests

- `NODE_PATH=<dir with playwright-core> node tests/swupdate.pw.js .` (from bridge/; real HTTP server, persistent
  Chrome profile, versions A/B/C/D with CACHE renamed in the served copy only, every JS file and index.html
  marked, `x-ver` header on every response). All 26 checks pass:
  first visit all A; B deployed mid-board: no reload, page / new solver worker (+ its imports and wasm) / new blob
  worker / CSS all A, both caches kept; board finished: no reload, result stays; Next with a window open: no
  reload; Next: reloads into the practice table, next board dealt, history kept, all B, A cache deleted; home with
  a window open / unsent text: no reload, still all B; then reloads by itself to all C, practice still saved;
  offline: opens all C, practice continues; two tabs (home + mid-board) with D: home tab reloads to all D, the
  board tab stays on C (page and solver worker), C copy deleted after that tab closes; no page errors.
  Known limit shown by the test: in that two-tab case a blob worker started by the C tab gets D.
- `tests/swonline.pw.js http://localhost:<port>/` against `npx wrangler dev`: table waiting -> reloads by itself,
  same table, seat S kept, not away; during the auction no reload; after the board (done) reloads, seat kept,
  result still there, no page errors. Seat recovery is server-side (`webSocketClose` marks away, rejoining with the
  same secret clears it; the host job only passes after 120 s away).
- `node build.mjs && npm test` pass; `node tests/sim.js` errors 0.

## Notes / not done

- Upgrading from v53: the v53 worker's own refresh may already have written newer files into `bridge-v53` before
  this worker takes over; nothing can be done about that copy. From then on there is no mixing.
- Blob workers with old and new tabs open at once (above). The play solver blob worker is usually created early in a
  session, so this mostly affects the Learn worker.
- A deploy without a CACHE bump now never reaches people (before, it did via the background refresh).
- `.toast.update` CSS in style.css is now unused (left to keep the change small).
