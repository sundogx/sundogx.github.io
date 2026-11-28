# Round 16: play16 (robot card play: leads.js, bots.js botPlay, ddplay.js)

## Resume here
- DONE (10:50 HKT, committed): botLead notrump weights LEAD_WB.N (js/leads.js). Held out (seed p16b, 29,830 boards):
  +0.018 +- 0.0066 DD IMPs/board overall (+0.059 +- 0.022 vs NT), played out by the heuristic robots +0.029 +- 0.010.
- Now: testing a second NT model with 10 extra suit features (NmoreA: +0.080 +- 0.020 vs NT on p16b, but not
  pre-registered) on a third fresh set p16c, against LEAD_WB.N refit on a+b.
- Next: then look at the page DD lead / doubled contracts if time allows. Deadline 14:15 HKT.

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
- Cost: botLead 0.19 ms (same code path, other weights).
