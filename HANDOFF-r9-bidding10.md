# Round 9 bidding10: robots read a takeout doubler's later long suit correctly

Status: DONE (~85 min). Branch r9-bidding10 from main cf26413. Not pushed, merged or deployed; CACHE not bumped.
Changed: bridge/js/bidding.js (agg(), one rule), tests/fixtures/basebid10.js (new baseline = bidding at cf26413),
tests/bidddsim.js (usage line lists basebid10). README not touched (not my file): a merger may add a line under Competition.

## Kept
`xlong` (agg(), bridge/js/bidding.js:76-79): a takeout double followed by the same seat's own 5+ suit (X, then 2H)
was a strong hand with that suit, so the double's "3+ in the unbid suits / short in theirs" no longer counts towards what
that seat has shown. Before, 1D X P 1S P 2H P had advancer credit the doubler with 3 spades and jump to 4S on
86542.A6.Q96.T64 (went -1100 doubled; bidhuman r6a board 547); boards 817, 3188, 2243 were the same kind of 4M jump on 1-8 HCP.
Switch off with `--off=xlong`.

Numbers (vs basebid10):
- bidhuman, xLong deviations (human doubles with a long suit, then bids it), IMPs per deviation, new - base:
  r6a -0.03 ± 0.22 (145), r6b +0.76 ± 0.27, r6hold +0.54 ± 0.23, r7hold +0.74 ± 0.23, r9hold +0.67 ± 0.26,
  r9b +0.61 ± 0.30, r10a (new, held out) +0.78 ± 0.29. All deviation types together: r9b +0.047 ± 0.017, r10a +0.038 ± 0.018
  per deviation. 0 illegal calls/errors, 0 forcing calls passed.
- bidddsim robots vs robots (it fires on 2-9 boards of 4000): r6a +0.009, r6b -0.003, r7hold -0.001, r6hold +0.003,
  r9hold -0.002, r10a -0.004 (each ± 0.002..0.007): flat, about +0.0003 a board on average.
- bidoverbid r10a: -0.005 ± 0.003 per overbid (sum -35), all from one deal (2436) counted at two human seats: a robot doubler with
  15 HCP and six clubs doubled 1D, later bid 3C in competition while holding AJ9 of hearts; partner now bid 3NT (down) instead of 4H.
  Robots X with a long suit and middling values here and there; a narrower rule (void only for 2-level or jump rebids) is untested.
- npm test, build, sim.js ("errors":0, "long":0) pass.

## Tried, measured flat or negative (not shipped)
- `nt6`: no 6NT straight away without a fit below 33 - SD combined (invite with a quantitative 4NT or stop in game); targets
  1D-2H(jump shift)-6NT on 13 HCP. bidhuman jumpShift/light21/nt14: +11, +14, -11 IMPs (r6a, r7hold, r6hold; other sets 0);
  robots r6a -0.006, r6b -0.003, r7hold +0.003. Net negative, dropped.
- Advancer of a takeout double preferring a 4-card major over a 5-card minor (major bonus 1.5 instead of 0.5 in advanceX order;
  1H X P 2D on KJ53.5.QT854.Q72 missed 4S): r6a 0.000, r6b -0.001, r7hold +0.007 against the xlong-only numbers. Flat, dropped.
- Doubler's pass after partner's advance and their raise read as at most 16 HCP (natMean 'P'): r6a +0.001, r6b -0.001,
  r7hold -0.008. Dropped (also did not change the target case, where the pass comes from a table).

## Where the losses are (for the next round)
- bidhuman per-deviation costs (r6a, base partner): overRaise -1.70 (37), xLong -0.97 (now better), jumpShift -0.95 (38), nt14 -0.64,
  xThin -0.63, skipMajor -0.48, open4M -0.43 (456). Most worst boards are the deviation's own cost (thin doubles doubled at 2 level).
- Jump shift by a human: opener jumps to 6NT with 30 combined (natural(): c6 with totLo >= 32 - SD for notrump too, js/bidding.js
  target >= 6 block). Fixing it alone measured negative (above); a version that only applies after a 'jsr' meaning is untested.
- After X and a free advance, advancer jumps to 4M on 8 HCP when the doubler passed their raise (bidhuman r6b board 1712):
  the doubler's pass reads as 0-37.
- bidpar contested missed games are spread thin over sequences (no group above 60 IMPs in 4,000 deals).
- New DD caches in the OS temp folder: r10a (4000, used once as held-out) and r10hold (being solved when I stopped; may be partial).
