# HANDOFF-ui3: playing the app in a real browser, polish round 3

Files changed: `bridge/js/app.js`, `bridge/style.css`, `bridge/index.html`, `bridge/js/net.js` (one line), `bridge/js/analysis.js` (one line, in the hand record's double-dummy text). CACHE not bumped. Nothing pushed.

How it was tested: `python3 -m http.server` serving `bridge/`, and Playwright (`playwright-core`, Chrome via `channel: 'chrome'`). Scripts are in the scratchpad, `/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/ui3/`:
- `play.js <tag> <w> <h> <mobile> <boards> <dbl>` plays full practice boards (bidding, alerts, play, claims, end panel, hand record, results). With `dbl` set, it doubles whenever it can, which gives doubled and redoubled contracts.
- `explore.js` covers the keyboard, Options, Hint, Undo, last trick, the claim dialog, leaving the table, and joining with a code. `DARK=1` turns on dark mode.

Sizes covered: 1440×900, 1280×800, 1366×768, 390×844, 844×390.

## Found, ordered by impact
1. **Phone held sideways:** during play the contract and trick count could not be seen anywhere, because the sidebar is a hidden drawer there. On an upright phone they were below the fold.
2. **End-of-board panel:** Next board, Hand record and Review play each took a full row. On desktop the panel covered dummy's cards. Sideways on a phone it ran off the table and covered South's name plate.
3. **Doubled contracts:** "3NTX" and "4♠XX" ran together as plain text. This matters more now that the robots double more often.
4. **Board number on phones** was about 8 px, because the `.corner b` rule overrode `.bbx b`.
5. **Join with code from the lobby:** nothing happened on screen for 5 s, and there was no way to cancel.
6. **Options window on touch screens:**
   - The tick boxes were squeezed to different sizes by long labels.
   - The keyboard-shortcut table was shown on phones.
7. **Screen readers** heard "3NTX by East".

Checked and fine as they are: auction box colours and headers, alerts and their bubbles, the hint outline, keyboard bidding and play (focus ring and selected card), Undo, Last trick, the claim dialog, claim Accept/Reject, the hand record and play review, Continue/New practice, session Results (IMPs against the robot table, with totals), dark mode, and the 1366×768 / 1280×800 bidding box (it fits).

## Fixed (commits on this branch)
- `9aec4e1`:
  - Compact result panel: contract and result on one line, then tricks and score, Next board, and small Hand record / Review buttons.
  - On phones (`#playInfo`, under your hand) the contract and the two-card trick counter are shown. They are hidden in the sidebar there, so they move rather than appear twice.
  - On a phone held sideways, the end-of-board panel also goes in that spot (where the bidding box was) instead of over the table.
  - `contractHTML(c, short)` now builds the contract itself: suit in its colour, X in red and XX in blue (same colours as the auction box). It is used in the panel, sidebar, Results (`cShort`), hand record, robot-table line and the double-dummy line.
  - Board number size fixed.
- `a9dd2a1`:
  - Lobby shows "Connecting to table ABCDE… [Cancel]" (`#joinState`). It is cleared when the table opens, when the code isn't found (net.js), and on navigation.
  - Tick boxes don't shrink (`flex: none`).
  - Keyboard help is hidden on touch-only devices.
- `fcb7b3e`:
  - The panel's small buttons stay on one line at 390 px.
  - `contractWords()` gives the trick counter's aria-label, e.g. "3 notrump doubled by East".

## Screenshots (scratchpad `ui3/shots/`)
- Before: `d1440-b0-done.png` (panel over dummy), `l844-b0-done.png` (panel off the table), `l844-b0-play1.png` (no contract visible), `p390-b0-bid.png` (tiny board number), `x1280-online-connecting2.png` (no join feedback).
- After: `a-d1440-b0-done.png` (4♠X panel), `a-l844-b0-done.png`, `b-l844-b1-done.png` (panel in the right column), `a-p390-b0-play6.png` (2♥X and tricks under the hand), `b-p390-results.png` (3NTX in Results), `c-p390-b0-done.png`.

## Left / ideas
- On a 390 px phone, side hands shown as suit rows still wrap a 4-card suit ("Q 9 6 / 5") because the side column is about 80 px. Tighter rank spacing or a smaller font there would fix it.
- Desktop 1440×900: the table is capped at 530 px tall, so there is empty space under the hand during play. Raising the cap only in play would make the table jump when the auction ends, so I left it.
- The hint's gold outline on the green Pass button is hard to see.
- The claim dialog has both ✕ and Close (the same for every modal).
- Online tables were only checked without a server (lobby error text, joining, Cancel). Seated online play was not driven.
- README: no UI lines needed changing.
