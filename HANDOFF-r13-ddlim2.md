# Round 13: ddlim2 (auction limits for leads, 2C limits, doubled leads) -- local note

Branch r13-ddlim2 from main 208a61b. **No robot behaviour change shipped** (nothing measured positive on held-out boards).
Committed: two off-by-default test knobs and the harness tests/ddacc-lim.js. Logs: scratchpad ddlim2/ (limA, limB, k2A, xlA).
Machine load was ~40 during the runs (other agents); leads are time-budgeted, so both arms got fewer layouts equally.

## Tools
- tests/ddacc-lim.js: tests/ddacc.js (with AOFF) plus LIMF: LIMF=1 keeps only boards where NEW.limx changes some seat's
  limits against X={}; LIMF=2 against DD_LIMX. Own cache name (ddacclim).
- js/leads.js leadLimits(auction, seat, vul, X) and leadView(view, t, opts): ddView's opts.limx reaches the lead
  sampler (default X={}, identical to main). js/ddplay.js exports DD_LIMX; X.k2 knob = keep2C reading.

## 1. DD_LIMX for leads.js: NOT shipped (flat)
`LIMF=1 TO=1 NEW='{"limx":{"p6c":1,"pre":15,"cont":10}}' node tests/ddacc-lim.js N W seed 1` (lead only; current = plain limits).
- tune limA 4000 boards: 450 leads affected, 29 changed: +0.0089 ± 0.0327 IMPs, +0.0044 ± 0.0118 tricks.
- held out limB 6000 boards: 712 leads, 59 changed: -0.0309 ± 0.0326 IMPs, +0.0056 ± 0.0066 tricks
  (doubled subset 114: -0.28 ± 0.19 IMPs). Per board that's ~0.004 IMPs either way: noise.
## 2. 2C-2D-3NT minimum (ddAuctionLimits sets 22, overriding shown()'s 25): confirmed, NOT shipped (unmeasurable)
- Repro: shown() gives pts 25-27 for 2C-2D-3N; ddAuctionLimits returns hcpMin 22 (keep2C=true gives 25).
- k2A: 20,000 boards, LIMF=2 NEW limx+k2, every card: decl 284 decisions 0 changed; def 262, 15 changed +0.034 ± 0.039 IMPs;
  lead 16, 1 changed -0.06. ~1 changed decision per 1,300 boards. A correct fix but no measurable effect; a one-word
  change (`X.k2` into DD_LIMX, or default keep2C) if the reviewer wants correctness over the measurement rule.
## 3. 2C minimum of 22: not a bug in effect (no new measurement this round)
- Real 2C openers: 36% have 18-21 (r12 audit). r12 measured c2=18 mixed (def +0.0026 tr, defX -0.0073) and c2=20 flat on 6000
  boards. Because the sampler keeps only exact fits, a low minimum over-samples weak openers; 22 is a fair proxy. Leave it.
  A better fix would be a weighted HCP prior (sample 18-21 with ~1/3 weight), not a hard minimum.
## 4. Doubled contracts lose on the lead: not the shown() reading
- shown() reads a penalty double as 3+ trumps/10+ pts and reaches leadLimits (dd5 probes). judgeX doubles count tricks,
  so ODD=1 XONLY=1 TO=1 NEW='{"xpen":2}' node tests/ddacc.js 2400 3 xlA 1 (stopped at 1150 boards): 303 doubled leads,
  22 changed, +0.0165 ± 0.0165 IMPs (one board), +0.003 tricks. Flat: the doubler's trump limit hardly moves the lead.
  Consistent with r12-doubles: the loss is doubled scoring, not misread limits.

## Open findings
- js/leads.js:101 leadContext calls leadShown(auction, partner) etc. without vul (shown()'s vul-dependent calls, e.g.
  the p6c 3C, read as non-vul). Unmeasured.
- bots.js endgame (endLimits0, js/bots.js:174) still uses keep2C=true and no DD_LIMX (heur12's area).
