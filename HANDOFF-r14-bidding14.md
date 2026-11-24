# Round 14 bidding14: two slam routes (shipped)

Status: DONE. Branch r14-bidding14 from main 5c31e49. Only bridge/js/bidding.js and the tests/bidddsim.js usage line changed.
Baseline: tests/fixtures/basebid14.js (bidding at 208a61b). All numbers are bidddsim/bidhuman against --base=basebid14.

## Changes
1. **18-19 opposite 1NT/2NT with a five-card major after a transfer: 6NT** (js/bidding.js, responder's rebid after the
   transfer is completed, BID_OFF 'six5'). Before, 4NT quant5 (16-17) was the only slam route, so opener passed a minimum
   with two of the major and cold 6NT on 33 was missed (r6a board 1054). Range six+1..six+2 (18-19 opposite 15-17); 20+
   keeps the old 4NT route (grand zone; r6b board 2165 lost 13 when capped higher).
   Alone: r6a +11, r6hold +6, r7hold +1; elsewhere r11b +28, r12h1 +13, all other sets 0. No losing board.
   Tried first: 5NT "pick a slam" (6M with three, else 6NT): robots +11 less (r11b +11 vs +28, r11a +6 vs 0), and
   bidhuman --human=base r6b -11 (a partner who does not know it passes 5NT). Dropped for direct 6NT.
2. **Opener's slam try over a 1M-3M limit raise: 4♣ asks for a maximum** (BID_OFF 'lrk'; knobs lrk=18 ownPts, lrm=11
   HCP for "maximum", lr3=1 uses 3NT as the ask instead). Opener with 15+ HCP, ownPts >= 18, no open side suit, and a
   four-card limit raise (not a passed hand's three-card one) bids 4♣ (alerted). Responder: 4♦ with 11+ HCP (maximum),
   else 4M. Over 4♦ opener bids 4NT RKCB. This is r13's lrk made human-safe: a minimum raise (a human's 8-9 HCP raise)
   signs off instead of answering key cards.
   Alone: tuning r6a +13, r6b +13, r6hold 0, r7hold +13; held out r12h2 +37, r13d2 +28, rv12a +24, b12fb +13, rv12c +13,
   rvw14b +13, rv12b -13 (board 436: 9 HCP 7-card side suit and a void signs off; a supPts>=14 "maximum" (knob lrs) fixed
   it but changed nothing held out except r13d2 -4, so not used), others 0.
   lrk:19 instead of 18: tuning +13, held out +54 on the r13/rvw14/r9..r12 sets (18: +78 on the same); 18 shipped.

## Combined (both changes, default) bidddsim vs basebid14
Tuning r6a +24, r6b +13, r6hold +6, r7hold +14 = **+57 / 16,000**.
Held out: r12h2 +37, r13d2 +28, r11b +28, rv12a +24, r12h1 +13, rv12c +13, b12fb +13, rvw14b +13, rv12b -13;
r13d1, rvw14a, r9hold, r10a, r11a, r11c, b12fa, r9b 0: **+156 / 58,500 boards (+0.0027 a board)**. Rare auctions, so
small per board, but every set is >= 0 except one board.

## Human partner (bidhuman 4000 boards a seed, --base=basebid14)
Default (human bids like the robots under test): r6a 0, r6b 0, r7hold +11, r9hold +10 (r13's lrk was r6a -40, all overRaise;
now overRaise 0 on every seed). --human=base (a human who does not know the new calls): r6a -11 (board 3510: the human
opener cue-bids 4♣ after his own 1H-3H, the robot reads the ask and signs off with 9 HCP), r6b 0, r7hold 0, r9hold 0.
3NT as the ask was worse with such a human (r6a -22, r6b -22: he passes 3NT), so 4♣ it is.
npm test passes; sim.js errors 0, long 0.

## Open findings
- A real human may not answer the 4♣ ask; responder's describeCall shows the alert "asks whether the limit raise is a
  maximum (4♦ yes, 4M no)". If a human answers something else, opener falls back to the general tables.
- 1N 3N P (responder 12-14 with a six-card minor) is still the largest slam-loss group (r13 note).
- js/bidding.js:742/752 (4NT quant after Stayman) and :687 (direct 4NT) have no 18+ route either; same fix shape could apply
  (not measured).
- The fresh worktree needs bridge/node_modules (npm test's workerbuild needs wrangler): symlinked from main, not committed.
