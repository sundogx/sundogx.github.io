# Round 16: play16 (robot card play: leads.js, bots.js botPlay, ddplay.js)

## Resume here
- Current task (10:25 HKT): botLead (heuristic lead: strangers-mode server robots, Beginner, fallback) notrump refit.
- Data: scratchpad p16/a.jsonl (30k boards, seed p16a, true DD result of every lead; `node tests/leadsim.js gen F 30000 p16a 12 0 0`),
  p16/b.jsonl (seed p16b, fresh held-out, generating). Fit/eval script: bridge/tests/fixtures/r16-leadfit.js (copy of scratch fit.js).
- CV on a.jsonl (train even g, test odd g, 14.9k boards; IMPs/board vs botLead now): every refit gains vs NT
  (+0.054..+0.094 +- 0.03), and every refit is slightly worse vs suits (-0.01..-0.02 +- 0.012).
- Pre-registered: NimpA = notrump weights refit to IMPs (ridge lambda 300) on all of a.jsonl, suits unchanged; botLead only
  (page DD lead's prior keeps LEAD_W). Ship if held-out on b.jsonl NT gain > 2 SE.
- Next: run `node fit.js a.jsonl b.jsonl NimpA NmoreA` (DUMP=1 prints weights), port to leads.js as LEAD_WB.N, test, commit.

