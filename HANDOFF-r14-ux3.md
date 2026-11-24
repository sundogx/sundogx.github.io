# HANDOFF-r14-ux3: round-13 open UX findings

Branch r14-ux3 from main 5c31e49. Files: bridge/js/app.js, bridge/index.html, bridge/style.css (ux.js untouched).
Every Owner's UI choice kept (one change enforces "Chat: nothing shown when empty").

Scripts and screenshots: `/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/ux3/` (`repro.js`, `sel.js`; `lib.js` takes `ROOT`; main's bridge/ gives "before").
Screenshots in `before/` and `after/`.

## Changes (each reproduced first, then re-run after)

1. **Side panel opened on an empty Chat tab** (app.js autoTab). At 1280 in a practice auction the selected tab
   was `chat` with 0 messages; at 390 the Chat tab stayed selected after the board. Now the auction phase opens
   Chat only if the table has chat messages, otherwise Auction. Repro: selected tab `chat` -> `auction`.
   Shots: `1280-practice-auction.png`.
2. **"Sound off" read as state and action** (app.js, index.html). Label is now "Sound: off" / "Sound: on"
   (aria-pressed kept). Shots: `1280-topbar.png`.
3. **Daily deals at 390 had no direct way back** (index.html, app.js, style.css). New `#dailyLeave` "Leave"
   button, shown only for daily tables and only at <=560 px, at the right end like #bpLeave etc.; it clicks
   #leaveBtn. Repro: visible bar buttons were Chat, More -> Chat, More, Leave (x=325); tapping it returns home.
   Desktop and landscape phones unchanged (Leave table is already on their bar). Shots: `390-daily.png`.
4. **Options selects at 1280 were the browser default** (style.css). `.modal .box select` styled like the
   explorer's: #optLevel 19 px grey #767676 square -> 26 px, var(--line) border, 6 px radius. Touch stays 36 px
   (the phonefix rule comes later in the file). Shots: `1280-options.png`, `1280-options-select.png`, `390-options-select.png`.
5. **Screens behind a dialog stayed focusable** (app.js setBackgroundInert). Only #home and #tableView were
   inerted, so the explorer / bidding practice / What do you bid? / lead practice sections (added to <main> by
   their features) stayed focusable. Now `<main>` itself is inert. Repro: a button in #explorer behind a dialog
   took focus (focused: true) -> inert ancestor, focus refused. Shots: `1280-explorer-dialog.png`.

Checks: `node build.mjs && npm test` all ok; `node tests/sim.js | head -1` errors 0, long 0; no console errors in the repro runs.

## Not done / open

- Regular "Practice with robots" at 390 also has Leave only inside More (same as daily before). Left as is: not
  in the round-13 finding; the same #dailyLeave toggle in app.js (render, next to setText tName) could cover it.
- 390 end-of-board tab not re-walked through a whole board (time); covered by the autoTab logic (done keeps the
  current tab, which is now Auction).
- Still open from round 9/13: NT/XX aria-label mismatch, no h1 on feature screens, lead-practice hand all gold.
