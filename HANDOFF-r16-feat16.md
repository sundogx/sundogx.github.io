# Round 16, feat16: Deal setup (a deal generator with constraints)

## Resume here
- State: feature done, tested and committed. Nothing half-done.
- If continuing: 1) merge-time: bump CACHE in sw.js (not done here, by the rules); 2) optional ideas under "Next"; 3) re-run the tests below after a merge.
- Key numbers: dealing ~300-450 tries/ms (Node, desktop); presets fit 1 in 2 to 1 in 735 deals; practice budget 0.3 s.

## Why this feature
Research (BBO, Funbridge, IntoBridge, RealBridge, BridgeTricks): the app already had practice deal types (South-only
custom HCP/shape), PBN/LIN import and PBN export, a system card, hints, bidding practice, play-from-here. What BBO
has and this app lacked is **Deal source**: constraints for all four hands (HCP, suit lengths, shape, given cards,
N-S points, "rotate 180 degrees"), saved constraint sets, and the generated boards as a file. It is the main tool
people use on BBO to practise one situation with robots or a partner, so I built that.
Sources: bridgebase.com/forums/topic/81773-constraint-sets, /68892-bidding-table-and-dealer-source,
charlesandgerry.com/bridge/constraints.html, intobridge.com/news/play-with-robots-on-intobridge, bridgetastic.com Funbridge guide.

## What it does (bridge/js/dealgen.js)
- Screen "Deal setup" (home page button `#dealGenBtn`, and the table's More menu `data-dealgen`).
- Per seat (South, North, West, East panels): HCP from-to, shape menu (balanced, semi-balanced, unbalanced, 6+ suit,
  7+ suit, two 5+ suits, 4-4-4-1/5-4-4-0), each suit's length from-to, and given cards (`AK - Q -`, `AK.Q..`,
  `S AK H Q`, `♠AK ♥Q`; no "x" for small cards). Panel summaries ("15-17 HCP, balanced, holds ♠AK").
  Phones: West/East panels start closed unless something is set for them.
- Both sides: N-S HCP from-to, N-S best fit, E-W best fit (8+..11+), "Turn the deal round at random" (N<->S, E<->W).
- 12 ready-made setups ("Start from…"), Save as… / Delete / Clear; saved in localStorage `bridge-dealgen`.
- Live status: "About 1 deal in N fits (x%)", a "rare" warning when a practice board might not find one in 0.3 s,
  and the setup's mistakes in red (card given twice, lengths that cannot make 13, given cards over a length or HCP
  limit, reversed ranges); Play and Download are off while there is a mistake.
- Sample deal (compass diagram with HCP, board number/dealer/vul cycling 1-16) with the robots' auction (`botCall`),
  every call tappable for its meaning (`showExplain`), and the contract. "Another" deals again.
- "Play these deals": sets `Prefs.deals = 'gen'` (Options > Deals in practice shows "My deal setup") and opens
  practice. If the open practice board has no call by you yet, it is dealt again with the setup, keeping its number
  (system message "Board n dealt again with your deal setup"); otherwise a toast says the setup starts next board.
  From an online table it only sets the option and returns to the table.
- "Download PBN": 4/8/16/32 boards, numbered from 1 with standard dealer/vul, `% PBN 2.1`, Event = saved name.
- Escape or Leave goes back where it was opened from (table or home), as the explorer screens do.

## Hooks outside dealgen.js
- `index.html`: script tag after learn.js (before app.js); home button; More menu button. All marked `feature: dealgen`.
- `sw.js`: `js/min/dealgen.js` added to CORE (CACHE not bumped).
- `style.css`: a `feature: dealgen` block at the end (plus phone rule: Leave at the right end, as the other practice screens).
- `tests/all.js`: `dealgentest.js` added to npm test.
- No change to app.js, deals.js, explorer.js or ux.js: dealgen.js wraps two globals at load time instead —
  `practiceDeal` (deals.js; kind 'gen' -> the setup, else unchanged) and `bxHideScreens` (explorer.js; also hides
  this screen when the app opens a table or home), and adds `['gen','My deal setup']` to `DEAL_TYPES`.
  If a merger prefers explicit hooks, those three lines are the places.
- README: a "Deal setup" section and a row in the file table.

## Owner's UI choices
Kept: red ♥/♦ everywhere (panel suit labels, summaries, sample, auction grid via `auctionGridHTML`), white auction box
with W/N/E/S headers and red vulnerable headers (reused grid), thin outlines, no animation, no new labels on the table,
Leave at the right end on phones.

## Tests
- `node tests/dealgentest.js [n]` (in `npm test`): card parsing (6 formats + bad input), every compile check,
  spec normalisation, n=300 random setups (HCP, shapes, lengths, given cards, N-S range, fits, rotation) whose deals
  are checked by an independent checker (engine `hcp`/`suitLengths`), all 12 presets, rotation rate (60-140 of 200),
  a whole given hand, giving up in time, PBN read back by `js/share.js` (`pbnBoards`, `parsePBN`).
- `NODE_PATH=<playwright-core dir> node tests/dealgen.pw.mjs [--shots=dir]`: phone 390x844 (touch) and desktop
  1280x800, 25 checks each, all ok: open/focus, preset, given cards, status, sample fits, robots' auction and
  explanation bubble, Another, no sideways scroll, mistake shown + Play off, save + reload, PBN 8 boards all fitting,
  Escape, Play these deals (board fits, 20 more `practiceDeal` boards fit), Options shows My deal setup, More menu
  open + Leave back to table, untouched practice board dealt again with the same number, no page errors.
- `npm test` passes; `node tests/sim.js` last line errors 0, long 0.
- Screenshots: screenshots/r16-feat16/ (390-/1280- dealgen, dealgen-error, dealgen-table, home).

## Tried / not done
- Rejection sampling on strings via `deal()` was ~10x slower than card numbers; the loop uses Int8Array card numbers
  and checks seat by seat (early exit).
- Not done: online tables with a setup (the server deals; would need the spec validated and dealt in src/worker.js
  within its CPU budget), dealer-relative constraints ("first seat to open"), losing-trick count or controls,
  BBO Dealer-script syntax.

## Open findings elsewhere
- `js/skip.js:17` Skip deal increments the board number for a skipped board (board numbers jump); Deal setup's redeal
  keeps the number by decrementing first.
- `js/deals.js` Options: choosing "My deal setup" there gives no link to the Deal setup screen (a one-line link in
  `dealsOptionsHTML` would help; not my file).
