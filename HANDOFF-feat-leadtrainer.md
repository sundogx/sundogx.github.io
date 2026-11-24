# Feature: opening-lead trainer (leadtrainer)

## What works
- `bridge/js/leadtrainer.js`: "Lead practice" screen (home row button `#leadTrainerBtn`, practice More menu `#ltMoreBtn`, shown only at practice tables).
- Deal: random board 1-16, robots (`botCall`) bid all four seats until East declares (South on lead); contract-kind menu (any / games and slams / notrump / suit), saved in `bridge-lt-kind`; falls back to any East contract after 3 s. Dealing runs in 40 ms slices.
- Auction grid with every call explained (auctionGridHTML on a copy of the auction, all seats robots).
- Evaluation: `ddView(t,'S')` (which calls `leadView`), sent as `leadSamples` jobs to its own DDS workers (`ddNewWorker`, up to 4 = min(4, cores-1)), k=200 split between them, soft budget 11 s (the worker's own leadSample budget), hard stop 14.5 s (late workers terminated). Progress bar = max(layouts/200, time/budget). The real deal is solved too (a view with all hands known, k=1) for the "This deal" column.
- Table per equal-card group: average defenders' tricks, set %, cost vs best, real-deal tricks (✓ = sets). Your row outlined in thin gold, best bold. "The deal" details shows all hands.
- Next / N key; Play it out = new local practice table with the hands, auction, contract and your lead applied (A.card), then openTable (replaces the saved practice table, as share.js's Play this deal does).
- Counter in localStorage `bridge-lt` {n, good, streak, bestStreak, cost}; "best" = within 0.05 tricks of the best.

## Hooks outside the new file
- index.html: two buttons and the script tag (marked `feature: leadtrainer`).
- app.js: `LeadTrainer.render(T)` in render(); `leaveLeadTrainer(false)` in showTableView(); **bug fix**: the More button used `document.querySelector('.topbar')`, which finds bidding practice's topbar once that screen has been built (it is inserted after #home, before #tableView). Now `$('tableView').querySelector('.topbar')`. The bidpractice screen had the same latent bug (More stopped opening after visiting Bidding practice).
- style.css: block at the end; sw.js: added to CORE (CACHE not bumped).

## How tested
- `node build.mjs && npm test` pass; `node tests/sim.js | head -1` errors 0.
- Playwright (chrome channel; the script serves bridge/ itself): desktop 1280x860 and phone 390x800, screenshots of lead choice, progress, results, play-out, More menu. Script: scratchpad `pw/lt.js` (`node lt.js <cpuThrottle> <desktop|phone> <boards> <playout 0/1> [cores]`).
- Timing: desktop, 4 workers: 200 layouts in 1.9-2.7 s; with 6x CDP CPU throttle (throttles main thread, workers only partly) 2.9-5.7 s; one worker (hardwareConcurrency=2): 141-146 layouts in 11.0 s, i.e. ~75 ms/layout per desktop core. A phone core 3-5x slower with 4 workers gives roughly 50-150 layouts in the 11 s budget; the hard stop keeps it under 15 s. Not measured on a real phone.
- Checked in Node that the real-deal solve via leadSample with all hands known equals a direct solve.

## Known gaps / ideas
- Workers are dropped when the hard stop hits (made afresh next board; a cold start costs ~0.3 s).
- Cutting slow layouts at the budget slightly biases the sample against slow-to-solve layouts (close contracts).
- "Best" is by average tricks only; at IMPs the set % might be the better yardstick (both are shown). No IMP column.
- No auction-likelihood weighting of layouts (the sampler's hard limits only, like the robots).
- Deals are fully random; no "interesting lead" filter (e.g. skip hands where all leads tie).
