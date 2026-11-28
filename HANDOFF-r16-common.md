# Common rules for round-16 agents (local file, not in git)

- Set up your own worktree from current main:
  `cd /Users/admin/Documents/sundogx.github.io && git worktree add .claude/worktrees/r16-<name> -b r16-<name> main`.
  Work only there. Code is in bridge/. First read bridge/README.md, the "Owner's UI choices" section of
  /Users/admin/Documents/sundogx.github.io/HANDOFF.md (keep every one of them), and your area's earlier
  handoff notes (the top of HANDOFF.md for rounds 10-12, plus the r10-r12 notes in .claude/worktrees/r1*/HANDOFF-*.md, HANDOFF-audit-*.md in the main
  folder) for what has been tried and what failed.
- Ship only measured improvements:
  - Robot logic: use the area's harnesses (tests/bidsim.js, bidloss.js, bidhuman.js, bidpar.js,
    playsim.js, defsim.js, leadsim.js, ddacc.js, heurfit.js). Report before/after numbers with enough
    boards to beat the noise, and keep changes that measure flat or negative out of the branch.
  - UI and stability: reproduce each bug first (Playwright or a Node test), fix it with the smallest
    change, then show it fixed.
- Playwright: playwright-core with `channel: 'chrome'`. A helper that serves bridge/ through request
  interception is at
  /private/tmp/claude-501/-Users-admin-Documents/15b6824a-a1d9-49bc-a61c-0049209dc3e7/scratchpad/smoke/lib.js
  (set ROOT to your worktree's bridge/). If it is missing, install playwright-core in a scratch folder.
- Own only your listed files. Others are editing the rest. Put bugs you find elsewhere in your note.
  Do not touch bridge/ben/. Do not bump CACHE in sw.js.
- Before each commit: `cd bridge && node build.mjs && npm test` passes, and `node tests/sim.js | head -1`
  shows "errors":0 and "long":0. For server changes also run `npx wrangler dev --port <free port> &` and
  `BRIDGE_URL=http://localhost:<port> node tests/online.test.mjs` (plus online-multi).
- Never push, never merge to main, never deploy. Commit on your branch. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't commit .claude/.
- Write HANDOFF-r16-<name>.md at your worktree root and commit it. Include each change with its
  measurement or repro, what you tried that did not help, and open findings with file:line.
- HARD time limit: commit and report by 14:15 HKT (machine clock, `date`) on 2026-11-28. Commit working increments as you go.
- bridge/js/min/ is generated and committed: after ANY edit to js/*.js run `node build.mjs` and commit js/min/ (tests/all.js fails when stale).
- Read the top of HANDOFF.md (rounds 13-15) and HANDOFF-r15-*.md / HANDOFF-r14-*.md in the main folder for the latest open findings in your area.
- If the Playwright helper path above is missing, use playwright-core from bridge/node_modules or install it in a scratchpad folder.
- SAVE PROGRESS CONSTANTLY (Alec may run out of usage at any moment): commit to your branch at every working
  milestone and at least every 30 minutes, and keep a "## Resume here" section at the TOP of your
  HANDOFF-r16-<name>.md (what you are doing now, what is half done, next 3 steps, key numbers so far), committed
  with each milestone. A fresh agent must be able to continue from your branch and that note alone.
