# Feature: website performance

## Measured (Chrome via Playwright, local static server with ETags and max-age=600, 1280x800)
Server-side counts (requests / bytes actually served), before -> after:

| step | before | after |
|---|---|---|
| first visit (page + service worker install) | 36 req, 1361 kB | 22 req, 876 kB |
| first "Practice with robots" (5 solver workers start) | 41 req (all 304s), wasm fetched by 4-5 workers | 8 req, wasm compiled once by the page |
| repeat visit | 15 req | 10 req (0 within a minute of the last refresh) |
| repeat practice start | 41 req | 0 req |

Unchanged, already fine: repeat load DCL ~45 ms (125 ms at 4x CPU throttle), click to bidding box ~150 ms
(~260 ms at 4x) when the robots don't bid first, idle 10 s: 0 layouts, 0 style recalcs, ~2 ms of tasks,
JS heap ~7 MB. A call costs ~0.2 ms of sync script and ~1 layout per render.

## What changed
- `bridge/sw.js`: stale-while-revalidate kept, but each URL is refreshed in the background at most once per
  60 s (and never twice at once). Before, every worker's `importScripts` and wasm fetch triggered its own network
  revalidation. On a first install (no older `bridge-` cache) the CORE files are added with the default cache mode,
  so files the page just downloaded come from the HTTP cache instead of downloading twice; updates still use `reload`.
- `bridge/js/analysis.js`: `ddGiveWasm(w)` sends the page's compiled solver to each new worker and holds the worker's
  other messages until it is ready. Before, the warm-up message reached the worker first, so each worker fetched
  and compiled the 300 kB wasm itself.
- `bridge/js/app.js`: the 1 s clock `tick()` returns early while the tab is hidden.

## Not done / ideas
- `defer` gives nothing here: the scripts already sit at the end of body; config.js in head is 1 kB.
- Every solver worker (up to 5) `importScripts` bidding.js (162 kB) etc. and parses it. Lazy creation of the
  lead helper workers, or fewer of them on low-core devices, would save CPU at board start (robot owners' call).
- Compressed sizes on GitHub Pages are far smaller than the raw bytes above (gzip).

## Tested
`npm test` passes. In Chrome: first and repeat loads, practice start, auction, robot opening lead and dummy
played with RobotDD.fails = 0, no page errors.

No new files; sw.js CORE unchanged. CACHE not bumped.
