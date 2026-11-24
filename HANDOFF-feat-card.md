# Feature: the robots' system card

## Done
- New file `bridge/js/card.js` (loaded before `js/app.js`). It holds the card as data (`SYSCARD`: sections, items, a mark and an example auction) and `showSystemCard()`, which uses app.js's `modal()`.
- Sections: General, Openings, 1NT and 2NT, Responses, Competitive bidding, Slams, Leads and carding, Not played. The text comes from the README's bidding and leads sections, and the examples were checked against `botCall` and `describeCall`.
- Marks follow the ACBL card: red means alert (Smolen, 2♠ to clubs, Texas, both lebensohls, Jacoby 2NT, splinters, new minor forcing, Jordan 2NT) and blue means announced (1NT 15-17, transfers, forcing 1NT). All other items are black. Red suit symbols are always red.
- "Example" link on 37 items: it deals random hands (up to 1.5 s) until `botCall` makes that item's call. It shows the hand, the HCP, a W N E S auction box with dealer North and nobody vulnerable, and the robot's `describeCall` explanation. An "Another" link deals again. The robot's own earlier calls in the auction must be its real robot calls, but the other hands are random.
- Ways to open it:
  - Tap a robot's name plate at the table. This is a document-level click handler in card.js, with no app.js hook. It works for robot seats and robot subs, and not for human plates.
  - More menu: a "System card" button (`index.html`, marked `<!-- feature: card -->`).
  - Options: a "Robots' system card" button (one line in `showOptions` in app.js, marked `/* feature: card */`). This line also makes the card reachable from the home page.
- CSS is at the end of `style.css` (`/* feature: card */`). It uses two columns on desktop and one on phones, with thin outlines.

## Tested
- `npm test` passes.
- Node script (scratch `feat-card/ex.js`): every example spec finds a matching hand, most within 0-80 ms.
- Playwright with Chrome on desktop (1280x860) and phone (390x780). Opening from a robot plate, the More menu and Options all work, a human plate doesn't open it, and the examples render. There were no page errors; the only console errors were the expected CORS failures from the online table list.

## Left / notes
- **Add `js/card.js` to the sw.js CORE list** (not done, sw.js is off-limits).
- Some examples show robot quirks as they are, for example a 2NT invite on a 6-card minor after 1NT. The card shows what the robots actually do.
- The alert colours are my reading of the ACBL Alert Chart and may need the owner's check. Possible ideas: an example vulnerability toggle, and showing partner's hand.
