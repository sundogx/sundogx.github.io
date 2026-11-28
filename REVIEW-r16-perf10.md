# Review r16-perf10 at 84764b3: MERGE (coordinator saved)
Build 0 changed; npm test, sim 0/0, swupdate 27/27 incl. main->branch upgrade variants; offline reload, DD/learn/review workers ok; icons load online; BEN loads online; esbuild 0.28.2 matches wrangler 4.162.0; byte numbers verified.
At merge (coordinator): (1) ben/ben-worker.js:13 import ../js/min/{engine,bidding,leads,bots,ddplay}.js (raw files no longer in CORE -> stale HTTP cache risk); (2) bump CACHE in sw.js.
Info: one-time old-page blob worker may hit network for raw files on first deploy; graceful. Nits: comment at dds-worker.js:16, long line build.mjs:43.
