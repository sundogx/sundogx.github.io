# Round 16: play16 (robot card play: leads.js, bots.js botPlay, ddplay.js)

## Resume here
- Work complete, review fixes included (13:10 HKT). Nothing half done; see "Open findings" at the end.
- Review fix pass: both double readings (DD_XPEN, DD_XPENH) now apply only when the final double's meaning tag is 'xpen'
  (js/ddplay.js ddFinalPenX); the trump minimum keeps what the doubler's earlier calls showed; fixture scripts use
  `process.env.R || path.join(__dirname, '../../js/')`.
- Re-measured, fresh seed p16xd, fixed package against the pre-round reading: `XONLY=1 NEW='{"xpen":-1,"xpenH":0}'
  node tests/ddacc.js 12000 13 p16xd 2` (1,648 doubled boards): old reading declarer -0.0243 +- 0.0069 IMPs per decision
  (1,090 of 18,022 changed), defenders -0.0155 +- 0.0064 (557 of 15,011), lead +0.021 +- 0.023 (88 of 1,648; flat).
  So the new readings gain +0.024 (declarer) and +0.016 (defenders) per decision on doubled boards.

## Summary
| change | file | held-out measurement |
|---|---|---|
| botLead NT weights LEAD_WB.N | js/leads.js:150 | 2 x 30k fresh boards: +0.015 +- 0.005 DD, +0.027 +- 0.007 played out IMPs/board (review reproduced +0.027 DD, +0.021 played out) |
| no trump minimum from a defender's double of the final suit contract (DD_XPEN 0) | js/ddplay.js ddXpenLimit | doubled boards p16xa: decl +0.015 +- 0.006, def +0.012 +- 0.004 IMPs/decision; confirmed p16xb (old vs new): decl -0.014 +- 0.005, def -0.017 +- 0.005, lead -0.037 +- 0.019 |
| no HCP minimum from that double either (DD_XPENH) | js/ddplay.js | doubled boards p16xb, on top: decl +0.016 +- 0.005, def +0.015 +- 0.005 |
| review fix: both only for 'xpen' doubles, earlier trump length kept | js/ddplay.js ddFinalPenX | whole package vs old, fresh p16xd: decl +0.024 +- 0.007, def +0.016 +- 0.006, lead -0.021 +- 0.023 (flat) |

## 1. botLead notrump refit (shipped)
- Who: botLead is the lead of strangers-mode online robots (src/worker.js plays botPlay/botLead), Beginner robots and
  the page's fallback. The page's Strong/Expert DD lead (leadChoose) is unchanged: its prior keeps LEAD_W.
- Data: `node tests/leadsim.js gen F 30000 SEED 12 0 0` (true DD result of every lead; K=0 fixed in leadsim, it meant 32).
  Train p16a 29,784 boards, held out p16b 29,830 boards. ~12 min each with 12 workers under load ~35.
- Script: bridge/tests/fixtures/r16-leadfit.js (fit variants, evaluate vs botLead), r16-leadver.js (new vs BOT_OFF lwb,
  DD and played out by botPlay at the server budget; shard with `node r16-leadver.js b.jsonl 1 i/10`).
- CV on p16a (even/odd g): every refit gains vs NT (+0.05..+0.09 +- 0.03) and loses slightly vs suits (-0.01..-0.02 +- 0.012),
  also when shrunk toward LEAD_W (lambda 300-3000). So suits keep LEAD_W.S.
- Pre-registered rule NimpA (NT only, IMP target, lambda 300, trained on all p16a), held out on p16b:
  DD +0.0180 +- 0.0066 IMPs/board (2,756 of 29,830 leads changed; NT +0.059 +- 0.022), played out +0.0293 +- 0.0101.
  By slice (NT): game +0.042, part +0.060, doubled games +0.43 +- 0.18, doubled partials -0.22 +- 0.18 (n 272).
- Second held-out set p16c (29,804 boards): DD +0.0120 +- 0.0068, played out +0.0255 +- 0.0098 (2,772 leads changed).
  Pooled p16b+p16c: DD +0.015 +- 0.0047, played out +0.027 +- 0.007 IMPs/board.
- Not shipped: NmoreA (10 extra NT suit features: intermediates, AQ/KJ tenaces, length without honour, length x weak/strong
  hand, good long suit, partner's suit short, their suit long, Qxx/Jxx; ridge 100, tricks) refit on p16a+b, vs shipped on
  p16c: +0.017 +- 0.015 vs NT (it led +0.080 vs +0.059 on p16b). A refit of the shipped rule on a+b: +0.015 +- 0.009 vs NT.
  Doubled suit contracts with their own refit (SX*): +0.004 +- 0.005. Within-suit card (leadCardOf) vs other cards of the
  same suit, DD on p16a: no holding with 300+ cases where another card beats the conventional one by > 0.08 IMPs.
- Cost: botLead 0.19 ms (same code path, other weights).

## Finding for bidding.js (not my file): robots double 3NT with 0-5 HCP
- js/bidding.js judgeX ("Penalty: expects to beat 3NT (about 2 down)") doubles notrump contracts with 0-5 HCP: on
  p16a+b+c (89,438 robot auctions) 555 doubled NT contracts by a 0-5 HCP defender; the contract made 57% of the time and the
  double cost -1.51 IMPs a board against not doubling (DD, botLead lead), -838 IMPs in all (~-0.009 IMPs/board overall).
  Examples (doubler's call reproduced by botCall): `P 1D 1N P 2N P 3N X` (N, 3 HCP), `1C P P X P 1N P 3N P P X` (W, 4 HCP),
  `P 2C 3S X` (E, 2 HCP: "about 3 down"). NT doubles by 6-8 HCP -0.13, 9-11 +0.23, 12+ +0.32 IMPs; suit doubles by
  0-5 HCP -0.12, 6-8 +1.03, 9+ +1.25..2.03. Script: scratch p16/xw.js, xw2.js (copies in bridge/tests/fixtures/r16-xw*.js).

## 2. No trump minimum from a defender's penalty double (shipped)
- js/ddplay.js ddView: DD_XPEN = 0 applies the old test knob ddXpenLimit by default (opts.xpen -1 = off, the old reading).
  shown() reads the robots' judgement doubles as 3+ trumps; on 89k robot auctions the doubler had 0-2 trumps on 47% of
  doubled suit contracts (histogram in the ddplay.js comment), so the sampler excluded the real layout on 41% of them.
- Measured (pre-registered: xpen 0 vs current, fresh seed, ship if > 2 SE): `XONLY=1 NEW='{"xpen":0}' node tests/ddacc.js
  16000 12 p16xa 2` (only boards whose auction ended doubled: 2,151 of 16,000; every second card): declarer
  +0.0152 +- 0.0058 IMPs per decision (1,000 of 23,247 changed), defenders +0.0116 +- 0.0042 (521 of 19,780), lead
  +0.017 +- 0.016 (93 of 2,151). Time per decision falls (decl 157 -> 145 ms, def 710 -> 647, lead 3,734 -> 3,398 in Node),
  as fewer layouts are rejected. Main thread: unchanged (one comparison in ddView).
- Fresh-seed confirmation (seed p16xb, `XONLY=1 NEW='{"xpen":-1}'`, i.e. the old reading against the new default, xpenH
  off): declarer -0.0141 +- 0.0051 (981 of 22,789 changed), defenders -0.0171 +- 0.0045 (462 of 18,914), lead -0.0371 +-
  0.0193 (89 of 2,077): the old reading is worse on every kind of decision. (That run's ms column compares choices cached
  from an earlier, more loaded run with fresh ones: not a speed measurement.)
- Size: measured only per decision on doubled boards (ddacc). An earlier per-board extrapolation (+0.03-0.06 IMPs/board
  overall) was withdrawn: decisions are not independent and ddacc does not play the boards out.
- Independent review (round 16) reproduced: doubled boards, defenders +0.024, declarer +0.013 +- 0.007 IMPs per decision,
  lead flat; and a sampler side effect (the changed limits also change which layouts the other decisions are dealt)
  measured flat, -0.004 +- 0.007.
- Human doublers (practice with a human partner, friends mode) more often hold trumps for a penalty double; the looser
  limit then only gives the sampler less information, it never excludes their real hand.
- Earlier rounds saw the same sign with too few boards (r12 ddplay5 ODD=1: +0.008..+0.031; r13 lead-only: +0.017 +- 0.017).

## Other limit misreadings (audit, not acted on)
- Real hands outside ddAuctionLimits (DD_LIMX) on p16a: 5.2% of 119,136 seat readings (scratch p16/viol.js, copy
  bridge/tests/fixtures/r16-viol.js). Largest groups: defenders who passed throughout over 1S-2S / 2S / 1H-2H with more
  than the 17 cap (62/53/47 cases), negative doubles (`pd1D op1S meX`) lengths, `op2S op4S meX` trump length. Each is
  small; most are shown() readings (bidding.js).

## 3. No HCP minimum from a defender's double of the final contract either (shipped)
- js/ddplay.js ddXpenHcp, DD_XPENH = true (opts.xpenH 0: off): the doubler's hcpMin becomes the minimum its calls before
  the double showed (ddAuctionLimits on the auction up to the double, minimums only). Notrump doublers were below the
  limit on 483 of 1,605 boards, suit doublers on 622 of 6,245 (p16a+b; scratch p16/xn.js, copy tests/fixtures/r16-xn.js).
- Pre-registered on a fresh seed, on top of DD_XPEN: `XONLY=1 NEW='{"xpenH":1}' node tests/ddacc.js 16000 12 p16xb 2`
  (2,077 doubled boards): declarer +0.0164 +- 0.0051 IMPs per decision (665 of 22,789 changed), defenders +0.0146 +- 0.0051
  (358 of 18,914), lead +0.011 +- 0.020 (63 of 2,077). ms per decision unchanged (120 -> 118, 537 -> 530).
- Main thread: one more shown() reading per ddView on doubled contracts only; with full=false the ddShownBalanced memo is
  not evicted, so after the first call it is a cache hit (Node: 0.11 vs 0.09-0.12 ms per ddView, i.e. within noise).

## Open findings
- js/bidding.js judgeX (bidding agent's file): 0-5 HCP doubles of notrump games, -1.5 IMPs each, ~-0.009 IMPs/board overall
  (section "Finding for bidding.js" above). Also js/bidding.js:181 reads a penalty double as 3+ trumps (`mn: { [st]: 3 }`),
  which the robots' doubles don't meet 41% of the time; ddplay now ignores it, but shown() users elsewhere (leads.js
  leadContext pLen, bots.js seatShown) still read it.
- js/bots.js:174 endLimits0 (botPlay endgame, server strangers-mode robots) does not apply DD_XPEN / DD_XPENH. Probably small
  (r13: DD_LIMX there was flat on 20k boards); heurstim has no XONLY filter to measure it cheaply.
- tests/leadsim.js gen: K=0 now means no layouts (fixed; was 32). Fast data recipe for heuristic-lead work:
  `node tests/leadsim.js gen F 30000 SEED 12 0 0` (~12 min).
- The DD (page) lead could not be measured on enough boards here: 48 layouts per board runs < 0.5 boards/s under load.
- Limit-violation audit (section above): 5.2% of seat readings break ddAuctionLimits; remaining groups are small.
