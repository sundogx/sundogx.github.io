# Daily leaderboard: results checked on the server

Branch `worktree-agent-a47e3f221b5d1f150`. Files: `bridge/src/worker.js` (daily endpoint only: `dailyRoute`, new
`dailyCheck`), `bridge/js/daily.js`, `bridge/tests/daily.test.mjs`, README "Daily deals" (new section, after Claims).

## The problem

`POST /api/daily` took `contract` and `declTricks` from the page. The auction check ran only if the page sent an
auction, and js/daily.js never did; tricks were never checked. Anyone could post 7NT redoubled making 13.

## What the server checks now (`dailyCheck`)

The page sends `{ date, board, secret, name, auction: [calls from the dealer], play: [cards in order], claim }`
(`claim` = tricks declarer's side takes of those left, only for a board that ended in a claim). The server:

1. deals the board itself from `daily:<date>` / board n (`G.startBoard` on a non-local table, so finishing it doesn't
   run the robots' own simulation);
2. replays every call with `A.call` (legal, by the seat whose turn it is), requires the auction to be over;
3. passed out: no play, no claim; otherwise replays every card with `A.card` (legal card from the right hand in turn);
4. 52 cards: no claim allowed, tricks from the play; fewer: a claim (0..left) is required. The claim may give N-S no
   more of the remaining tricks than they take double dummy from that point (`claimAccept(t, 'N', nsTricks, 20000)`:
   the exact `claimSolver`, past 20,000 nodes (~8 ms) only claims within `claimTopTricks`). Whoever claimed: an E-W
   "concession" can't hand N-S tricks either. Fewer tricks for N-S than double dummy (concessions, an E-W claim South
   accepted) are allowed, since that only lowers the poster's own score.
5. Contract, declarer, tricks and score all come from the replay (`scoreNS`); posted `contract`/`declTricks`/`scoreNS`
   are ignored. A post without `auction` (old pages) gets 400 "This page is out of date: reload it to post daily results".

Rate limits unchanged (one per person per board, 40 accepted an hour per address, 5,000 a board, 4,000 bytes).

Why "N-S never above double dummy" instead of "the claimer's side": the leaderboard ranks N-S, the poster is always
South, and the server can't tell who claimed. With "claimer's side" only, a cheater would label an inflated N-S
result as an E-W concession. For N-S claims the two rules are the same.

Rotate so I'm declarer (deals.js, applies to daily): the turned table's record has the same calls and cards in the same
order; only seat names move, and the server replays in the original orientation, so it needs no special case
(tested in the page and in daily.test.mjs).

## Page side (js/daily.js)

- `Daily.record(h)` builds the body from the history record (auction calls, cards, claim = declTricks minus tricks won
  in completed tricks).
- Refused posts (4xx other than 409/429) show a toast: "Board N was not added to the leaderboard: <server error>", and
  aren't retried (as before).
- Claims the server can't check in time: `Daily.serverTakes` runs the server's exact check (same code, same 20,000
  node budget, so the same answer) and, at daily tables only, wraps the global `claimAnswer` (robots' answer to a claim)
  and `robotClaimCount` (robots' own claims), so robots turn down / don't make a claim the server would refuse; play
  goes on and the claim can be made a trick later. Without this, a simulation where declarer claims the exact
  double-dummy count at 6-10 tricks left had 116/200 refused by the server (80,000 nodes still left 48/200), and 1 in
  300 robot-only boards had a robot claim at 8 left the server couldn't confirm.

## Tests and measurements

- `tests/daily.test.mjs` against `wrangler dev` (port 8823): 29 checks + leaderboard asserts, all pass. Honest: the 4
  boards played by the shared robots (all 4 ended in robot claims), posted with `scoreNS: 99999` and stored with the
  server's score; a second post 409; a board turned round; a board played to the last card; passed out; a mid-trick
  claim at exactly double dummy; an N-S concession. Refused: old format; 7NTXX claimed at trick one; 7 illegal auctions
  (insufficient, double of partner, XX without X, unfinished, calls after the end, `8N`, opening X); auction of objects;
  passed out with play; cards out of order; a card twice; claim after the last card; 48 cards and no claim; claim of
  more tricks than left; N-S overclaim by one; E-W "concession" N-S can't take; another board's record; yesterday's
  deal; non-string cards; nothing of the refused player was stored. Plus the existing rate-limit and IPv6 /64 checks.
- Server check CPU (Node, server bundle, 300 robot-only boards replayed through `dailyCheck`): median 0.10 ms, p99
  1.3 ms, max 3.9 ms.
- Playwright (headless Chrome, the page posting to the local wrangler dev, South driven by robot choices plus a
  declarer claim at the exact double-dummy count with <= 9 left): rotate on: 4/4 posted 200 (board 4 turned round and
  claimed; one early claim was turned down by the daily robots and accepted a trick later); BEN option on (the BEN
  worker isn't available headless, so the page falls back to the usual robots, as it does on any BEN failure): 4/4
  posted 200. A forged record shows the toast "Board 1 was not added to the leaderboard: claim refused: ...".
  Script: scratchpad `smoke/daily-post.js` (not committed).
- `npm test` passes, `node tests/sim.js | head -1` errors 0, `online.test.mjs` all checks passed, online-multi.test.mjs all checks passed (both against the
  local wrangler dev with these changes).

## Not done / notes

- The deals are computable by anyone from the seed, so someone can still play the robots' hands too, or look up the
  double-dummy line in advance; the check only stops results that don't fit the deal. A stronger check would need the
  server to play the robots itself (or a secret seed), which is a bigger design change.
- A claim the server can't check within budget in a page from before this change, or from a hand-made client, is
  refused (not capped).
- `exactTricks` (bots.js) is the plain minimax reference; the server uses `claimSolver` via `claimAccept`, which is
  the exact solver with a node budget.
- `daily.test.mjs` imports `src/game.js`, so run `node build.mjs` first (wrangler dev does it).
