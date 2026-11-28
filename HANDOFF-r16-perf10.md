# Round 16, perf10: performance (first visit bytes; render experiments)

## Resume here
- Branch r16-perf10, worktree .claude/worktrees/r16-perf10. Done: changes 1-3 below, committed. Render items measured flat and not
  shipped (section "Tried"). Nothing half-done. bridge/node_modules is an untracked symlink to the main folder's; never add it.
- Next steps if someone continues: (1) update tests/swupdate.pw.js's blob probe to js/min/ paths (see Open, owner of tests/);
  (2) feltGeom forced layout needs a felt-size cache with a redraw on resize (see Open); (3) style.css minify needs index.html.
- Harness (scratchpad, may be cleared): /private/tmp/claude-501/-Users-admin/c95d256f-4c77-4778-9fcf-01deefc13883/scratchpad/perf10/
  serve.js (gzip server, byte log, optional shared slow link), load.js (first/repeat visit bytes, offline reload + DD + blob workers),
  early.js (first visit on a 180 kB/s + 562 ms RTT link, 4x CPU, Practice pressed at DOMContentLoaded), rbench.js <root> time|dom|bench|prof|inv
  (seeded practice, 6 boards = 298 states replayed through render(); every 3rd board all hands face up, every 3rd with fake
  tricks-per-card badges), cmp.js (DOM per state), wstart.js (worker script load raw vs min).

## Changes
1. Solver workers import the js/min/ copies (2fc3ea7). js/dds-worker.js importScripts `min/engine.js` ... `min/ddplay.js`;
   the blob workers in js/analysis.js (play review) and js/learn.js (tricks per card) import `min/engine.js`, `min/ddplay.js`.
   sw.js CORE drops raw js/engine.js, bidding.js, leads.js, bots.js, ddplay.js (the page already caches the min copies).
2. package.json pins esbuild 0.28.2 in devDependencies (the version wrangler pins; exact, so js/min/ output is stable). Lock updated.
3. sw.js CORE drops icon-512.png and icon-maskable-512.png (63a40a3): only read when the app is installed, online; the fetch
   handler still caches them on first use. icon-192 (favicon, notifications) and apple-touch-icon stay.

## Measurements
First visit, every byte served incl. the service worker install (load.js, gzip, h1 byte log):
| | main | branch |
|---|---|---|
| bytes | 487,295 | 330,779 (-156.5 kB, -32%) |
| requests | 50 | 43 |
| page bytes before the install (unchanged) | 199.6 kB | 199.6 kB |
| repeat visit bytes | 0 | 0 |
Change 1 alone: 394.8 kB (-92.5 kB); change 3: -64 kB.

Slow first visit (early.js: 180 kB/s, 562 ms RTT, 4x CPU, Practice pressed at DOMContentLoaded, 3 interleaved runs each):
| | main | branch |
|---|---|---|
| DOMContentLoaded | 2554-2751 ms | 2581-2676 ms (same) |
| click to solver compiled (ddWasm) | 2096-2285 ms | 1243-1300 ms (-0.9 s) |
| click to service worker in control (offline-ready) | 2407-2507 ms | 1349-1405 ms (-1.1 s) |

Same behaviour:
- Offline (load.js): after a first visit, offline reload opens, Practice starts, a full DD table is solved by js/dds-worker.js,
  and the play-review and Learn blob workers plus a blob worker importing min/engine.js + min/ddplay.js load: same as main.
- tests/swupdate.pw.js (SW update across versions A-D, pinned pages and workers, offline) with its blob probe pointed at
  js/min/engine.js and js/min/ddplay.js: all ok (27 checks). Unmodified it fails 5 checks, only because its probe imports raw
  js/engine.js, which is no longer in CORE (so it comes from the HTTP cache at its first version). See Open.
- Worker start time unchanged (wstart.js, 4x CPU, warm cache: raw median 31 ms, min 32-34 ms; V8 parses lazily). Bytes only.
- build + npm test pass; sim.js errors 0, long 0. No server code changed (table.js untouched), so wrangler tests not run.

## Tried, not shipped (measured flat)
- patchHTML finer parts: htmlPart(open, parts, close) nodes, patched recursively when the opening tag is unchanged; seat ->
  plate / buttons / hand, a face-up hand -> one part per suit. DOM identical on 298 states (390x844 and 1280x800).
  render() at 4x CPU, alternating runs (median of 5 each): phone head 2.578 / 2.531 / 2.649 vs 2.526 / 2.486 / 2.523;
  desktop 2.507 / 2.550 vs 2.543 / 2.552. About -3% on a phone, flat on desktop: not a clear win for the extra code.
  Trap found: after a nested patch, renderHand's `getComputedStyle(documentElement).getPropertyValue('--cw')` forced a full
  restyle (+0.5 ms/render, profile 17% in getPropertyValue); a per-task cssPx memo (--cw/--ch are set by media queries on :root
  only) removed it. The patch is kept at scratchpad perf10/app-nested.js.
- renderAuctionPane through patchHTML (grid, trick box, note as parts, so a trick redraws only the trick box): DOM identical;
  renderAuctionPane 0.135-0.154 -> 0.136 ms/render, renderSide 0.27 -> 0.25, render() within noise. The rebuild happens 13 times
  a board and the side pane is a small cost. Not shipped.
- compiled.wasm downloaded twice when Practice is pressed during the SW install: not reproduced. Chrome's HTTP cache lets only
  one request for the same URL fetch at a time, so the page's fetch and the install's share one download (early.js: 1
  download in all 12 runs, main and branch). Safari not tested. No change made.

## Where render() time goes (main, 4x CPU, profile of 3x298 renders)
patchHTML self 21% (HTML parsing) + replaceWith 11%; feltGeom 8.6% (forced layout); auctionGridHTML 9% (callDescriptions 6.7%,
once per new auction state); scrollIntoView 5.8% (render(): bidding box into view on your turn); renderChatPane 3%.
Forced layouts per 298 renders: feltGeom 36, render()'s scrollIntoView 19, renderChatPane's scrollHeight 12.

## Open
- tests/swupdate.pw.js:45 (not my file): the blob probe imports `js/engine.js`, `js/ddplay.js`; change to `js/min/engine.js`,
  `js/min/ddplay.js` (what the app's blob workers now import), or it reports 5 false failures on this branch.
- ben/ben-worker.js:13 imports raw ../js/*.js (BEN is optional). They are no longer in CORE: the fetch handler caches them on
  first BEN use, as it already does for ben/*.js. After a deploy, a first BEN use may get them from the HTTP cache (GitHub
  Pages max-age 600) like ben-core.js already can. Switching ben-worker.js to ../js/min/ would match the page exactly.
- feltGeom (js/app.js) forces a layout in 36/298 renders. Every one follows a real change earlier in render(): renderTop showing
  or hiding Last trick / Undo / Claim, or the `bidding` class on #tableView. Avoiding it needs the felt's size from a
  ResizeObserver and a felt redraw when the size changes. That only moves the layout to the observer, at the cost of a second
  felt pass in exactly those renders, so it is unlikely to win.
- style.css (12.5 kB gzip) could be minified by build.mjs like js/min/, but index.html (not mine) would need to point at it.
