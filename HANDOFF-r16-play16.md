# Round 16: play16 (robot card play: leads.js, bots.js botPlay, ddplay.js)

## Resume here
- DONE (committed 4a5d0c2): botLead notrump weights LEAD_WB.N (js/leads.js). Held out (seed p16b, 29,830 boards):
  +0.018 +- 0.0066 DD IMPs/board overall (+0.059 +- 0.022 vs NT), played out by the heuristic robots +0.029 +- 0.010.
- Running (11:05 HKT): (a) scratch p16/c.jsonl, seed p16c, third fresh lead set: test NmoreA (10 extra NT features) refit on
  a+b against shipped LEAD_WB.N (switch only if > 2 SE). (b) `XONLY=1 NEW='{"xpen":0}' node tests/ddacc.js 16000 12 p16xa 2`
  -> scratch p16/xa.log: drop the trump minimum read from a defender's double of the final suit contract.
- Finding behind (b): on 60k robot auctions (a+b), defenders who doubled the final suit contract held 0/1/2/3/4/5+ trumps
  284/1151/1512/1402/1477/419 of 6,245; the samplers' lenMin is 3 on 5,453 of them, so the real hand breaks the limit on
  41% of those boards (2,569). xpen was flat in r13 (303 leads) and leaned + in ddplay5 (small).
- Next: if xa positive > 2 SE pooled, set xpen 0 by default in ddView (ddplay.js) and commit; else note it.

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
