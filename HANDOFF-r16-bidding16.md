# Round 16 bidding16: slam routes after 4NT invites, other leaks

## Resume here
- Status 10:35 HKT: three candidate switches in js/bidding.js, all on by default, being measured:
  six4 (Stayman, no fit, responder 18+ bids 6NT, not 4NT quant), six6 (1m-1M-1NT: responder 6+M and 18+ bids 6M; 4M had no
  upper limit), c26 (2C-2D-suit: responder no fit, semi-balanced, 9+ HCP bids 6NT; 3NT had no upper limit), knobs ntl/ntg
  (1NT responder long-minor points, default off).
- Tuning t16a+t16b: six6 +48, c26 +7 (t16a -13 board 856: 2C on playing tricks with 18), six4 0 (rare).
- DD sets (fresh this round, OS temp bridge-dd-<seed>.json): tuning t16a-d, held out h16a-l, 4000 boards each, solving in background.
- Tools: scratchpad r16/run.sh "sets" [flags] sums bidddsim over sets; r16/over.js scans auctions stopping below slam at 30+ HCP.
- Next: 1) finish tuning on t16a-d; 2) held out h16a-l + bidhuman; 3) drop flat switches, write numbers here, commit.
