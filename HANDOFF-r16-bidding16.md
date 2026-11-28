# Round 16 bidding16: slam routes and "no upper limit" leaks (shipped)

## Resume here
- Status 11:55 HKT: all changes committed on r16-bidding16; final confirmation on fresh sets f16a-h is running/pending
  (bidddsim 4000 f16x --base=basebid16; scratchpad r16/run.sh). If those numbers are missing below, rerun them and fill in.
- Next: fill in the f16 line; npm test + sim.js; commit.

## What and why
Missed slams were the biggest bidding loss. Many came from table entries whose condition had no upper point limit, so a much
stronger hand made a limited call and partner passed (found with a scan of calls made 2+ HCP above the range they show,
scratchpad r16/cap.js). Fixes are in bridge/js/bidding.js, each behind a BID_OFF switch; baseline tests/fixtures/basebid16.js
(= bidding.js at main a19c52c). All new calls are natural, so none is alerted (ACBL); the GF cue bid in nxj is not alertable.

| switch | auction | change |
|---|---|---|
| six4 | 1NT 2C 2x (no fit) | responder 18+ bids 6NT (was a 16-17 4NT invite with no upper limit) |
| six6 | 1m 1M 1NT | responder with 6+ M and 18+ bids 6M (4M 13-17 had no upper limit) |
| sixn | 1x 1y simple rebid | responder 19+ balanced with the unbid suits stopped bids 6NT (3NT 13-16 had none) |
| r6n | 1m response | 19+ with no major bids 6NT instead of the catch-all 3NT (13-15) |
| six2n | 1x 1M 2NT (18-19) | responder with 6+ M and 13+ bids 6M (4M 6-12 had none) |
| j4m | 1M 1y | opener with 6+ M and 19+ jumps to 4M (3M 15-18 had none) |
| j3n | 1m 1y | opener with 6+ m (2 of AKQ) and 19+ jumps to 3NT; responder bids 6NT with 11+ (knob j3n6), 4M with 6+ M, else passes |
| nxj | 1x (ovc) X P | opener with 19+ (not balanced with a stopper) cue-bids their suit (GF); with 6+ and 16-18 jump-rebids (the cheap rebid had no upper limit) |
| r4o | 1x 1M 4M | responder asks for key cards with 15+ support points even with an open side suit |
| szo | slamZone() | slam try (slamAsk) despite one open side suit when slam points >= 33 (knob szo) |
| szo2 | natural() | same for the natural slam target and its 4NT (knob szo2) |

## Measurements (bidddsim, IMPs for the new system, 4000 boards a set, DD caches in the OS temp folder)
- Tuning t16a-d (16,000): all on +449, +0.028 ± 0.007 a board. Alone (off-one deltas): six6 +61, six2n +50, j3n ~+86,
  nxj +48, sixn +14, r6n +13, j4m +14, r4o +9, szo +122, szo2 +18, six4 0.
- Held out h16a-l (48,000): all on **+989, +0.0206 ± 0.0034 a board**. Per switch on h16a-h (off-one delta, 32,000 boards,
  before szo/szo2): j3n +52, nxj +37, six6 +50, six2n +35, sixn +61, r6n +25, j4m +14, r4o +72, six4 0; szo +223 and
  szo2 +173 on h16a-j.
- Fresh f16a-h (32,000, never used for any decision): FILL
- six4 changed no board on any set (the hand is rare); kept because it is the textbook route the 4NT invite lacked.
- bidhuman (4000 boards a seed, new - base on deviated boards): t16a +6, t16b +27, t16c -28, t16d +16, h16a +56, h16b -2;
  with --human=base: +6, +38, -26, +16, +69, +24. No regression.
- npm test passes; sim.js errors 0, long 0.

## Tried, not shipped
- ntq 30 (1NT/2NT quantitative and 6NT one point lighter): tuning +64, held out -98 (h16a-h). Reverted (knobs ntq/ntq6 stay).
- c26 (2C-2D-suit: 6NT with 9+ and no fit): -5 (2C openers on playing tricks with 18 HCP).
- six6b (6M over 1x-1M-2x simple rebid, 18+ or a good suit 19+): -30 / -15 (opener's rebid can be a singleton in M).
- nsf4 (a forcing new suit on four cards when no call fits): -8..-12 (5m on 4-4 fits).
- js1n (1S-1NT-3H jump shift 19+) +3; js20 (jump shift with a 5-4-2-2 20+) -4; x4m (3x X P: 4M on four cards with 10+): noisy -32..+13;
  nrx (1NT (2x) P P X reopening with a doubleton, plus answers) +3; szo3 (NT-system key-card asks with an open suit) 0;
  q1/q2 (lighter quant after 1NT/2NT rebids) +1/+11; ntg/ntl (1NT responder long-minor points) +15..22; nts 30/29 -25/-153;
  sp 29 -150; st 10 +9; g7/g5 grand thresholds +19/-11/+27.

## Open findings
- The NT auctions remain the largest slam-loss group (2N 3N P, 1N 2C 2D 3N, 2C 2D 2N 3N, 1N 3N P): quant thresholds look
  right on held out (ntq 30 lost).
- 2/1 GF auctions: 4NT without an agreed suit is read as key-card for the last natural suit (fourNTMeaning, js/bidding.js:185),
  so there is no quantitative 4NT after 1S 2C 2D etc.; responder's 18 balanced stops in 3NT opposite a minimum.
- Opener after 1NT (2x) P P has no reopening double (nrx flat).
- tests/bidddsim.js usage line could add "basebid16: before the sixteenth round, a19c52c" (not my file).
- The worktree needs bridge/node_modules (symlinked from main, not committed).
