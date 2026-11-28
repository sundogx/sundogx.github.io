# Round 16, perf10: performance

## Resume here
- Branch r16-perf10, worktree .claude/worktrees/r16-perf10 (bridge/node_modules is an untracked symlink to the main folder's; never add it).
- Done and committed: workers import js/min copies + raw files out of CORE + esbuild pinned (2fc3ea7); 512 px icons out of CORE (63a40a3).
  First visit 487.3 kB -> 330.8 kB on the wire.
- In progress (uncommitted in js/app.js): patchHTML nested parts (htmlPart/partsOf; seat -> plate/hand, face-up hand -> one part per suit)
  plus cssPx memo per task (renderHand's --cw read forced a full restyle after a nested patch). DOM identical on 298 states.
  Timing so far: head 2.78 vs branch 2.71 ms/render (4x CPU) = not yet a clear win. Revert if alternating runs stay flat.
- Next: renderAuctionPane (trick box only per trick), feltGeom forced layout, write numbers below.
- Harness: scratchpad /private/tmp/claude-501/-Users-admin/c95d256f-4c77-4778-9fcf-01deefc13883/scratchpad/perf10/
  (load.js bytes/first/repeat/offline; early.js slow-link first visit + early Practice; rbench.js <root> time|dom|bench|prof; cmp.js).
