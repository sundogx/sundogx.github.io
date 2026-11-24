# Feature: bidding explorer and "What do you bid?" flashcards

## What was done
- `bridge/js/explorer.js` (the explorer and the shared `bx*` helpers: hand box, bidding box, grid, hand parser,
  example hands, screen switching, keys) and `bridge/js/flashcards.js`. Both are loaded after `js/card.js`
  (`index.html`, marked `<!-- feature: explorer -->`). They build their own `#explorer` / `#flashcards` sections the
  first time they're used. **No `app.js` changes.** `bidding.js` is only read (`botCall`, `describeCall`,
  `auctionMetas`, `shown`); `alertKind`, `auctionGridHTML`, `showExplain` come from app.js.
- Ways in: home page buttons "Bidding explorer" and "What do you bid?" (next to Daily deals), and the same two in the
  table's More menu (`data-explorer` / `data-flashcards`). Leave returns to the table if one was open, else home.
- Explorer: dealer and vulnerability selects, bidding box for whoever is to call, Undo (U / Backspace), Clear.
  Every call is listed with the system's meaning (`describeCall`) and an Alert / Announced tag from app.js's
  `alertKind`; passes with no meaning are left out of the list (the grid shows them). The grid's calls can be tapped
  for the bubble. For the seat to call: type a hand (`AKQ2 J54 T92 832`, dots, suit letters, symbols, `10`, `-` for a
  void), Deal, or Example hand (a hand whose robot calls reproduce that seat's calls, about 1 s; else a hand that
  fits `shown()`'s points and lengths, with a note saying so). With a hand: the robot's call, its meaning, "Bid it".
  The auction, dealer and vulnerability persist in `localStorage` `bridge-ex`.
- Flashcards: topics Mixed / Openings / Responses / Notrump / Competition / Slam. `fcGenerate(topic)` deals (random
  dealer and vulnerability) and lets the robots bid until South faces a decision `fcTopicOf` puts in that topic; for
  slam, notrump and responses N-S get the stronger pair, and most pass decisions are skipped. You answer with the box
  (or keys), and see Right, or the robots' call, with the meanings of both calls. The next card is made in the
  background while you read. Streak, best and per-topic right/total are in `localStorage` `bridge-fc` (Reset link).
- **Equivalent calls:** only the robot's own call counts. I tried "same system meaning" (`auctionMetas` of both
  calls equal and not vague), but over 300 cards it accepted 25 calls that are clearly not equivalent (6NT ~ 2NT,
  3♠ ~ 4♠ in competition, different control bids), because the natural fallback reads them alike. So no clear test
  exists in the system as it stands, and none is accepted (comment in `fcSame`).
- Keys: one capture-phase `window` keydown listener in explorer.js. While either screen is shown it stops the
  table's own key handlers, so a table left open under it (from the More menu) can't take a P as a pass.
- CSS at the end of `style.css` under `/* feature: explorer */`. On phones the auction grid goes on top and the
  explorer's meaning list goes below the hand.
- `sw.js`: `js/explorer.js` and `js/flashcards.js` added to CORE; CACHE not bumped.
- README: section "Bidding explorer and "What do you bid?"".

## Tests
- `cd bridge && node build.mjs && npm test` passes; `node tests/sim.js | head -1` shows "errors":0.
- New `node tests/flashcards.js [n]` (not in `npm test`, to keep package.json untouched): n cards per topic, each
  checked (South to call, the robot call is `botCall`'s, the topic classifier agrees), the hand parser, example hands.
  All topics produce cards; median 1-50 ms, max about 0.5 s (notrump).
- Playwright (`channel: 'chrome'`, service workers blocked; scratch scripts `t.js`, `t2.js` in the scratchpad
  `feat-explorer/`): desktop 1200x900 and phone 390x844 (also phone dark mode). Explorer: dealer/vul change, 7
  calls, Example hand, typed hand + Enter, Bid it, Undo, keyboard 2 S, a bad hand's message, the bubble, Clear,
  persistence across reload, an auction bid to the end with Example + Bid it. Flashcards: 3 cards in every topic
  and Mixed, keyboard P and N, stats in localStorage. Opening both from a practice table's More menu (phone too),
  pressing P there doesn't bid at the table, and Leave goes back to the table. No page errors. Screenshots looked
  right.

## Known gaps / notes
- Example hands for different seats are dealt independently, so they can share cards.
- Flashcards are always South's decision; the auction before it is the robots' (with BEN off).
- `bidpractice.js` inserts its section after `#home`, so it comes before `#tableView`'s topbar in the DOM; app.js's
  More button uses `document.querySelector('.topbar')`, i.e. the first one, so after Bidding practice has been opened
  the phone More menu at a table would toggle the wrong topbar. My sections go after `#tableView` to avoid this; the
  bidpractice one could do the same (not changed: not my file).
