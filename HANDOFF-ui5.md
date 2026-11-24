# HANDOFF-ui5: practice with robots, played in a real browser, polish round 5

Files changed: `bridge/js/app.js`, `bridge/style.css`. CACHE not bumped. Nothing pushed or deployed. README needed no UI change.

How it was tested: `python3 -m http.server 8795` serving `bridge/` (practice needs no Worker), with Playwright and Chrome (`channel: 'chrome'`). Scripts are in `/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/ui5/`:
- `real.js <tag> <w> <h> <mobile> <boards>` plays at the default speed by clicking, as a player would. It logs each board's time, taps, the waits between your turns, and every robot double with what tapping it says. `REPLAY=1` plays board 3 again from the hand record. It also screenshots Review.
- `check.js` (390 px): Seats beside Next board, a phone side hand with AQ1095, Review, a replayed board in Results.
- `dbls.js` / `dbls2.js`: robot auctions on 600 random deals (the second has an overbidding South) and every X / XX with its explanation.
- `fit.js`, `rw.js`: width checks (phone side-hand suit, Results row in the sidebar).
- `play.js` etc. are copied from ui4.

The Python server sometimes resets a connection, which makes a script time out with "T is not defined". Run it again.

Played: 19 full boards (10 desktop 1440x900, 9 phone 390x844), including doubled contracts and a replayed deal.

## Findings, by impact
1. **Waiting as dummy:** a board where you were dummy took about 40 s of watching robots.
2. **Waiting on defence:** about 2.4 s on average between your turns, up to 5 s (robot card 700 ms, trick hold 1.2 s plus 500 ms).
3. **Review** opened the hand record with the replay at the very bottom, under a second copy of the deal, and its controls were below the fold. On a phone, the replay's 4-card trick row pushed East's hand off the edge, and the six controls took two rows.
4. **Results** wrapped contracts on desktop ("1NT N / +2"), and the IMPs column was clipped at the sidebar's edge.
5. **Results didn't mark a replayed board** (round-4 leftover).
6. **Seats wrapped under Next board on 390 px** (round-4 leftover).
7. **Clutter:** every explained robot call had a 2 px gold outline.
8. **Phone side hands:** a 5-card suit with the 10 (AQ1095) still wrapped.
9. Nothing to fix here: every robot X / XX in 1,200 auctions has an explanation when tapped ("Penalty: 10+ points, 3+ spades", "Takeout double…", "Support double…", "Lead-directing…"). It takes 1 tap to get to the next board, and the first call of the next board is ready within 0.1 to 2 s.

## Fixed (commits f5cd7b9, cca2f1f)
- **Robot pace (practice):** auction 650 to 500 ms per call, card 700 to 550 ms, extra pause after a trick 500 to 300 ms. The trick still stays on the table for 1.2 s. While you are dummy, the robots play twice as fast and the trick hold is 0.6x (`dummyIdle()`). The dummy board measured 40 s before and 21 s after, auction included. The Speed option still scales all of it.
- **Review:** `showRecord(i, true)` puts the replay where the deal diagram is, under a one-line "4♠ by North +1, N-S 650". The steps are right below it, then the auction, the robot table line, DD and the play table. The replay's trick shows each card on its player's side, like the felt (`.tr.cmp`, later cards on top). The winner has the 2.5 px gold outline, in Last trick too. The buttons are "Start ‹ Trick Back Next Trick › End" (with aria-labels) and fit one row at 390 px. Hand record's own "Replay the play" button still works and scrolls to the replay.
- **Results:** a replayed board shows a small grey "=3" after its number, with a title and aria-label "board 3 dealt again". Practice and online Results both do this. In the sidebar the font is 13 px with tighter cells, and "3NT E" never splits (nbsp). A plain or doubled row fits the 1440 px sidebar on one line, and only a redoubled one wraps before its result.
- **Seats on 390 px:** the Next row doesn't wrap, and Seats gets the small phone padding (measured inside the panel).
- **Thin outlines:** an explained robot call now has a 1 px gold outline. The red outline on alerts is unchanged.
- **Phone side hands:** the 10 is set narrower (`.rk.ten`) and the rank padding is tighter, so AQ1095 fits one line in the 88 px column.

## Left / ideas (not done)
- **Penalty doubles, for the bidding agent (`bidding.js` describeCall):** the text says what the double shows ("Penalty: 10+ points, 3+ hearts") but not why. Something like "expects to beat 4♥" or "trumps: Q-J-x" would answer "why did it double me" better. The UI already shows whatever text describeCall returns.
- On a 390 px phone, once a board ends the empty hand area leaves about 130 px of space above the contract line. Collapsing it would make the layout jump at every board, so I left it.
- Review starts before the opening lead. Starting at the first card that cost a trick would be a small step.
- A 6-card suit with the 10 still wraps in a phone side hand.
