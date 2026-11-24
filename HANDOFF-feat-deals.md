# Handoff: practice deal types (feature: deals)

## Done
- New file `bridge/js/deals.js` (loaded before `js/app.js` in `index.html`).
  - Options gets "Deals in practice": Random (default), I declare, Slam deals, Competitive auctions, 1NT openings, Preempts, Games (more strength for N-S), Custom (South from X to Y HCP, plus any shape, a 5+ card major, balanced, or a 6+ card suit). The custom fields only show when Custom is picked. Settings are kept in `Prefs` (`deals`, `dealMin`, `dealMax`, `dealShape`, `rotateDecl`).
  - Dealing uses rejection sampling with `deal()` for at most 80 ms (`DEAL_BUDGET_MS`). If nothing matches in that time, the board is a random deal and a toast says so.
  - The filters (you are always South in practice):
    - I declare: S 16+ HCP, at least 4 more than N, N-S 23+.
    - Slam: N-S 32+, or 28+ with a 9-card fit.
    - Competitive: N-S 17 to 23, both sides have an 8-card fit and a hand with 10+ HCP and a 5-card suit.
    - 1NT: the first hand from the dealer with 12+ is N or S, 15 to 17 and balanced.
    - Preempts: a 5 to 10 HCP hand with a 7-card suit (or a 6-card suit other than clubs), and nobody before it could open.
    - Games: N-S 26+.
  - "Rotate so I'm declarer" checkbox (off by default). In practice, when the auction ends with North declaring, the whole table turns 180 degrees: hands, dealer, auction seats, declarer and any tricks. You then declare from South, and a toast says so. N-S stays N-S, so vulnerability and scores don't change. It switches on automatically through the checkbox rather than asking with a prompt, which keeps the UI minimal.
- Hooks, each marked `/* feature: deals */`:
  - `js/table.js` `startBoard`: for local tables with no seed and no replay record, it tries `practiceDeal(t)` first and falls back to `deal()`. It is guarded by `typeof`, so the server bundle (src/game.js) is unaffected and was not rebuilt.
  - `js/app.js` `act()`: calls `dealsAfterAct(s)` on the new state.
  - `js/app.js` `showOptions()`: `dealsOptionsHTML()` / `dealsOptionsWire(m)`.
  - `index.html`: the script tag.
- No CSS changes.

## Tested
- `cd bridge && npm test` passes.
- Node script measuring the hit rate for each filter. Per 20,000 random deals: declare 7%, slam 2.6%, competitive 20%, 1NT 8%, preempt 13%, games 12.5%, custom (20 to 21, balanced) 0.55%. Every type found a deal in about 1 ms.
- Playwright in Chrome:
  - The Options select loads the saved value, Custom shows its fields, and the values save to prefs.
  - A practice deal with the custom setting (18 to 19 HCP, 5+ major) gave South 19 HCP with 6 hearts.
  - Slam deals gave N-S 28 to 32.
  - Forced 1NT by North, all pass: the table rotated (S holds N's old hand, declarer S, auction seats rotated, robot West led, the user plays dummy from North). No page errors.

## Left / ideas
- Rotation only happens before the opening lead. It could also work mid-play, since the transform covers tricks.
- The board box D moves with the rotation, so after a rotation it no longer matches the board number's usual dealer.
- Filters are fixed thresholds. More custom fields (North's range, specific suit lengths) could be added to `DEAL_FILTERS.custom`.

## sw.js CORE
- Add `js/deals.js` to the CORE list (sw.js was not edited, as instructed).
