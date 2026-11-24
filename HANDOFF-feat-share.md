# Feature: sharing and importing deals

## What was done
- New file `bridge/js/share.js`, loaded before `js/app.js`. It contains:
  - **Deal links.** `shareEncode(h)` and `shareDecode(s)` turn a board (a `t.history` entry) into a short hash and back: `#deal=<board>.<dealer><vul>.<deal>.<auction>.<play>[.<declarer tricks if claimed>]`. The deal is 18 characters (2 bits per card), with one character per call and one per card. A fully played board is about 85 characters. Alerts aren't kept. No server is used.
  - **Viewer.** Opening a `#deal=` URL (on load or on hashchange) shows a read-only hand record. It reuses the existing UI: `startReplay` (Start, Trick, Back, Next, End, and the arrow keys), `auctionGridHTML`, `ddHTML`, `playTableHTML` and the double-dummy play review. The buttons are **Play this deal**, **Copy link** and **Copy PBN**. The analysis callbacks only follow `T.history[openRecord]`, so the viewer polls every 700 ms while it is open. A damaged link shows a toast.
  - **Import.** A new button in Options, "Import a deal (PBN or LIN)", opens a window where you paste text or open a file (.pbn, .lin or .txt). It accepts:
    - PBN, including notes, `AP`, play in seat columns and `[Result]` for claims. A file with several boards shows a Board picker.
    - BBO LIN (`md`, `sv`, `ah`, `mb`, `an` alerts, `pc`, `mc` claims).
    - BBO handviewer URLs, either `?lin=` or the `?n=&s=&e=&w=&d=&v=&b=&a=&p=` form.
    - Our own `#deal=` links.
    The buttons are **Play it** and **View**.
  - **Play this deal** starts a practice table on that deal: you sit South with three robots, and the dealer, vulnerability and board number come from the deal. The board starts with `startBoard(t, rec)`.
- Hooks, each marked `feature: share`:
  - `index.html`: one script tag.
  - `app.js`: a "Share link" button in the hand record's save row (`#shareOne`) with its listener, and the Import button in `showOptions`.
  - `style.css`: one rule at the end, so the textarea is 16 px on phones and iOS doesn't zoom.
- `bridge/tests/sharetest.js` is a Node test. It covers a real LIN, a handviewer URL, link round trips, a claim, PBN with play and PBN with several boards.

## How it was tested
- `cd bridge && npm test` passes, and `node tests/sharetest.js` passes.
- Real samples from the BEN repo:
  - `camrose2024_BEN.pbn`: all 160 boards parse, 157 with full play, and every computed result matches its `[Result]` tag.
  - `Camrose24_1.pbn`, `BW.pbn` and `CTC_mayjun20.pbn` (deal-only files) all parse.
  - Every board round-trips through a link.
  - A real BBO LIN with alerts and full play, also wrapped as a handviewer URL, parses.
- Playwright in Chrome, at desktop size and at a 390 px phone size, served locally:
  - The link viewer opens and steps through the play, the double-dummy table and play review fill in, and Copy link puts the same URL on the clipboard.
  - Play this deal opens a practice table with the right hands, dealer and vulnerability.
  - The hand record's Share link works.
  - Importing through Options works for PBN (View), a handviewer URL (Play it) and the 160-board picker.
  - A junk paste shows an error, and a damaged link shows a toast.
  - No page errors.

## What's left / notes
- Add `./js/share.js` to the `CORE` list in `sw.js`, then bump the cache when merging. I didn't touch sw.js.
- Add `node tests/sharetest.js` to the `npm test` script if you want it there. I left package.json alone to avoid merge conflicts.
- Play this deal replaces the saved practice session, as starting a new practice does.
- Short `bbo.tl` links can't be read without a server. Paste the full handviewer URL or the LIN instead.
- PBN `#` tag inheritance isn't supported. You always sit South, even when the deal's declarer is elsewhere.
