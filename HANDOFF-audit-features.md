# Audit of the feature modules (round 8)

Area: bridge/js stats, leaks, chatsym, explorer, flashcards, leadtrainer, playfrom, daily, share, deals, bidpractice,
card, notify, skip, autoplay, suitorder, played, showpoints. Repro scripts are Playwright (playwright-core, Chrome)
or Node, kept in the session scratchpad (`feat/t1.js` … `t8.js`, `sharefuzz.js`, `sharefrac.js`); the share cases
are now also in `tests/sharetest.js`.

## Bugs fixed

1. **"Play this deal" (import / shared link) and Lead practice "Play it out" overwrote your saved practice table.**
   Both open a new local table that `savePractice()` then wrote over `bt:practice`, losing the practice session and
   its 60 boards of results. Repro (t1.js): start practice, go home, `playSharedDeal(...)`: `bt:practice` became the
   new table with 0 boards. Fix: such tables carry `t.oneOff`; `savePractice`/`flushPractice` (app.js) skip it, like
   `whatIf`. Their boards still go into History. Retest: saved table id and history unchanged in both paths.
2. **Explorer or flashcards left showing over a table, and the table's keys dead.** Opening a `#deal=` link while
   the explorer or "What do you bid?" is open, then "Play this deal", showed the table under the screen, and the
   explorer's capturing key handler (it is on while its screen is visible) swallowed P, X, 1-7… Repro (t2.js): P
   did nothing. Fix: `bxHideScreens()` (explorer.js), called from app.js `showTableView` and `goHome`. Retest: only
   the table shows, P passes.
3. **Imported boards with board number 0, negative or huge had no dealer.** `[Board "0"]` / `"-2"` without a
   Dealer tag, `ah|Board 0|` in LIN, or `#deal=-6....`: `boardDealer()` gave `undefined` (and vul `undefined`), so
   the viewer said "Dealer undefined" and the practice table's following boards had no dealer. Fix in `buildDeal`:
   board must be an integer 1-9999 (else 1); dealer and vul fall back to the board's. Tests added to sharetest.js.
4. **Tapping an explained call did nothing when no table was open** (a shared deal from a link, a History board
   opened from home, an import viewed from home): app.js's click handler returned early for anything outside
   `#home` when `T` is null. Fix: explained calls in the modal still open their bubble. Retest (t4.js): bubble
   shows, text escaped.
5. **Just declare / Just defend replaced an imported deal with a random one.** `PlayFrom.justBid` redeals up to
   40 times until the wanted side declares; on a "Play this deal" table that threw the imported hands away (t5.js:
   about half the boards REPLACED). Fix: share.js marks `t.fixedDeal = t.board`; justBid then only tries the dealt
   hands (turning the board round if needed). Retest: 16/16 kept.
6. **Undo on a what-if table went back past its starting position**: from the opening lead it reopened the
   auction; from trick 3 it took back the record's own card 8 (t8.js). That also spoiled "Play again" (it rebuilds
   the start from this table's record). Fix: `PlayFrom.render` hides Undo when undoing would leave fewer than
   `whatIf.k` cards or leave the play. Undo of your own later cards still works.
7. **"Play this deal" walked out of a live online board** (a link opened while seated and playing). Now refused
   with the same toast as Play from here, and the window stays open (t6.js, faked online table).
8. Small ones: a `lin=` text with a stray `%` said "URI malformed", an unparseable https link said "Invalid URL"
   (now plain messages); PBN export wrote `[Result "null"]` for an imported board with unfinished play
   (analysis.js `pbnBoard`, now empty); Lead practice's counter turned NaN on a damaged `bridge-lt` entry; the
   explorer took any saved `vul` string.

Checked and fine: HTML escaping of table names, notes, imported alerts, PBN board names, chat (hostile payloads
in t3/t4, nothing fired); History with passed-out, claimed and no-play boards, replay, flags, PBN, print recap
(t3.js); timers (shared-deal and History record pollers stop when their window closes; lead practice terminates
its workers on leaving; bid practice clears its poll); nothing else depends on the screens' DOM order (the More
button and Notify's away bar look inside `#tableView`).

## Performance

History window with 2,000 analysed boards opens in 36-71 ms (t7.js); nothing to gain there. No other changes.

## Not fixed (findings)

- deals.js:86 `dealsAfterAct`: "Rotate so I'm declarer" also turns **daily** boards round, so the daily
  leaderboard shows "by S" where others show "by N" (score is the same). If the page ever sends the auction to
  /api/daily, the server's auction check would reject rotated boards. Probably exclude `t.daily`.
- leaks.js:104 `Leaks.step`: "idle" is `!T`, so play reviews of old boards run while Lead practice is solving
  (it uses cores-1 workers; PlayDD takes the last core) and during bid practice. Not measured; consider treating
  `LT.phase === 'eval'` as busy.
- stats.js:65: the 2,000-board cap drops flagged boards too.
- stats.js:23: if the IndexedDB open is blocked, `ready` resolves at once; a late `onsuccess` then replaces
  `Stats.list`, and boards noted meanwhile were never stored.
- flashcards.js:118: a card is generated synchronously, up to 3 x 1.5 s on the main thread for a rare topic.
- app.js:642 `setBackgroundInert` covers only `#home` and `#tableView`, not the explorer, flashcards, bid
  practice or lead practice screens under a modal (the modal's Tab trap still holds focus).
- explorer.js:257: the explorer's key handler stops propagation of every key, including app.js's `kbdNav`
  listener (focus rings after keyboard use).
- daily.js:50: `t.dailyPosted` is set on the table object captured when the POST started; if `act()` replaced
  `T` meanwhile the flag is lost and the board is posted again (the server answers 4xx, so harmless).
- tests/sharetest.js, tests/flashcards.js and tests/playfromtest.js are not part of `npm test`.
