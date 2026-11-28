# Round 16, feat18: bidding problems from your own boards ("Your mistakes", kind Bidding)

## Resume here
- Status: working, committed on `r16-feat18` (based on `r16-feat17`). `npm test` passes, sim shows errors 0 and long 0, `node tests/drillbidtest.js` and `node tests/drilltest.js` pass, `tests/drillbid.pw.mjs` passes at 390 and 1280.
- Half done: nothing. Next steps: (1) README section for the Bidding kind, (2) rerun feat17's `tests/drills.pw.mjs` to confirm nothing broke, (3) at merge add `['drilltest.js'], ['drillbidtest.js']` to `TESTS` in `tests/all.js`.
- Key numbers: checking one board's calls takes about 1.2 ms (node, 1,000 boards with real DD tables). With a human-like slip on about half the boards, 531 problems came from 1,000 boards.

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
- `NODE_PATH=<dir with playwright-core> node tests/drillbid.pw.mjs --shots=../screenshots/r16-feat18`: real Chrome at 390x844 and 1280x800, 25 checks each, all ok. It seeds 16 boards with a South slip, opens History, waits for "Practise these" (Bidding), and checks the problem (hand, "?", meanings, legal calls, explain pop-up). It answers with the table's call (wrong, graded, the robots' call explained) and with the robots' call (right, box 1). It also checks the full scan (16 boards, 8 problems), Hand record, Escape, no sideways scroll and no page errors.

## Open findings
- `tests/all.js` runs neither `drilltest.js` (feat17) nor `drillbidtest.js`.
