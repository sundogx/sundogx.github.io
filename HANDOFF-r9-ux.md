# HANDOFF-r9-ux: user-experience pass (style.css, index.html, js/ux.js)

Branch r9-ux from main cf26413. Measured in Chrome (Playwright, the shared smoke/lib.js) at 390x844 (touch) and
1280x860. Scripts and screenshots are in the session scratchpad
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/ux/`:
`shots.js` (every screen), `home.js`, `heights.js` (touch heights of small buttons/selects/summaries), `gaps.js`, `tap.js`, `tab.js`, `axe.js` (axe-core 4). Screenshots in
`before/` and `after/` there, named `<width>-<screen>.png`.

**Merge note (required):** add `'js/ux.js'` to `CORE` in sw.js (not my file, and CACHE bumps are off-limits for
round-9 agents), and bump CACHE at deploy. Without it the file is not cached offline; the page still works
offline, only the dialogs lose their accessible names.

## Changes (all owner UI choices kept; nothing removed that the owner asked for, no animation added)

1. **Home, practice buttons** (index.html `<span class="brk">`, style.css "ux"). Before: seven buttons of
   different widths in ragged centred lines (390: 4 lines, widths 104-150 px; 1280: 3 lines with New practice
   and the other modes mixed). After: 390, the main button full width and the six others two to a line at equal
   width (160 px each, 4 even lines); 1280, the main button with New practice on line 1 and the five other modes
   on line 2. Shots: `before|after/390-home-firstrun.png`, `before|after/1280-home-firstrun.png`.
2. **Home, text box + button on one line on phones** (`#home .block .row > input { flex: 1 1 120px }`).
   Before at 390 "Save name" and "Open a table" wrapped under their boxes. Together with 1 and 4, the home page
   at 390 is about 850 px tall instead of 1031 (first run), so "Open a table" moves from y=629 to about y=520
   (my `heights.js` gives 853 / 521 every run after the review fix; the reviewer measured 847 / 519. The few
   px depend on the table-list state at load.)
   Placeholder shortened to "Table name (optional)" (it was cut off at 390).
3. **Home, Join next free seat hidden while the table list is loading, empty or failed** (CSS `:has`): it can
   only toast "no table" then. Filter and Refresh stay. Shot: `after/390-home-firstrun.png`.
4. **Home, even spacing:** the empty storage note left a gap; name/code/table rows were 100/48 px apart at 390,
   now 47/48 (`gaps.js`).
5. **Touch targets** (`@media (pointer: coarse)`): selects on home and in the topbars of explorer and lead
   practice are at least 36 px tall, and the More options summary is 32 px. Small buttons are NOT in this rule:
   style.css:334 already gives every `.btn.small` 40 px on touch screens (my first version also listed
   `.btn.small` at 36 px and, being more specific, lowered them 40 -> 36; fixed after review). `heights.js`
   at 390 touch, main -> branch, only changes: lobbyFilter 28 -> 36, exDealer 26 -> 36, exVul 26 -> 36,
   ltKind 20 -> 36, More options 20 -> 32; every small button (Options, otherDeviceBtn, refreshBtn, dialog
   close, bpLeave, exUndo/exClear/exLeave, fcLeave, ltLeave, ...) stays at 40. Selects in dialogs already had
   36 px (style.css:583). The table's own topbar is untouched.
6. **Accessibility** (axe-core over home, Options, the five practice screens and a practice auction, both widths):
   216 -> 32 violation nodes. `<main>` around the screens (landmark-one-main 14 -> 0, region 168 -> 0); every
   dialog is named after its first heading by `js/ux.js` (aria-dialog-name 2 -> 0). No colour-contrast
   violations before or after. Focus ring added for select, summary, links, textarea and [tabindex]
   (buttons/inputs had one already). Tab walk (`tab.js`) at 1280: every stop on home and the table shows a ring,
   order topbar > table > hand > bidding box > sidebar.
7. **Reduced motion:** the phone drawer and the progress bars no longer slide when the system asks for less motion.

Checks: `node build.mjs && npm test` all ok; `node tests/sim.js | head -1` errors 0, long 0. A full practice
board at both widths (`shots.js`) has no page or console errors (only the aborted external requests).

## Tried, not kept

- Primary button on its own line at 1280 with the five modes below: the second line wrapped 4+1 until the
  secondary buttons' side padding went 12 -> 10 px and the gap 10 -> 8 px (kept that version).
- A keyboard-shortcut help dialog: not needed, `?` already opens Options, which lists the shortcuts.
- Taller topbar buttons at the practice table on phones: would push the bidding box down (the 390x844 auction
  already scrolls a little); left alone.

## Open findings (other people's files)

- js/app.js:672 `setBackgroundInert` inerts only #home and #tableView; the explorer, flashcards, bidding-practice
  and lead-trainer sections stay focusable behind a dialog opened from them (Options, system card).
- Bidding boxes (app.js bid box, explorer.js, flashcards.js, bidpractice.js): NT and XX buttons have
  aria-label "notrump"/"redouble" that does not contain the visible text (axe label-content-name-mismatch,
  20 nodes): voice-control users saying "click NT" miss. Use aria-label "NT, notrump" or drop the label.
- No h1 on any screen but home (axe page-has-heading-one, 12 nodes): the topbar titles are spans.
- Daily deals at 390 (`after/390-dailyBtn.png`): the sidebar is drawn under the table with the Chat tab open and
  an empty chat log, while the owner wants nothing shown for an empty chat; in practice the Auction tab is open.
