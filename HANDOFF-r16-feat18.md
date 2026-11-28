# Round 16, feat18: bidding problems from your own boards ("Your mistakes", kind Bidding)

## Resume here
- Status: done. The fixes from REVIEW-r16-feat18.md (items 2-6) are committed on `r16-feat18`. `npm test` passes, sim shows errors 0 and long 0, and `node tests/drillbidtest.js` and `node tests/drilltest.js` pass. `tests/drillbid.pw.mjs` has 21 checks at each width (42 in all) and every one passes. feat17's `tests/drills.pw.mjs` still passes.
- Nothing is half done. At merge (review item 1), add `['drilltest.js'], ['drillbidtest.js']` to `TESTS` in `tests/all.js`. If r16-bidding16 merges, bump `DR.BV` (review item 8).
- Key numbers: checking one board's calls takes about 1.2-1.6 ms in node (1,000 boards with real DD tables, 531 problems). The review measured 74-141 ms on a desktop for a slow board in the browser (300-500 ms on a phone). One board can still take that long, but now only one board is checked per step after a slow one (see fix 3).

## Review fixes (2026-11-28)
2. **Loss overstated.** The loss is now the smaller of two numbers: the IMPs against the contract reached at the table, and the IMPs against your call with the robots bidding on. drillbidtest checks this for every problem.
3. **Main-thread blocking.** `drBidStep` stops after 12 ms, so after a slow board the rest wait for the next step (300 ms later). `drBidChoose` no longer redoes work. The problem keeps both robot auctions from the check: `ra` (after the robots' call) and `ma` (after the table's call), plus `ralert`. Answering with either of those calls runs no robot bidding, and any other call runs exactly one robot auction. drillbidtest checks that the kept auctions give the same contracts and scores. A single slow board is not split; that would need a worker.
4. **A damaged record stalled the check.** Each board now runs inside its own try/catch and is marked checked either way. drillbidtest covers this with a record whose `vul` throws.
5. **No retry after a solver failure.** Two minutes after `DD.failed`, `drBidStep` calls `requestDD`, which runs `ddRetry`. drillbidtest checks both sides of this: before two minutes it does not ask, after two minutes it does.
6. **Guard.** `bpHandHTML` is now guarded the same way as `bpCallHTML`: without it, the hand is drawn with `cardText`.
- The earlier note said the Playwright test had 25 checks at each width. The real count is 21.

## What it does
- Every call you made on your History boards (newest 200) is compared with the robots' call (`botCall`, the app's 2/1 system) in your seat, with the auction as it went. Where they differ, the robots bid on for all four hands twice: after their call and after yours. Each contract is scored double dummy from the board's DD table.
- The call becomes a problem when the robots' call scores better both ways: against the contract you really reached, and with the robots bidding on after your call. The second test stops a partner's later slip from counting as yours. The loss is in IMPs, against the contract reached at the table.
- The problem is "What do you bid?": your hand, dealer and vulnerability, the auction so far ending in "?" (every call can be tapped for the system's meaning; alerts keep their red outline), and a bidding box with the legal calls only.
- The answer: right when you pick the robots' call, or a call after which the robots reach a contract as good (double dummy). It shows a table of the robots' call, your call and the call made at the table, each with its meaning, the contract reached, and your side's score. It also shows par, the robot table's result (practice), the three auctions (closed details), all four hands, Next (N) and Hand record.
- Spaced repetition is feat17's: the same Leitner boxes, the queue, the score line and the kind menu (new kind "Bidding"). A bidding problem's IMPs weigh a third of a trick in the queue, so neither kind crowds out the other.
- History, "Where the IMPs went": each row has a "Practise these" link. It opens Your mistakes at the matching kind: contract rows go to Bidding, and declarer, defence and lead rows go to their kinds.

## Files
- `bridge/js/drills.js`: a bidding section (`drBidExtract`, `drBidJudge`, `drRobotsOn`, `drBidStep`, `drBidRender`, `drBidBox`, `drBidChoose`, `drBidResultHTML`) and small hooks in drRender, drNext, drStep, drFocus, drClick, drQueue (weight), drLoad/drSave (`bscanned`), the click hook (`data-drkind`).
- `bridge/js/leaks.js`: `leakDrill` and one call in the row template.
- `bridge/style.css`: five lines after the `#drills` block.
- New tests: `bridge/tests/drillbidtest.js`, `bridge/tests/drillbid.pw.mjs`. Screenshots: `screenshots/r16-feat18/`.

## Tests
- `node tests/drillbidtest.js [boards] [--cache=$TMPDIR/bridge-dd-<seed>.json]`: robot-bid boards with human-like slips in one seat. It checks that a problem comes only from your calls that differ from the robots' call, recomputes each loss, checks that your call also loses with the robots bidding on, that boards bid as the robots make no problem, the DD packing, and the queue weight. 300 boards with a made-up DD table: 174 problems. 1,000 boards with real DD tables (cache h16a): 531 problems, all checks ok.
- `NODE_PATH=<dir with playwright-core> node tests/drillbid.pw.mjs --shots=../screenshots/r16-feat18`: real Chrome at 390x844 and 1280x800, 21 checks each, all ok. It seeds 16 boards with a South slip, opens History, waits for "Practise these" (Bidding), and checks the problem (hand, "?", meanings, legal calls, explain pop-up). It answers with the table's call (wrong, graded, the robots' call explained) and with the robots' call (right, box 1). It also checks the full scan (16 boards, 8 problems), Hand record, Escape, no sideways scroll and no page errors.

## Decided against
- Judging a call only against the contract reached at the table. That blamed you for a partner's later slip, so the robots also bid on after your call, and both tests must show a loss.
- Using the real table result rather than double dummy. Card play would then mix into a bidding problem, so every contract is scored double dummy, the same way bidding practice and the leak finder do it.
- "Play on from here" for bidding problems. PlayFrom starts at a card, not at a call, so only Next and Hand record are shown.

## Open findings
- "Practise these" on a contract row (loss against par) opens Bidding problems (loss against the robots' call). These are not always the same boards. For example, when the robots would have bid the same contract, that board has no bidding problem, and the screen may say "No mistakes of this kind".
- Problems store the robots' call from the time of the check. If js/bidding.js changes (r16-bidding16), old problems keep the old answer. Bump `DR.BV` to check boards again (the stored problems stay, by key).
- `tests/all.js` runs neither `drilltest.js` (feat17) nor `drillbidtest.js`.
