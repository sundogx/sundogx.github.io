# Feature: learning mode and robot strength (feat-learn)

Code: `bridge/js/learn.js`, plus marked `feature: learn` hooks:
- `index.html`: the script tag.
- `sw.js`: CORE (CACHE not bumped).
- `js/app.js`, 5 one-liners: the face-up test in `seatBlock`, `Learn.decorate()` at the end of `renderFelt` and `renderHand`, `Learn.onRender(T)` before `Stats.note`, and the Options HTML and wiring.
- `js/analysis.js`: robot strength parameters.
- `js/stats.js`: the "aided" marker in History rows.
- `style.css`: the badge.
- `tests/ddacc.js` and `tests/playsim.js`: a `{"heur":1}` NEW entry, which plays the heuristic card.
- README: "Learning mode and robot strength".

## What works
- **Show all hands** (Options, off): practice only. Every hand is face up during the play, as columns or rows depending on the room (the same layout code as dummy).
- **Show tricks per card** (Options, off):
  - On your turn, and on dummy's when you declare, each legal card gets a small thin badge: the tricks your side takes in the whole board, double dummy (tricks won so far plus the DD result from here).
  - Cards that lose a trick get a grey badge.
  - Each position is solved once, in a blob worker of its own (the same few lines as the play review), cached by `playKey`. It waits (polling every 300 ms) while `ddRobotBusy()`.
  - Badges appeared 3–13 ms after the turn began, in the browser runs.
  - Badge placement by hand layout: bottom-left on the fan, top-centre on the dhand columns, a superscript in the rows layout.
- **Aided boards:** a board played with either aid on gets `h.aided = true` on its history record. This is set before `Stats.note` clones the record, so the saved History record has it too. History rows show a small grey "aided". There is no filter yet: the flag is there for one (the stats/history agent owns `stats.js`).
- **Robot strength** (Options select, Strong default, practice robots only):
  - How it works: `robotDDCardStd` asks `Learn.robotLevel(t, seat)`. That returns null for online tables, the daily deal, and seats a human controls (so the Hint keeps full strength). The level is passed as parameters through `robotDDSolve` / `robotDDOpts` / `robotDDLead` / `robotDDSplit` (new optional `lv` argument, `robotDDParams`).
  - `ddplay.js` is unchanged; no hook was needed there.
  - Online, friends-mode, and server robots are unchanged. Bidding is the same at every level.
  - The levels:

    | Level | Card play | Lead |
    |---|---|---|
    | Beginner | heuristic (`botPlay`, `botLead`) | heuristic |
    | Club | K 4, minK 3, no play reading (pool 0), 0.8 s | 12 layouts, 0.9 s |
    | Strong | unchanged | unchanged |
    | Expert | K 48, pool 192, 3 s | 96 layouts, 3 s |

## Measured (tests/ddacc.js, 200 boards, per-decision double-dummy cost vs Strong, K=24 baseline)
| level | declarer IMPs (tricks) | defence IMPs (tricks) | lead IMPs | ms per decision |
|---|---|---|---|---|
| Beginner | −0.137 ± 0.033 (−0.053 ± 0.009) | −0.138 ± 0.034 (−0.030 ± 0.008) | −0.10 ± 0.08 | 0 |
| Club | −0.032 ± 0.023 (−0.011 ± 0.005) | −0.092 ± 0.030 (−0.012 ± 0.007) | −0.11 ± 0.09 | ~0.1x |
| Expert | −0.001 ± 0.009 (−0.001 ± 0.003) | +0.015 ± 0.014 (+0.006 ± 0.005) | +0.07 ± 0.07 | ~2x |

- The order is Beginner < Club < Strong ≤ Expert. Expert's gain is small and only marginally significant, on defence and the lead. Strong's remaining loss per decision is already small (0.05 IMPs as declarer).
- A first Club candidate (K 8, pool 32) was barely weaker than Strong (declarer −0.008 ± 0.012), so Club was made K 4 with no play reading.
- A 25-board `playsim.js` whole-board run was too noisy to use and was stopped (Beginner as declarer −2.4 ± 0.9 IMPs/board).
- Commands:

  ```
  CUR_JSON=<page settings, k 24> NEW='{"heur":1}' node tests/ddacc.js 200 4 lv
  NEW='{"k":4,"minK":3,"pool":0,"weigh":0}' ...
  NEW='{"k":48,"pool":192}' ...
  ```

## How tested
- `node build.mjs && npm test` pass. `node tests/sim.js` gives errors 0.
- Playwright (Chrome) played full practice boards with both aids on, at 1280x800 and 390x844 (phone). The script is in the session scratchpad, `feat-learn/learn.js`.
  - Badges appeared on every turn of mine, and all hands were face up.
  - `h.aided` and the Stats record's `h.aided` were true at the end.
  - History showed the marker, and Options showed the new rows.
- A second script (`feat-learn/levels.js`) checked in the page that each level sends its parameters:
  - Beginner returns no solver card.
  - Opening-lead times on desktop: Club 0.14 s, Strong 0.7 s, Expert 1.0 s.
  - Your own seat gets null.

## Known gaps
- No History filter for aided boards (flag only). Results/hand record don't show the marker.
- A board counts as aided if "Show tricks per card" was on during its play, even if you were dummy and saw no badges.
- Expert can make a robot think up to ~3.5 s per card on slow phones (the budget is the point of the level).
- Club's lead uses 12 layouts in the page (pooled from the lead workers, which need 8 results), but ddacc measured it with 4.
