# Round 15, perf8: first load and startup on a phone

Branch `r15-perf8` (from main 1056dbe). CACHE not bumped. Scripts are in the scratchpad
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/perf8/`:
- `serve2.js`: an HTTP/2 + gzip + ETag static server (like GitHub Pages);
- `serve.js`: the same over HTTP/1.1, with a byte counter;
- `measure.js`: cold and warm load at 390x844 with 4x CPU and Fast 3G (562 ms RTT, 180 kB/s);
- `practice.js`: the Practice click;
- `total.js`: every byte served on a first visit, including the service worker install;
- `smoke.js`: a seeded run through every screen, hashing each one;
- `offline.js`: offline reload and practice.

## Where the time goes (main)
- **Cold first visit** (h2, Fast 3G, 4x CPU): 37 requests and 259 kB on the wire. DOMContentLoaded and ready at
  about 2.73 s, FCP 2.35 s. Main-thread work is small: about 30 ms of script and 235 ms of tasks in all, with no long
  tasks. With the network unthrottled the page is ready in 182 ms. So a cold start is limited by bytes, and the
  scripts are 90% of the bytes (235 kB gzip from 33 files).
- **Warm visit** (service worker): 0 bytes, ready in about 100 ms. Nothing worth changing.
- **Workers and wasm:** none start at load. They start lazily, already: the solver is compiled once by the page when
  practice starts (analysis.js `ddWasm`), and the workers warm up during the auction. The Practice click shows the
  table in 230-390 ms cold and 80-530 ms warm (noisy), with about 290 ms of tasks and one 74 ms long task.

## Change: the page runs minified copies of its scripts
- `build.mjs` writes `js/min/<file>.js` for every `js/min/` script tag in index.html, using esbuild (already in
  node_modules through wrangler). It sets `minifyWhitespace` only, so comments and spacing go and names, statements,
  strings and template literals stay. Each file stays a plain script, with no bundling or wrapping, so globals and
  load order are unchanged.
  - `node build.mjs --check` exits 1 if js/min/ is out of date.
  - Without esbuild the copies are verbatim.
  - `npm test` regenerates js/min/ too, because workerbuild runs wrangler's build command, which runs build.mjs.
- `index.html`: the 33 script tags point at `js/min/`.
- `sw.js` CORE now lists `js/min/*`, plus the source files the solver workers import (engine, bidding, leads, bots,
  ddplay, dds-worker). It no longer lists the other raw page scripts. The fetch handler still caches anything else
  on first use.

### Measured (h2, Fast 3G, 4x CPU, median of 3, two interleaved rounds)
| | main | branch |
|---|---|---|
| cold bytes | 259 kB | 196 kB (-24%) |
| cold ready (DCL) | 2733 / 2730 ms | 2401 / 2393 ms (-12%, -335 ms) |
| cold FCP | 2352 / 2376 ms | 2204 / 2188 ms |
| warm ready | 109 / 96 ms | 133 / 94 ms (same within noise) |
| unthrottled cold | 182 ms | 197 ms (same within noise) |
| requests | 37 | 37 |
| long tasks at load | 0 | 0 |

### Same behaviour
- `smoke.js` seeds Math.random and stubs the lobby API. It visits home, Options, bidding practice, daily deals,
  explorer, flash cards, lead practice, practice with robots (and passes through the auction), the system card,
  played cards and New practice.
  - Every screen's text hash is identical on main and branch.
  - Window has 1767 globals on both.
  - No page or console errors.
- Offline: after a first visit, an offline reload opens the app, starts practice, and the DD worker loads.
- `node build.mjs && npm test` passes. `tests/sim.js` reports errors 0 and long 0.

### Cost and merge notes
- **js/min/ is a generated file set that is committed**, because GitHub Pages serves the repo as it is. It
  differs from src/game.js, which is gitignored. After any edit to js/*.js, run `node build.mjs` (or `npm test`) and
  commit js/min/. If js/min/ is stale, the site runs old page code.
  - Suggest adding `node build.mjs --check` to tests/all.js (I don't own tests/).
  - Suggest adding a line to the README files table.
- **First-visit total** (page plus the service worker install, h1 byte counter): 458 kB on main, 487 kB on branch
  (+28 kB). The install now downloads the raw engine/bidding/leads/bots/ddplay for the workers; on main those came
  from the HTTP cache. This happens after the page is ready.
  - Optional follow-up, not done because I don't own these files: let the workers import the min copies too. That
    means `js/dds-worker.js:15` importScripts `'min/engine.js'` and so on, and `u('min/engine.js')`/`u('min/ddplay.js')`
    in js/analysis.js:161 and js/learn.js:91. With that, the raw files can leave CORE, and the first visit drops by
    about 90 kB in all.
  - ben/ben-worker.js imports `../js/*.js` raw (BEN is optional). Leave it.
- Stack traces in minified code have long lines. The names are unchanged, so traces stay readable.

## Tried or considered, not shipped
- Bundling the 33 scripts into one file would save about 20 kB more gzip and 32 requests. It isn't
  behaviour-identical: in one file, a later script's `function` is hoisted and a `typeof` of a later `const` hits the
  TDZ. Not worth the risk. Requests already overlap on h2.
- `minifySyntax` saves only 1.5 kB more and rewrites statements, so it was left off.
- Lazy-loading feature modules runs into `typeof X` hooks in app.js (not my files). The earlier audit said the
  same.
- Deferring SW registration: the install starts while app.js runs, but it doesn't delay DCL or load (measured
  load = DCL + 7 ms). No gain.

## Open findings
- First visit when Practice is pressed before the service worker install finishes: the page's `ddWasm`
  (js/analysis.js:34) and the SW install (sw.js install) both download compiled.wasm (112 kB gzip). On Fast 3G that
  is about 0.6 s of duplicate transfer. Rare (you'd have to click within a second or two of the first load).
