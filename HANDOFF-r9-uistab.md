# HANDOFF-r9-uistab: UI stability (js/app.js)

Round 9. Branch `r9-uistab`. Only `bridge/js/app.js` changed. No changes in net.js, table.js or analysis.js:
nothing found there needed one.

## How it was tested

Scripts are in the session scratchpad `ui/` folder (not committed). They use the shared `lib.js`, which serves
bridge/ through request interception in Chrome (playwright-core, `channel: 'chrome'`).

- `stress.js W H mobile boards seed speed` (built from round 8's `play.js`, with all its checks: page/console
  errors, stuck positions, buttons off screen, sideways scroll, overlapping plates/trick/hands, covered cards,
  two modals). Added: `MODE=practice|mini|rubber|daily`, `THR=4` (CDP CPU throttling), `PREFS=` JSON, and
  `CHAOS=p`, which with probability p a step does one of: rotate the phone (swap the viewport), freeze and
  resume the page (CDP `Page.setWebLifecycleState`, as a backgrounded mobile tab), hide/show the tab
  (visibilitychange), 4 rapid taps on whatever is tappable (cards, Next, bidding box, Undo, Hint), or leave
  mid-board, open a feature page (explorer, flashcards, lead trainer, bidding practice, daily), leave it and
  come back. `battery.sh` runs 8 of these.
- `rotfeat.js`: each feature page at 390x844 (touch): rotations, rapid taps on its buttons, freeze/resume,
  then its Leave button; also with 4x CPU.
- `record.js`, `rec9.js`: hand record and the play review on phone and desktop: rapid taps on the replay
  buttons and the diagram's cards, arrow keys, rotation, freeze, then the next board.
- Repros: `drawer.js`, `explain.js`, `autonext.js`, `bubblerot.js` (below).

About 60 boards in all (practice, MiniBridge, rubber, daily, Learn aids on with Expert and Club robots, confirm
card/bid on, auto next on) at 1280x860, 390x844 and 844x390, a third of them at 4x CPU, with about 600
chaos events: no page errors, no console errors, no stuck positions.

## Bugs fixed (js/app.js)

1. **Landscape drawer had no backdrop** (round-8 open item). With "Auction & chat" open on a phone held
   sideways, a tap on the table beside it did nothing. Now a tap outside the drawer closes it and does
   nothing else. This is a capture-phase click listener, so style.css is unchanged. `drawer.js`: open
   before and after the tap: true -> false.
2. **Rotating reopened the drawer** (round-8 open item). Turning the phone upright kept `.side.open`, so it was
   open again when turned back. The drawer now closes when the phone leaves the drawer layout.
   `drawer.js`: open after portrait and back: true -> false.
3. **A call's bubble survived into the next board** (round-8 "from reading the code" item, now reproduced).
   A bubble opened from the keyboard has no tap to close it, so N carried it into the next board. render()
   now closes it when the board number changes. `explain.js`: bubble after N: true -> false.
4. **The bubble stayed put when the phone turned.** The table is redrawn on rotation, so the bubble pointed at
   nothing (its call was gone from the page) until its 6 s timer ran out. It now closes when the window
   width changes. It does not close when only the height changes, because the address bar sliding changes
   the height. `bubblerot.js`: after rotation "bubble top 136, anchor disconnected" -> "no bubble".
5. **"Next board automatically" moved on in a background tab.** If you switched away when a board ended, the
   next board was dealt behind your back and you never saw the result. The timer now waits while the page is
   hidden and starts again when you come back. `autonext.js` (autoNext on, hidden right after the board
   ended): board after 8 s hidden 2 -> 1; 6 s after coming back it is 2.

Each fix was checked with `node build.mjs && npm test` and `node tests/sim.js` (errors 0, long 0).

## Tried, not a bug

- In record.js the record sometimes closed after a tap on a diagram card. That came from the script tapping
  points outside the viewport after a rotation. Tapping each of the 52 cards 1-3 times (`rec9.js`, touch and
  mouse, portrait and landscape, only cards on screen) never closed it, because disabled card buttons get no
  click.
- "card cannot be tapped (covered)" in the first battery came from the script. It counted zero-sized hidden
  cards as on screen. Once fixed, the only zero-size legal cards were the lead trainer's (`#ltHand`, below).
- Once at 844x390 in a daily deal (c-daily844, after a rejected claim), the drawer's buttons covered two of
  your cards while `.side` had no `open` class, yet the screenshot shows the drawer fully open. A closing drawer
  covers the felt for its 0.2 s slide (`drawer2.js`: left edge 514 -> 817 -> 861 px at 0/120/300 ms), and the
  script checks 120 ms after a tap, which explains part of it but not the fully open screenshot. I could not
  reproduce it on purpose. Worth watching.
- Screen-switching (`screens.js`) times out under heavy machine load (other agents' sims): click timeouts,
  not app errors.

## Open findings (not mine to change)

- The lead trainer's hand (`#ltHand .rk.play`, js/leadtrainer.js:36/222) stays in the DOM after you leave the
  trainer, with live `data-play` buttons, hidden. It is harmless today because nothing queries all
  `[data-play]` across the page, but a future global query could pick it up.
- At 390x844 in a daily deal, the claim/result banner (`.bwrap`) overlapped a hand once during play
  (b-a-d390). This is the same style.css `.bwrap/.banner` sizing that round 8 saw in landscape.
- Under 4x CPU on the phone, Playwright's 2 s tap timeout sometimes ran out on the bidding box or Next. The
  app was only slow (no errors, nothing stuck).
