# Round 16 bidding16: slam routes after 4NT invites, other leaks

## Resume here
- Current task: reading bidding.js 4NT invites (:687 direct 4NT, :742/:752 after Stayman); solving DD sets in background.
- DD sets (fresh this round, OS temp bridge-dd-<seed>.json): tuning t16a-d, held out h16a-l, 4000 boards each.
- Baseline: tests/fixtures/basebid16.js (= bidding.js at main a19c52c). Measure: node tests/bidddsim.js 4000 <seed> --base=basebid16.
- Next: 1) implement 18+ route behind BID_OFF switch; 2) measure tuning; 3) held out + bidhuman.
