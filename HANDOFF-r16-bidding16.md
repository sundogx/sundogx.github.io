# Round 16 bidding16: slam routes after 4NT invites, other leaks

## Resume here
- Status 10:45 HKT. Switches in js/bidding.js (all on by default; BID_OFF names): six4 (Stayman no fit, 18+ -> 6NT),
  six6 (1m-1M-1NT: 6+M and 18+ -> 6M), sixn (1x-1y-simple rebid: 19+ balanced, stoppers -> 6NT), r6n (1m: no major, 19+ -> 6NT
  instead of the catch-all 3NT), six2n (1x-1M-2NT: 6+M and 13+ -> 6M), j4m (1M-1y: opener 6+M, 19+ -> 4M), j3n (1m-1y: opener
  6+m with 2 of AKQ, 19+ -> 3NT, responder 6NT with 11+ (knob j3n6), else pass/4M).
- Tuning t16a-d (16,000 boards) vs basebid16: six6 +61, sixn +14, r6n +13, six2n +50, j4m +14, j3n ~+86 (j3n6:11), six4 0.
  Dropped (flat/negative on tuning): c26 (-5), six6b (-30), nsf4 (-8..-12), js1n (+3), js20 (-4), ntg/ntl knobs (+15..22, unclear).
- bidhuman t16a-d: +7, +13, 0, 0 (both default and --human=base): no regression.
- Held out h16a-l NOT yet used (solving in background into OS temp bridge-dd-<seed>.json).
- Tools: scratchpad r16/run.sh "sets" [flags] sums bidddsim over sets; r16/cap.js scans bids made above the shown range.
- Next: 1) a few more leaks via cap.js; 2) held out all switches on h16a-l (+ per switch); 3) npm test, sim.js, note, commit.
