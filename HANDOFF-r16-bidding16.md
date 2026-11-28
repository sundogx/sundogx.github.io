# Round 16 bidding16: slam routes and "no upper limit" leaks (shipped)

## Resume here
- Status 12:40 HKT: DONE after the review fix pass (REVIEW-r16-bidding16.md in the main folder). Final numbers are in
  "Review fix pass" below; the earlier sections describe the first version (some switches since dropped).

## Review fix pass (final state)
Review finding: partnering humans lost on fresh seeds rv16a-e (bidhuman -131): light human openers and human jump shifts met
direct slam calls. Per-switch bidhuman on rv16a-e: szo2 -76, six6 -22, szo -18, r6n -16, others 0.
- Dropped r6n and six6 (direct 6-level calls opposite a possibly light opener) and six4 (can never fire for a robot).
- szo/szo2 threshold 33 -> 34 slam points.
- szo2k (new, on): in natural(), a slam with an open side suit goes only through key cards (4NT); no direct 6-level call.
- j3n: opener needs the other two suits stopped (switch j3ns; held out -28, kept for safety with a human 3NT).
- nxj cue bid now has the text "Cue bid: 19+ points, game forcing" (tag cue19), like the app's other cue bids.
- Tried: szFloor (slam points with partner at the bottom of his range) did not separate light human openers: dropped.
  judgeX HCP floor for penalty doubles (coordinator's request; NT 7, suit 4, switch xfl): tuning +6, held out h16a-l -198
  (double-dummy scoring rewards those low-HCP doubles): not shipped. If the play-based measure disagrees, it is a one-line
  guard after the pxl check in judgeX (js/bidding.js, function judgeX).
Final numbers (bidddsim vs basebid16, 4000 boards a set):
- Robots: f16a-h +577, +0.0180 ± 0.0032 a board; rv16a-e (reviewer's fresh sets) +317, +0.0158 ± 0.0041; h16a-l +764,
  +0.0159 ± 0.0026. Together +1658 / 100,000 boards = **+0.0166 ± 0.0018 a board** (first version: +0.024; the human fix cost ~30%).
- bidhuman: rv16a-e +6 (2, -7, 22, -11, 0), with --human=base +17; t16a-d + h16a-d +61. Was -131 on rv16a-e.
- npm test passes; sim.js errors 0, long 0.
- Open (review 3): responder's 6NT answer reads any 1m-1y-3NT as j3n; a human's balanced 3NT measured +596/80k for the new
  partner in the review, so it was left.

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
| nxj4 | 1x (ovc at 2) X P | opener with 6+ M and 15-18 bids 4M when there is no room to jump (3M had no upper limit) |
| r3n | 1x 1y 2x | responder with 13+, at most one card in opener's suit and the other suits stopped bids 3NT (natural bidding chose 2y, shown 6-10) |

## Measurements (bidddsim vs basebid16, IMPs for the new system, 4000 boards a set; DD caches in the OS temp folder)
- **Fresh f16a-h (32,000 boards, no decision used them): +911 IMPs, +0.0285 ± 0.0044 a board** (95% CI +0.020..+0.037).
  f16e-h alone (never looked at before the final run): +390, +0.024 a board.
- Held out h16a-l (48,000): +1136, +0.0237 ± 0.0035 a board. Off-one deltas there (what each switch adds): szo2 +203,
  r3n +112, szo +98, j3n +96, r4o +96, six6 +94, nxj +85, six2n +71, sixn +64, r6n +38, nxj4 +35, j4m +11, six4 0.
- Tuning t16a-d (16,000): +485, +0.030 ± 0.007 a board.
- Held out + fresh together: +2047 / 80,000 = +0.0256 ± 0.0027 a board (r14 shipped +0.0027).
- six4 changed no board on any set (rare hand); kept because it is the textbook route the Stayman 4NT invite lacked.
- bidhuman (4000 boards a seed, new - base summed over deviated boards), t16a-d and h16a-d: +6, +27, -28, +16, +56, -2, +33, +5
  (total +113); with --human=base: +6, +38, -26, +16, +69, +24, +35, +5 (+167). No regression partnering humans.
- npm test passes; sim.js errors 0, long 0.
- Note: js/bidding.js:687 (direct 1NT-4NT) already had a 6NT route for 18+ (line above it); the gaps were after Stayman and in
  the suit auctions listed above.

## Tried, not shipped
- ntq 30 (1NT/2NT quantitative and 6NT one point lighter): tuning +64, held out -98 (h16a-h). Reverted (knobs ntq/ntq6 stay).
- c26 (2C-2D-suit: 6NT with 9+ and no fit): -5 (2C openers on playing tricks with 18 HCP).
- six6b (6M over 1x-1M-2x simple rebid, 18+ or a good suit 19+): -30 / -15 (opener's rebid can be a singleton in M).
- nsf4 (a forcing new suit on four cards when no call fits): -8..-12 (5m on 4-4 fits).
- js1n (1S-1NT-3H jump shift 19+) +3; js20 (jump shift with a 5-4-2-2 20+) -4; x4m (3x X P: 4M on four cards with 10+): noisy -32..+13;
  nrx (1NT (2x) P P X reopening with a doubleton, plus answers) +3; szo3 (NT-system key-card asks with an open suit) 0;
  q1/q2 (lighter quant after 1NT/2NT rebids) +1/+11; ntg/ntl (1NT responder long-minor points) +15..22; nts 30/29 -25/-153;
  sp 29 -150; st 10 +9; g7/g5 grand thresholds +19/-11/+27; r4t (4M on a doubleton over 1x-1y-2x) no board changed;
  axj 20/22 (jump advance of a takeout double one point lighter/heavier) -8/-67.

## Open findings
- The NT auctions remain the largest slam-loss group (2N 3N P, 1N 2C 2D 3N, 2C 2D 2N 3N, 1N 3N P): quant thresholds look
  right on held out (ntq 30 lost).
- 2/1 GF auctions: 4NT without an agreed suit is read as key-card for the last natural suit (fourNTMeaning, js/bidding.js:185),
  so there is no quantitative 4NT after 1S 2C 2D etc.; responder's 18 balanced stops in 3NT opposite a minimum.
- Opener after 1NT (2x) P P has no reopening double (nrx flat).
- tests/bidddsim.js usage line could add "basebid16: before the sixteenth round, a19c52c" (not my file).
- The worktree needs bridge/node_modules (symlinked from main, not committed).
