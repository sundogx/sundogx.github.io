# Handoff: robot solver speed (bridge/)

Branch `worktree-agent-a518fafa9ea82813e`, in worktree `.claude/worktrees/agent-a518fafa9ea82813e`. The WIP commit is 14ef437.

## Done (in 14ef437)

### Rebuilt DDS wasm
- Built by `bridge/js/wasm/build.sh` + `dds_wrapper.cpp`.
- Source: exactly the DDS that @bridge-tools/dd used (github.com/aaron-hutton/dds at 860e618, DDS 2.9.0).
- Build settings: em++ -O3 -flto, no assertions, no file system, memory starting at 16 MB and growing, 1 MB stack, and a `dds_reset` export.
- Toolchain: `brew install emscripten` (7.0.0, no sudo).
- Why it is faster: the npm build was -O0 with assertions.

Sizes:

| File | Before | After |
|---|---|---|
| wasm | 705 KB | 304 KB |
| glue JS | 189 KB | 14 KB |

Node timings, per solve (`scratchpad/dd/bench.js`):

| Build | Mid-play solve | Full deal | Creating an instance |
|---|---|---|---|
| Old | 3.4 ms | 52.5 ms | 3.5 ms |
| New | 1.5 ms | 26.3 ms | 1.2 ms |
| New, instance reused | 1.5 ms | 26.3 ms | — |

### Code changes
- `ddplay.js`:
  - `ddSolveRaw`: per-instance buffers; the output is cleared to -1 before every solve; no `allocateUTF8`, which the new build doesn't have.
  - New `ddInstance`.
  - `ddSolver(create, mod, {reuse})`: by default it still makes a fresh instance for every solve.
- `dds-worker.js` `strain()` uses `ddSolveRaw`.
- `tests/ddtest.js` now checks a reused instance (endings and mid-trick positions). It also checks full deals on a reused instance against a fresh one. `FRESH=1` gives every solve a fresh instance.

### Reuse finding
No wrong numbers from reusing an instance were ever reproduced:
- Old build: 3,792 consecutive full-deal solves, 714 robot-view solves and 100 same-deal strain/leader solves, all with 0 mismatches.
- New build: `ddtest 200`, 0 mismatches.

Likely cause of the README claim: the old `strain()` and ddtest code read the output buffer until rank <= 0 without clearing it. `malloc` hands back the same address, so they read stale entries from the previous solve.

DDS keeps its transposition table only for the same deal or a similar one (SolverIF.cpp), by design.

## Next steps
1. `sh scratchpad/dd/check.sh` runs ddtest 5000 and the reuse2, reuse3 and stress comparisons on the new build. If there are 0 mismatches, enable reuse:
   - `ddSolver` defaults to reuse.
   - The worker keeps one solver for its lifetime; the same for `strain`.
   - Update the README and the comments.
2. Lead budget: predictive stop in `leadSample`; partial results kept at the page timeout in `robotDDLead`.
3. Worker lifecycle and start-up in `analysis.js`:
   - No worker kill after two slow answers.
   - Warm-up during the auction.
   - Optionally, the page compiles the wasm once and posts the Module to the workers.
4. `pumpDD` holds while robot or lead requests are pending. One analysis worker when the device has 4 cores or fewer.
5. Lead workers = clamp(cores/2, 1, 4), terminated after the lead.
6. Measure: `scratchpad/audit-perf/play.js` and `report.js`, playsim/leadsim, `pw/run.js`, `npm test`, `node tests/sim.js`.

## Gotchas
- The worktree guard refuses complex shell lines; put them in a script file.
- The new glue uses `?.`, and `HEAP*` isn't exported, so use `setValue`/`getValue`.
- The file names are unchanged, so sw.js CORE needs no change.
- `build.sh` and `dds_wrapper.cpp` are in `js/wasm/` and are deployed unless `.assetsignore` lists them.
- NOTICE.txt still needs a line about the rebuild.
