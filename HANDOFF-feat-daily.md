# Daily deals (feature: daily)

## What was done
- **Deals:** 4 boards a day for everyone, dealt in the page with `seededRand('daily:<UTC date>:<board>')` (the existing `t.seed` path in `startBoard`). Board numbers 1-4 give the usual dealer and vulnerability. Played against the robots exactly like practice.
- **Client:** `bridge/js/daily.js` (new, loaded before `js/app.js`).
  - The home hero row gets a plain "Daily deals" button, which reads "Daily deals, board 2 of 4" while in progress and "Daily deals (done)" when finished.
  - The topbar title shows "Daily deals, board N of 4".
  - The result panel adds a Leaderboard button. After board 4 there's no Next button, just a short note.
  - The leaderboard is one modal: your rank, Board 1-4 buttons, the board's results with matchpoint %, and the overall table (top 20 plus you).
  - The daily table is saved under `bt:daily`, so it never overwrites the practice save in `bt:practice`.
  - Results are posted once per board. When offline, a failed post is retried at most every 20 s on render. Without a server, boards still play and the leaderboard says it needs a connection.
- **Hooks**, each marked `feature: daily`:
  - `app.js`: `resultBanner` (`const go` became `let go`, plus one line), `renderTop` title, `render()` post hook, `savePractice`/`flushPractice` storage key, `Daily.renderHome()` in `goHome` and `init`.
  - `index.html`: the button and the script tag.
  - `style.css`: small block at the end.
  - `build.mjs`: one extra line `export { scoreNS, boardVul };` for `src/game.js`.
- **Server** (`bridge/src/worker.js`):
  - `POST /api/daily` takes `{date, board, secret, name, contract, declTricks}`. `GET /api/daily/<date>?u=<your id>` returns per-board rows with MP %, the overall ranking, and a `you` flag. Ids are never sent.
  - Storage needs no new binding or migration: each day is its own instance of the existing `Lobby` class, named `daily:<date>`. Its first write sets an alarm that deletes the instance after 31 days (`Lobby.alarm` only acts on daily instances).
  - Validation:
    - date must be today or yesterday (UTC); GET accepts the last 31 days;
    - board must be 1-4; secret 16-200 chars; contract level/strain/declarer/doubled and tricks 0-13 are checked;
    - the score is computed by the server (`G.scoreNS`), never taken from the page;
    - one result per person per board (409), 40 posts per hour per address (429), 5000 results per board.

## Tested
- `npm test` passes, and so does `npx wrangler deploy --dry-run`.
- `BRIDGE_URL=http://localhost:8796 node tests/daily.test.mjs` against `npx wrangler dev --port 8796` covers bad inputs, server-side scoring, the duplicate 409, matchpoints and rank, ids never leaking, and the rate limit.
- Playwright (Chrome) with `BRIDGE_API=''` against wrangler dev, plus an unreachable API for the offline case:
  - the home button, the title progressing through boards 1-4, no Next after board 4, and 4 posts;
  - the leaderboard modal;
  - the same deal on a second device;
  - a reload shows "Daily deals (done)" while the practice save is untouched;
  - offline: the boards play and the leaderboard shows a "needs a connection" note.
- No page errors.

## Left / notes
- Results aren't proved: the server checks the contract and tricks but doesn't replay the auction and play against the seeded deal. That is possible, since game.js has `deal`, `seededRand` and the rules, but claims make it longer. Until then a cheater can post any legal contract.
- Undo and Hints work as in practice, and nothing stops replaying from another device with a new identity.
- README has no section on this yet.
- **sw.js CORE: add `js/daily.js`** (I didn't touch sw.js).
