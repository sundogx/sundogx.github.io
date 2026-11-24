# Bidding round 8: why-text for penalty doubles, harness fix

Status: DONE (time-boxed, 30 min). On top of 4ee44ec. Not pushed or deployed, CACHE not bumped.
Changed: js/bidding.js (explanation text only), tests/fixtures/guard.js (new), tests/fixtures/basebid8.js (new, = js/bidding.js
at 4ee44ec), tests/bidddsim.js / bidoverbid.js / bidhuman.js (load the base through the guard; bidddsim `--threads=n`), README.

## 1. Why-text (kept)
- chooseCall: when `judgeX` makes the double, the call's alert is `penaltyWhy(judgeX.last)`:
  "Penalty: expects to beat 4♥ (about 2 down)", down = max(1, round(D + level - 7)) from the defence estimate D.
  The alert travels with the auction item (table.js / worker.js already store r.alert); app.js shows it, and
  isRobotText matches "Penalty", so it gets the gold (explanation) outline, not red.
- describeCall returns that alert for an X carrying it (it can't be rebuilt from the auction: it needs the hand).
- Other penalty doubles (natural() fallback, table doubles) keep their old texts. describe.js: 0 problems.

## 2. Closer meaning (measured, dropped)
- Judgement doubles on r6a (2,000 boards, 2,102 doubles): suit doubles have < 3 trumps 48% of the time, < 10 HCP 20%
  (23% when partner bid, 8% when not); NT doubles < 10 HCP 56% (70% when partner bid). 10th percentile HCP: suit 8
  (pBid) / 10 (no pBid), NT 4 / 11.
- Tried in dblMeaning's generic xpen (level 2+): lo 7 / 10 (suit, pBid / not), 4 / 11 (NT), no trump minimum.
  bidoverbid r7hold 4000 vs basebid8: **-0.009 ± 0.005** IMPs per overbid (6,472 overbids). Reverted. Not run:
  bidddsim robots vs robots, ddacc (out of time). The meta only changes partner's decisions in bidding here; card-play
  sampling could still gain from it, so a ddacc/playsim run on doubled boards with the closer meaning is the open question.
  Maybe keep the lighter points but a trump minimum of 2, or apply only to card play (a separate meta for sampling).

## 3. Harness bug (fixed)
- `tests/fixtures/guard.js` requires the fixture and runs every exported function with BID_OFF/BID_K/BID_PENLOG cleared.
  Checked: `bidoverbid 1000 r7hold --base=basebid8 --k=pxm:99` now gives -3.17 ± 0.15 per overbid (was 0 vs 0).
  Penlog rows now come from the version under test only (the lbBy filter is harmless).

## Held-out seed
- A fresh r8hold DD cache would take far too long (100 deals in ~5 min on 4 threads); killed. Used r7hold (4,000 boards,
  built in round 7, never used for tuning since round 7 kept nothing). r8hold cache may be partial in the OS temp folder.

## Not done
- Task 4 (biggest bidpar loss): not started.
