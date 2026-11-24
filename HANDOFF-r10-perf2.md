# Round 10: perf2 (faster robots and harnesses, the same decisions)

Branch `r10-perf2`, from main at 56bd996. No CACHE bump, nothing in bridge/ben/.

Machine: Apple M5 Pro, 15 cores, Node 26.13.1, Chrome via playwright-core. Other agents' simulations were also running,
with load averages between 23 and 85, so all timings are noisy. CPU figures are the minimum user+sys time over 2-4
interleaved runs of the old tree (main at 56bd996, unpacked with `git archive`) and the new tree. Wall times are
minimums too.

## Edits to files other agents own (small and self-contained, for merging)

- **js/bidding.js (bidding11)**. Only two places change:
  - `auctionMetas` keeps the metas of the last auction it saw (`metasMemo`). A later auction that starts with the same
    calls (call and seat) reuses those metas and explains only the calls after them. The memo is keyed by `vul` and by
    `JSON.stringify([globalThis.BID_OFF, globalThis.BID_K])`, so the test knobs are respected.
  - The new helper `metasAdd`, and the end of `chooseCall`. When the robot's call is not a judgement double (`why`),
    `chooseCall` hands the meaning it worked out for its own alert to `metasAdd`, so the next `auctionMetas` finds it.
    A judgement double returns early, with the same result as before.
  - **Merge note:** this is correct only while a call's meaning (`explainCall`) depends on nothing but the earlier
    calls (`call`, `by`), `vul` and BID_OFF/BID_K. If explainCall ever reads alerts, hands or other globals, those must
    be added to the memo key in `auctionMetas` and `metasAdd`. Nothing mutates meta objects today (checked by grep).
    The returned arrays are fresh copies.
- **js/engine.js** (no listed owner):
  - `rankOf` uses a lookup table.
  - `playedCards` uses plain loops.
  - `remainingHand` marks played cards in a 52-entry table instead of building a Set. Anything that isn't a card falls
    back to the old way.
  - `bidValue` checks a string without a regular expression. Checked equal to the old code on all 16,384
    two-character strings and the odd inputs.
  - The new top-level names (`RANK_IX`, `CARD_SUIT_IX`, `CARD_RANK_IX`, `cardIx`, `playedMark`) don't clash with
    anything in js/ or with the src/game.js bundle.
- I didn't touch bots.js, ddplay.js, leads.js, dds-worker.js or analysis.js.

## Proof that no decision changed

- `trace.js` (scratchpad) runs 1,000 seeded boards and hashes all of the following:
  - every robot call and its alert;
  - `shown()` for every seat;
  - `describeAuction`;
  - every `botPlay` card and the result.

  The boards rotate BID_OFF sets, and every fifth board has no `vul`. The hash is identical on the old and new trees
  (cea7e047…, 57,417 lines; 600 boards: 6e885356…).
- `tests/sim.js`, with Math.random seeded through `-r seed.js`, gives byte-identical full output (md5 34d57722…).
- In Chrome, the page's own globals give exactly the same calls and cards as Node on 150 seeded boards, on both
  trees (`same.js`).
- The solver paths give the same output apart from the timing fields:
  - `playsim.js 24 12 decl,def,leadc 6 vchk`;
  - `ddacc.js 24 6 vchk 3`;
  - `LEADDD=1 NEW=… ddacc.js 16 8 cch2 4`;
  - `heurstim.js 600 cmp hcch` and `150 leak hl` (leak rows compared sorted, since ties come back in worker order
    anyway);
  - `heurfit.js 200 switch hf` (byte-identical).
  - With the final code: `leadsim.js gen` (24 boards, seed lchk; the jsonl is identical once sorted) and
    `NOCACHE=1 playsim.js 16 10 decl,def,leadc 8 fin` (identical apart from the timing).
- `bidsim.js` and `defsim.js` give the same output for 1, 6, 7 and 13 workers as the old single-threaded scripts.
  I compared on seeds 5/7 and with a scrambled score, because bidsim's own feature list changes nothing today: see
  the open findings.
- `npm test` passes, and `node tests/sim.js` shows errors 0 and long 0. Against `wrangler dev`:
  - `online.test.mjs`: all checks passed;
  - `online-multi.test.mjs`: all checks passed.

## Speed (old -> new)

| what | old | new |
|---|---|---|
| robot call (`botCall`, mean over 5,930 calls, 600 boards) | 170-204 µs | 72-106 µs (about 2x) |
| heuristic card (`botPlay`, mean over 30,940 cards) | 60-64 µs | 43-49 µs (-25%) |
| `tests/sim.js` (3,000 boards, seeded), CPU | 10.2 s | 6.7 s |
| `trace.js` 600 boards, CPU | 3.24 s | 1.82 s |
| `defsim.js 1000 setcash`, CPU in one thread | 6.0 s | 3.8 s; wall with 13 workers 1.6 s |
| `bidsim.js 1000 pendbl` | 9.4 s wall | 6.0 s in one thread; 2.3 s wall with 13 workers |
| `rulesfuzz.js 600`, CPU | 5.9 s | 3.3 s |
| `npm test`, wall | 28.5 s | 10.6 s (tests/all.js runs the scripts in parallel) |
| `heurstim.js 600 cmp`, rerun with the same seed | 13.1 s | 1.5 s (solve cache) |
| `heurstim.js 150 leak`, rerun | 4.0 s | 0.6 s |
| `playsim.js 16 8 ndecl.w,def` with a new NEW, after one run | 42-49 s | 14 s (only ndecl.w is played again) |
| `ddacc.js 16 8` with a new NEW, after one run | 22 s | 6 s |

Where the robots' time goes:

- **Bidding:** `auctionMetas` re-explained the whole auction for every call: 27% of `sim.js` CPU, plus 9% through
  `shown()` in the lead and play code. Now each call is explained once.
- **Solver robot:** 94% of the time is inside the DDS wasm, for card play, for opening leads (ddacc profile) and for
  playsim. Even the JS-heavy part (`ddConsistency` replaying `botPlay`) is small next to the solves. So in the browser,
  only the bidding and the heuristic card were worth speeding up in JS.

## Harness changes

- **tests/simcache.js** (new) has two disk caches in `os.tmpdir()`, named `bridge-simcache-*.jsonl`. They are safe to
  delete. `NOCACHE=1` turns both off.
  - `openCache(name, [harness])`: playsim's sampled playouts and ddacc's sampler choices.
    - The cache is named by a hash of every js/*.js file, compiled.wasm and the harness file, so any code edit starts
      an empty cache.
    - Keys hold the seed, board, K, the CUR and NEW options and ODD/DBL/LEADDD.
    - Results are deterministic because the harnesses give the sampler no time budget.
    - The "ms each" of a reused result is the time from when it was first computed.
    - Each harness prints how many results were reused.
    - ddacc runs with `DUMP` don't use the cache.
  - `cachedSolve(solve)`: exact double-dummy solves of real positions in heurstim, heurfit and ddacc's real-deal solve.
    - Keyed by the position (trump, leader, cards in the trick, PBN, mover).
    - The file is named by a hash of compiled.wasm, ddplay.js and engine.js only, so it stays valid while bots.js or
      bidding.js change. That is the heur9 workflow.
- **tests/bidsim.js and tests/defsim.js** run on worker threads. The new last argument is the number of workers
  (default cores-2).
  - Every worker deals every board, to keep the LCG sequence, and plays only its own boards.
  - The totals are added in board order, so the output is the same for any number of workers.
- **tests/rulesfuzz.js** claims reference memoises only at the start of each trick. It is a pure function, and the old
  key at a trick start was the same string, so the values are unchanged. The test takes half the time.
- **tests/all.js + package.json:** `npm test` = `node tests/all.js`.
  - It runs the same scripts with the same arguments in parallel, prints each one's output in the old order, shows
    only the last line of sim.js, and fails if any script fails (checked with a missing script).
  - `npm run test:serial` is the old chain.
  - **Merge note:** a new test goes into the `TESTS` list in tests/all.js (and into test:serial).
- README tests row: one sentence about these.

## Tried, no gain (not shipped)

- **Rebuilding DDS with other flags.** I tried emscripten 7 with `-O3 -flto`, with `-msimd128` and with `-DNDEBUG`,
  and a 10x bigger memory setting (`SetResources(400,1)`, large transposition table). Solve times were the same within
  1%, with identical results (3,158 recorded sampler jobs; 800- and 300-job benches).
- **Solver worker start-up.** A worker takes about 110-150 ms to its first job in Chrome here: script loading plus
  thread start, under request interception and load. The wasm instance with `dds_init` takes 2-5 ms. Compiling the 5
  scripts takes about 10 ms. Not worth changing on its own.

## Open findings / ideas for the owners

1. **DDS `CalcDDtablePBN` is 2.2x faster for full double-dummy tables.** I measured 693 -> 313 ms CPU per deal on 40
   deals, with the same 20 numbers. Today the page's hand record (`js/dds-worker.js` `strain()`, 4 SolveBoards per
   strain) and `tests/bidddsim.js` (20 `ddSolveRaw` per deal) both build the table from 20 single solves. It needs a
   wasm rebuild with one more export. Add this to dds_wrapper.cpp and `_dds_calc_table` to EXPORTED_FUNCTIONS in
   build.sh:
   ```c
   EMSCRIPTEN_KEEPALIVE int dds_calc_table(char * deal, int * out) // out[strain*4 + hand], strain 0-4 = S H D C N
   {
     struct ddTableDealPBN d; struct ddTableResults r;
     size_t n = strlen(deal); if (n >= sizeof(d.cards)) n = sizeof(d.cards) - 1;
     memcpy(d.cards, deal, n); d.cards[n] = 0;
     int ret = CalcDDtablePBN(d, &r);
     if (ret != RETURN_NO_FAULT) return ret < 0 ? ret : -1;
     for (int s = 0; s < 5; s++) for (int h = 0; h < 4; h++) out[s * 4 + h] = r.resTable[s][h];
     return 0;
   }
   ```
   I didn't ship the new binary, because the page's wasm and dds-worker.js belong to the solver owners. The
   hand-record display also streams strain by strain today.
2. **bots.js `botPlay` (heur9):** after these changes it is the biggest JS cost: about 11% self time, plus
   `suitCount` 5%, `isMaster` 3.5% and GC 13% in sim.js.
   - It builds dozens of closures and three Sets per call (`known`, `ours` with spreads, and `playedCards`).
   - `suitCount` sorts copies of every suit on each call.
   - Hoisting the helpers out of the function, or building `known`/`ours` with loops, would cut this without changing
     any card. It also speeds up `ddConsistency`, which replays botPlay for up to 96 layouts per solver decision.
3. **bidsim.js** (fixed after the rebase): a feature is now a BID_OFF key; the other seats bid with it off. Example: `bidsim 2000 r3g` changes 2 auctions, -0.002 ± 0.002 IMPs; the output is the same for 1 and 8 workers.
4. **tests/fixtures/basebid\*.js** keep the old quadratic `auctionMetas`. The bidding harnesses that use them
   (bidhuman, bidoverbid, bidddsim) are already fast (2-3 s for 300-1,000 boards), so I left the frozen copies alone.
5. **analysis.js lead workers** (unchanged, as in HANDOFF-audit-perf.md): up to 4 workers are made again for every
   board. Keeping them with an idle timeout would save about 4 x 110 ms of start-up CPU per board, at about 25 MB each.
   It is a memory trade-off for the solver owners.

## After rebasing onto main b72c764 (r3g/xown, endgame search)

The rebase applied without conflicts. The trace hash, now with the BID_OFF rotation over r3g and xown and botPlay with the endgame search on (`phase: 'play'`), matches main itself on 1,000 boards (b993dd15…). Seeded sim.js output is identical too. The new rules read only `ctx.cheap`, `ctx.ok`, `h`, BID_OFF and BID_K, all of which come from the prefix or are in the memo key. `npm test`, `npm run test:serial` and sim.js pass, with errors 0 and long 0.
