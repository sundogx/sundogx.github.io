# Round 14: leads10 (lead vulnerability reading, 2C-2D-3NT limit) -- local note

Branch r14-leads10 from main 5c31e49, with r13-ddlim2's commit a050c10 cherry-picked (test knobs limx/c2, tests/ddacc-lim.js).
Two correctness fixes, both shown to change no decision outside the auctions they target.

## 1. js/leads.js leadContext now gets the board's vulnerability (shipped; zero behaviour change today)
- leadContext(hand, auction, contract, seat, vul), leadPrior(..., W, vul), botLead(..., vul); leadView passes t.vul; js/ddplay.js
  ddConsistency's leadBeta branch passes t.vul. Test knob opts.leadNoVul (off) gives the old reading.
- Measurement: the change is a no-op with the current system. shown() (js/bidding.js:2089) reads every call from its table
  entry's MM() ranges, and vulnerability only enters the entries' hand tests (vulK in the predicates, e.g. js/bidding.js:280-287
  the p6c 3C), never the ranges. So shown(auction, seat, vul) === shown(auction, seat) on 48,000 of 48,000 seat readings
  (12,000 robot auctions, seed lvB), and leadContext / the prior / botLead were identical on 1,983 of 1,983 contracts.
  ddacc's paired measurement is therefore exactly 0 (no board passes the LVF=1 filter added to tests/ddacc-lim.js).
  Shipped because it is not negative (identical) and makes the lead right if shown() ever becomes vulnerability-dependent.
- The r13 note's example (p6c 3C read as non-vul) is in ddAuctionLimits (X.p6c), which already got vul via leadLimits.

## 2. 2C-2D-3NT minimum (shipped as a correctness fix, provably isolated)
- js/ddplay.js ddAuctionLimits: a 2C opening now sets hcpMin = max(shown()'s minimum, 22) (was: = 22, overriding 25 from
  2C-2D-3N's 25-27). That is the old keep2C=true reading, now always; keep2C is kept in the signature but unused. X.k2 knob removed.
- Isolation: over 30,000 robot auctions (seed k2B), old vs new limits (every seat, with X={} and with DD_LIMX) differ on 22
  boards, all 2C opener rebidding 3NT: 2C-2D-3N (11), 2C-2D-3N-4N-6N (3), -6N (2), -4H-4S (2), -4N (2), 2C-X-2D-3N (1),
  2C-X-2D-3C-3N-4N (1). Every other board has identical limits, hence identical sampler input and identical decisions.
- Effect (r13 k2A, 20,000 boards, every card): decl 0 changed; def 15 changed +0.034 +- 0.039 IMPs; lead 1 changed -0.06. Unmeasurable.

## Checks
- node build.mjs && npm test pass; node tests/sim.js: errors 0, long 0.
- Scripts: scratchpad lvshown.js / lvcount.js / k2count.js (session scratch, not committed).

## Open findings
- js/bots.js:439 calls botLead(hand, auction, c, seat) without vul (now an optional 5th argument). No effect today (see 1).
- js/bots.js:174 endLimits0 passes keep2C=true; now redundant (same reading as the default).
