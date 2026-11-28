**Round 17 (started 2026-11-28 13:10 HKT, Opus; rules in HANDOFF-r17-common.md, deadline 14:45, merge by ~15:05):** bidding17 (notrump slam auctions, quantitative 4NT in 2/1 GF, judgeX low-HCP NT doubles measured with card play; bidding.js), play17 (server endLimits0 with new double readings, shown() penalty-double trump reading in leads/bots, declarer heuristics; bots.js/leads.js/ddplay.js), perf11 (drills bidding check in a worker, style.css minify; drills.js check part, build.mjs, index.html css link, sw.js CORE), feat19 (one more researched feature; new js file + small hooks).

**Round 16 deployed (2026-11-28 ~13:00 HKT, main 3189eaf, cache v72, Worker 92192e7d):** merged perf10, stab3, feat16 (Deal setup), feat18 (incl. feat17: Your mistakes, play + bidding problems), bidding16 (after review fix pass: +0.0166 ± 0.0018 IMPs/board on 100k, bidhuman +6 on fresh rv16a-e). Follow-ups in merge: ben-worker loads js/min, worker error preventDefault (stab3 patch), DR.BV=2, drilltest/drillbidtest in npm test. Live: online.test passes. play16 merged after review fixes (cache v73): botLead NT +0.027 DD/+0.021 played (reviewer), doubled boards decl +0.024, def +0.016 per decision on fresh p16xd (xpen only). Reviews: REVIEW-r16-*.md.

**Round 16 (started 2026-11-28 10:05 HKT, Opus; rules in HANDOFF-r16-common.md):** five agents in .claude/worktrees/r16-<name>: bidding16 (missed slams: 18+ routes after 4NT invites at bidding.js ~687/742/752, contested-auction leaks; bidding.js), play16 (robot card play: LEAD_W refit for botLead, leads vs doubled contracts, declarer/defence heuristics; leads.js, bots.js botPlay, ddplay.js), perf10 (workers import js/min copies, pin esbuild, duplicate wasm download, patchHTML finer parts, renderAuctionPane; build.mjs, sw.js CORE (not CACHE), dds-worker.js, analysis.js, learn.js, app.js render parts), feat16 (one or two features common on BBO/IntoBridge/RealBridge that are missing, researched online; new js file + minimal hooks in index.html/ux.js), stab3 (UI/online stability open findings: layout shifts, api() fetch timeout, offline worker without SW, T.history trim; table.js, ux.js, worker.js, style.css). Independent review before merge; deadline 14:15 HKT, merge/deploy by ~15:00. Status: feat16 DONE 10:20 (Deal setup, branch r16-feat16; review MERGE WITH FIXES, all 7 fixed at 9d38a8d; READY TO MERGE, needs CACHE bump); feat17 DONE 10:31 ('Your mistakes': problems from your own costly cards with spaced repetition, branch r16-feat17; review MERGE WITH FIXES, fixed at 87297df incl. app.js showTableView hook; READY TO MERGE; add drilltest.js to tests/all.js at merge); feat18 DONE 10:57 (Bidding kind in Your mistakes + 'Practise these' links, branch r16-feat18 on r16-feat17; review fixes at 7d5cc78; READY TO MERGE (supersedes feat17 branch); add drilltest.js + drillbidtest.js to tests/all.js; bump DR.BV if bidding16 merges). perf10 DONE (workers load js/min, esbuild pinned, 512px icons out of CORE: first visit 487->331 kB, solver ready ~0.9 s sooner on slow first visit; render items measured flat, not shipped; 84764b3; review MERGE; READY (at merge: ben-worker.js:13 -> ../js/min/*, bump CACHE))..

**Round 15 complete (2026-11-20 ~13:25, main 54be252, cache v71, Worker 8ffaf227):** merged + deployed after independent reviews: perf7 (ResizeObservers replace forced layouts in fitTrick/renderHand/auction scroll; reviewer: real gain is fewer layouts/style recalcs, whole-task time too noisy to show ~35%), perf8 (**bridge/js/min/ is generated and committed: after ANY edit to js/*.js run `node build.mjs` and commit js/min/; tests/all.js now fails when stale; page loads js/min/*, sw.js CORE lists js/min + raw worker-imported files**), perf9 (claim answer computed ahead in DD worker, key-tested with wrong planted answers; workers close after 60 s idle), stab1 (flashcards Reset try/catch; tests/soak.pw.mjs, stab.pw.mjs), stab2 (leftSocket frees robot card request, complain() 1/s, oversized-message reply, 429 message with retryAfter; online-stab, online-restart tests), plus page fix: createBtn toast shows the server's 429 message. Open: workers could import js/min copies (~90 kB less first visit; dds-worker.js:15, analysis.js:161, learn.js:91); pin esbuild in devDependencies (build.mjs falls back to unminified copies without it); wasm downloaded twice if Practice pressed before the SW install finishes; home screen CLS 0.075 after reload (stab1, unexplained); offline dds-worker throws without SW cache; T.history untrimmed in memory (table.js:73); human claims' robot answer still on main thread; lead workers closed after 60 s idle during tricks 1-2 (slower early decisions); allowCreate return type changed (deploy during traffic lull); online-stab limit test flakes if run within an hour of another (random address); README needs js/min and new tests; feltGeom still forces layout in ~13% of renders; patchHTML ~25% of render().

**Round 15 (started 2026-11-20 ~12:00 ET, Opus medium, deadline 13:15; rules in HANDOFF-r15-common.md):** performance and UI stability, five agents in .claude/worktrees/r15-<name>: perf7 (render path in app.js: seatBlock/colsHTML, Learn.decorate, forced layouts), perf8 (startup, load time, service worker precache, bundle size, worker spin-up), perf9 (solver/robots: claimAnswer off main thread, DD worker scheduling, memory), stab1 (UI stability: Playwright soak tests on phone/desktop, console errors, leaks), stab2 (online stability: reconnects, sleeping tabs, duplicate tabs, worker.js). Each gets an independent review before merge.

**Round 14 (2026-11-20 ~09:40, main 1056dbe, cache v70, Worker bb426920):** merged + deployed: perf6 (claim count in DD worker, identical decisions, -85% main thread), ux3 (no empty Chat tab, 'Sound: off', daily Leave on phones, styled Options selects, whole <main> inert under dialogs), leads10 (vul in lead reading, identical today; 2C..3NT keeps shown minimum, 22/30k boards), bidding14 (six5: 6NT after transfer with 18-19; lrk: 4C maximum-ask over 1M-3M; held out +156/58,500, humans flat). Live online.test hung at client connect after deploy (local passes): per-address 20 tables/hour limit after many runs. Open: other 4NT invites at bidding.js:687/:742/:752 lack an 18+ route; claimAnswer (up to ~28 ms at 4x) still on main thread; Leave only inside More for robot practice at 390.

**Round 13 status (2026-11-20 ~09:00, main 5c31e49, cache v68; CSS only, no Worker deploy needed):** merged ux2 (hover only on mouse screens, Leave at right on phone practice screens, lead-practice select styled) + basebid14 fixture. Nothing else shipped (all measured flat under a 50-minute cap; notes in .claude/worktrees/r13-*/HANDOFF-r13-*.md): bidding13 (slam losses mapped; lrk +0.003/board robots but -0.015 with humans; lrc flat; patch tests/fixtures/r13-lrk-lrc.diff on the branch), heur12 (DD_LIMX in bots.js endgame flat on 20k boards; patch in scratchpad h12/limx.patch), ddlim2 (DD_LIMX for leads flat; 2C-2D-3NT bug confirmed but ~1 decision/1300 boards; knobs + tests/ddacc-lim.js on branch r13-ddlim2; leads.js:101 leadShown ignores vul), perf5 (claim-search reordering -2.8% nodes, fitTrick change within noise; levers: run robotClaimCount in DD worker, profile seatBlock/colsHTML). ux2 open findings: Sound off label, empty Chat tab, daily deals back path, Options menus unstyled, setBackgroundInert.

**Round 13 (started 2026-11-20 ~08:30 ET by session documents-48, Opus medium; rules in HANDOFF-r13-common.md):** worktrees `.claude/worktrees/r13-<name>`: bidding13 (missed slams; bidding.js), heur12 (botPlay incl. endgame DD_LIMX; bots.js), ddlim2 (DD_LIMX in leads.js, 2C-2D-3NT limit bug, 2C minimum 22; ddplay.js/leads.js), perf5 (rendering fitTrick/renderFelt, robotClaim search; app.js render parts, table.js), ux2 (UI/UX polish; style.css/index.html/js/ux.js). Each gets an independent review before merge.

## Round 10 status (2026-11-20, deployed 6ae5023, cache v60)
- Merged + deployed: bidding11 (r3g, xown; +0.006 IMPs/board held out), heur9 (endgame search <=7 cards, server END_NODES 5000, page 30000; +0.45 IMPs/board), perf2 (bidding 2x faster, botPlay -25%, parallel npm test, simcache), online4 (robot-stall/review fixes + Worker build fix).
- New: tests/workerbuild.js in npm test (bundles src/worker.js; heur9 had broken it with a comment swallowing a catch).
- ddplay8 (r10): NEGATIVE, nothing shipped (auction-miss layout weighting, lead prior by auction type, most-often-best tie-break all flat on held-out). Candidate: LEAD_W refit for botLead (+0.037 ± 0.025 pooled held-out; notrump +0.1) — note in .claude/worktrees/r10-ddplay8/HANDOFF-r10-ddplay8.md. Doubled contracts lose 1.0-1.6 IMPs/board on the lead (shown() for judgement doubles).
- heur10 (r11) merged + deployed 0eeed25, cache v61: eauc/ett + ~30% faster botPlay (held out ~+0.05 decl, ~+0.10 def).
- leads9 (r11): LEAD_W refit NEGATIVE on 7,930 fresh boards (+0.011 ± 0.019; NT +0.040 ± 0.048). Not shipped. Note: dd8 lgen.js '+P0||192' bug made 0 layouts mean 192.
- bidding12 (r11) merged + deployed edf4706, cache v62: 4NT quantitative-after-transfer fix, lebb, rxr (+37 IMPs / 6,000 fresh). Dropped q5, ocj, txl, lrs (no fresh gain / human risk).
- perf3 (r11) merged + deployed 5733fed, cache v63: DDS table export (hand record 2.3x faster), endLimits0 -> ddAuctionLimits(keep2C). Open: ddplay sets 2C minimum to 22 (bots use max(min,22)) — maybe a bug. Lead workers kept alive: not worth it.
- r12-doubles: NEGATIVE for bidding. Doubled-contract loss is mostly doubled scoring; robot doubles gain +2.1-2.6 IMPs/doubled board; lead/defence not worse. Dropped pxgm, pxpt, xpsh (patch scratchpad r12/knobs.diff). Open lever: defTricks estimate (error ~1.4 tricks). Tooling merged (basebid13, ddacc AOFF=).
- deftricks (r12) merged + deployed, cache v64: defFit in judgeX (BID_OFF dtfit). Watch NT refit (15 coeffs, some sign flips). bidoverbid/bidhuman crash ENOENT unless bidddsim built the seed's DD cache first.
- heur11 (r12) deployed cache v65: only evs (exact). Deeper page search (9 cards/150k) NOT shipped: real page pipeline (DD sampler + prefer) gain is noise (+0.016/+0.034, 2% boards changed) vs 25-40 ms main-thread per card. Harness: scratchpad/r12h11/pp.js. bidoverbid/bidhuman ENOENT fixed (tests/fixtures/ddcache.js).
- ddlim (r12) deployed cache v66: DD_LIMX 3 limit fixes in ddplay sampler only (leads.js and bots.js endgame not yet). Not shipped: 2C min 18 (mixed); bug 2C-2D-3NT min overrides higher shown min (rare). Note/tool: .claude/worktrees/r12-ddlim (HANDOFF, tests/ddacc-lim.js uncommitted).
- perf4 (r12) deployed 208a61b, cache v67: prefer computed in DD worker (main-thread 2.2 -> 0.24 ms/decision, 4x throttle). Left: rendering (fitTrick forced layout, renderFelt), robotClaim claim search every robot step (~1.4 ms).
- Next ideas: missed slams remain the biggest bidding loss; 2C-2D-3NT limit bug; DD_LIMX for leads.js and bots.js endgame; NT defFit coefficient sanity.
- Running: none. bidding12 (r11: slams, contested leaks), heur10 (r11: botPlay speed, auction-weighted endgame layouts).
- Open ideas: DDS CalcDDtablePBN export (2.2x faster tables), reuse lead workers, xown rebid description 17-bal.

**Round 9 complete (2026-11-20 ~02:25 ET, main f81b782, CACHE v59, Worker c1576040):** online3 merged after its fix pass (robot stall fixed), deployed, live online.test passes. online-net needs `--var TEST_TIME_SCALE:0.0167 --var TEST_STALE_MS:3000` on wrangler dev (without them one check fails).

**Round 10 (started 2026-11-20, Opus medium, ~150 min each; rules in HANDOFF-r10-common.md; owner asked for 8 hours of bidding/card-play/performance work):** worktrees `.claude/worktrees/r10-<name>`, branches `r10-<name>`, notes `HANDOFF-r10-<name>.md`: online4 (fix the r9-online3 robot stall, worker.js/online tests), bidding11 (bidding.js), heur9 (botPlay), ddplay8 (ddplay/leads/dds-worker), perf2 (speed of robot decisions and test harnesses, no decision changes). Then independent review + one fix pass each, merge (squash, `git rm --cached` notes), bump CACHE, test, push, deploy; then a second wave.

**Round 9 status (2026-11-20, main 56bd996, CACHE v58, Worker 01982221):** merged, pushed and deployed: bidding10, heur8, uistab, ux. ddplay7 shipped nothing (no rule beat the current one; note only). **online3 NOT merged:** its reviewer found a high-severity stall (robots stop moving when a seated person's connection goes silent while a robot move is waiting: alarm() in src/worker.js ~884-887 checks dropStale()/unmarkedAway()/hostDue before the robot step). The fix pass hit the usage limit; resume it with Workflow({scriptPath: '/Users/admin/.claude/projects/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/workflows/scripts/bridge-round9-wf_2412c697-8ec.js', resumeFromRunId: 'wf_2412c697-8ec'}) or fix by hand on branch r9-online3, then rerun online tests. Next-round idea from the bidding review: narrow the xlong rule (void the double's support only after 2-level or jump rebids) to recover a small bidoverbid loss.

**Round 9 (started 2026-11-20, Opus medium, ~90 min each; rules in HANDOFF-r9-common.md):** worktrees `.claude/worktrees/r9-<name>`, branches `r9-<name>`, notes `HANDOFF-r9-<name>.md`: bidding10 (bidding.js), heur8 (botPlay), ddplay7 (ddplay/leads/dds-worker), uistab (app.js/net.js/table.js client), ux (style.css/index.html/js/ux.js), online3 (worker.js/online tests). Each gets an independent review and one fix pass (workflow wf_2412c697-8ec). Then merge (squash, `git rm --cached` the notes), bump CACHE, test, push, deploy.

**IMPORTANT (2026-11-20): every deploy must bump `CACHE` in bridge/sw.js.** The service worker no longer refreshes files in the background; without a new CACHE name a change never reaches anyone. Pages reload themselves at a safe moment (home, between online boards, Next on a finished practice board). Daily leaderboard results are now replayed and scored on the server (main CACHE v55, Worker 51e686b6).

**Round 8 progress (2026-11-20):** all 16 round-8 branches merged, pushed and deployed (main CACHE v53, Worker d544b18f; perf audit needed no Worker change). Bidding9's lott22 was left out (worse partnering humans). Owner UI changes today: no hover highlight on phones, no winner outline, trick stays 1.7 s. Live online.test can fail with 'too many tables' after several runs in an hour (20 tables/hour per address): not a bug. Open audit items: daily leaderboard results unchecked (server audit note), service worker mixes versions in a tab left open across an update (UI audit note; owner to choose a fix), par ignores dealer on rare tables (core audit note). Merge helpers: scratchpad lineunion.py (check script tags after), keepboth.py, smoke/smoke.js.

**Round 8 (started 2026-11-19 23:05 UTC, Opus medium, ~110 min each, owner asked for 2+ hours):** a web-research agent (features other bridge sites have), plus `HANDOFF-bidding9.md` (bidding.js), `HANDOFF-heur7.md` (botPlay), `HANDOFF-ddplay6.md` (ddplay/leads). Feature agents (rules in HANDOFF-feat-common.md): `HANDOFF-feat-leadtrainer.md` (opening-lead trainer), `-playfrom.md` (play from here in replays; just declare/defend), `-learn.md` (show all hands, DD tricks per card, robot strength levels), `-history.md` (flags, notes, bulk PBN, leak finder, chat suit symbols), `-explorer.md` (bidding explorer, flashcards), `-mini.md` (MiniBridge, rubber/Chicago scoring). Research report's other ideas, not started: head-to-head challenge links, video/audio chat, rating ladder, bidding by simulation, auction-likelihood weighting of layouts. None touch bridge/ben/ (BEN work by the owner/Devin continues on main).

**Status 2026-11-19 (main 890a1f0, CACHE v46, Worker deployed):** rounds 6-7, the 8 feature agents (deals, stats, daily, share, bidpractice, card, notify, perf), 10 quick agents (played cards, suit order, auto-play, show points, skip deal, phone fixes, a11y, interplay bugs, scoring tests, daily security) and a 10-agent audit are all merged, pushed and deployed. The BEN option is merged but hidden (`READY=false` in js/benbridge.js; `?ben=1` shows it); BEN phase 1 (models, PORTING.md, vectors) is committed on branch worktree-agent-ab5dbbaf911e13f0f, NOT merged (34 MB of models + 15 MB ort): merge it together with phase 2 (porting bidding, lead, play into ben/ben-worker.js). Owner says Devin is doing phase 2 (2026-11-19): do not start BEN porting agents here. Merge helper scripts: scratchpad mergefeat.sh / keepboth.py (keep-both conflict resolution can duplicate lines: check index.html home row). The owner gave standing permission for Worker deploys.

# Handoff: bridge site work in progress

**Status 2026-11-18 evening:** everything in the tables further down is finished and deployed (main 62af5b4, CACHE v29).

**Feature round (8 agents, 28 min each, started 2026-11-19):** notes `HANDOFF-feat-<name>.md` for perf (performance; may edit sw.js), share (share links, LIN/PBN import), deals (practice deal types), stats (history and statistics), card (robots' system card), bidpractice (bidding-only practice), daily (daily deals + Worker leaderboard; owns src/worker.js), notify (your-turn cues, sounds, away). Each puts code in a new `js/<feature>.js` with small marked hooks in app.js/index.html/style.css: expect small merge conflicts; add new files to sw.js CORE when merging.

**Round 7 (30-min agents, started 2026-11-19, Opus medium):** `HANDOFF-bidding8.md` (why-text for penalty doubles, closer meaning of judgement doubles, fixture-knob harness fix), `HANDOFF-heur6.md` (declarer loser-count features and refit), `HANDOFF-ddplay5.md` (K/pool, play-reading weights, penBase on odd auctions, penalty double read as trump length). Local main has the unpushed BEN integration commit e19c229: when pushing these, either push it too (option works but uses a stub) or wait for the BEN port.

**BEN option (started 2026-11-18, owner approved):** an opt-in "Use BEN robots" option in practice Options that loads all of BEN (bidding, leads, card play) in the browser via onnxruntime-web. Owner's decisions: BEN-derived code and models live only in `bridge/ben/` under a separate GPL-3.0 notice (rest of the site stays unlicensed); offered everywhere, off by default, warns about the download size, models cached with the Cache API.
- Phase 1 (parallel): `HANDOFF-ben1.md` = clone BEN, convert models to ONNX in `bridge/ben/models/` + manifest, vendor ort, `bridge/ben/PORTING.md` spec, test vectors in `bridge/ben/tests/vectors/`. `HANDOFF-benui.md` = toggle, download/progress/cache, `js/benbridge.js`, stub `bridge/ben/ben-worker.js`, `bridge/ben/INTERFACE.md` (message protocol: init/progress/ready, bid, lead, play), fallback to normal robots.
- `HANDOFF-benui.md` DONE: merged into local main e19c229, NOT pushed (don't push until the real BEN port works, or the option would download nothing useful).
- Phase 2 (after phase 1): three agents port BEN's bidding, lead and card-play logic into `bridge/ben/` (inside ben-worker.js), each checked against the vectors.

**Round 6 in progress (started 2026-11-18 after main a5bbe8a; agents run on Opus, medium effort, ~100 min each). Agents commit their HANDOFF-*.md: merge with `git merge --squash` and `git rm --cached` the note, so notes never reach the public repo:**

| Handoff note | Task | Files it owns |
|---|---|---|
| `HANDOFF-bidding6.md` | **DONE, pushed (main 14aea9f, CACHE v42).** Bidding round 6: penalty doubles of humans' overbids (owner's complaint), sitting for partner's double, harness `tests/bidoverbid.js` | `js/bidding.js` |
| `HANDOFF-ddplay3.md` | **DONE, pushed (main cd2bd54, CACHE v40).** Solver play round 3: doubled-contract scoring and leads, robustness to odd human auctions, defence | `js/ddplay.js`, `js/leads.js`, `js/dds-worker.js`, analysis.js solver |
| `HANDOFF-heur4.md` | **DONE, pushed (main da98301, CACHE v39).** Heuristic play round 4: defending doubled contracts, signals, declarer planning | `js/bots.js` (`botPlay`) |
| `HANDOFF-ui3.md` | **DONE, deployed (main 2eceb74, CACHE v38).** UI round 3: browser walk-through on desktop/phone, fixes, X/XX display | `js/app.js`, `style.css`, `index.html`, `js/net.js` |
| `HANDOFF-online2.md` | **DONE, pushed (main f0631b9); Worker deployed ea92b551.** Online round 2: races, reconnects, session scoring, lifecycle | `src/worker.js`, `js/table.js`, `build.mjs`, online tests |
| `HANDOFF-ui4.md` | **DONE, pushed (CACHE v41).** UI round 4: host seat swap/rotate, Add robot, stand-in marker, per-person totals, round-3 leftovers, seated online play in a browser | `js/app.js`, `style.css`, `index.html`, `js/net.js` |
| `HANDOFF-heur5.md` | **DONE, no play change (nothing measured positive); test tools pushed.** Heuristic play round 5: declarer trump timing, signals and encouraging discards, switches | `js/bots.js` (`botPlay`) |
| `HANDOFF-ddplay4.md` | **DONE, no play change (doubled-score leads neutral); tools pushed.** Solver play round 4: replicate odd-auction gain, tune sampling with ddacc, leads vs doubled contracts, phone speed | `js/ddplay.js`, `js/leads.js`, analysis.js solver |
| `HANDOFF-ui5.md` | **DONE, pushed (CACHE v43).** UI round 5: practice-mode polish (flow, review, explaining doubles, session summary) | `js/app.js`, `style.css`, `index.html`, `js/net.js` |
| `HANDOFF-bidding7.md` | **DONE, no bidding change (both ideas measured flat or negative); tools pushed.** Bidding round 7: contract-fits-what-they-showed feature, closer meaning of judgement doubles, 4-level card-showing doubles | `js/bidding.js` |

**Round 4 in progress:** four agents, each in its own worktree. Find each one with `git worktree list` and match it by the handoff note at its root:

| Handoff note | Task | Files it owns |
|---|---|---|
| `HANDOFF-bidding4.md` | **DONE, deployed (main 24c9e08, CACHE v31).** Bidding round 4: slams, 1NT auctions, competition | `js/bidding.js` |
| `HANDOFF-ddplay2.md` | Solver card play round 2: sampling from the auction's full meanings, K versus speed, scoring, defence, leads | `js/ddplay.js`, `js/leads.js`, `js/analysis.js`, `js/dds-worker.js` |
| `HANDOFF-heur2.md` | **DONE, deployed (main 24c9e08, CACHE v31).** Heuristic play round 2: declarer's third-hand play, defenders' switches, suit-contract declarer leads | `js/bots.js` (`botPlay` part) |
| `HANDOFF-claims.md` | **DONE, deployed (main 24c9e08, CACHE v31).** Claims: an exact pure-JS claim solver, robots claim when the rest is clear | `js/bots.js` (`sureTricks`/`exactTricks`), table.js claim actions, worker.js `robotClaim` |

**Round 5 in progress (started after main 24c9e08):**

| Handoff note | Task | Files it owns |
|---|---|---|
| `HANDOFF-ui2.md` | **DONE, deployed (main b46b45d, CACHE v32).** UI and functionality: an optional Hint, per-card review in hand records, results, flow | `js/app.js`, `style.css`, `index.html`, `js/net.js`, analysis.js (the hand-record UI only) |
| `HANDOFF-online.md` | **DONE, deployed (main 1004494).** Online: end-to-end testing, robustness, small features | `src/worker.js`, `js/table.js` (not the claim code), `build.mjs`, `tests/online.test.mjs` |
| `HANDOFF-bidding5.md` | **DONE, deployed (main 1004494).** Bidding round 5: robustness with human partners, explaining humans' calls, remaining losses | `js/bidding.js` |
| `HANDOFF-heur3.md` | **DONE, deployed (main 1004494).** Heuristic play round 3 | `js/bots.js` (`botPlay` part) |

The solver card-play agent from round 4 (`HANDOFF-ddplay2.md`) is still running.

The heuristic and claims agents both edit `js/bots.js`, but different functions, so expect an easy merge. Merge, test and deploy each one as described below.

For a Claude Code session (any account) picking this up. This file is not committed: it stays local, since everything in the repo is published on GitHub Pages.

## How to resume

1. Open Claude Code in `/Users/admin/Documents/sundogx.github.io` and try `/resume`: the original conversation and its background agents may still be listed. If they are, send the agents a message to continue.
2. If not, use this file. All work is saved on disk: finished work is on `main` (pushed), and work in progress sits in git worktrees under `.claude/worktrees/` (uncommitted changes there are kept until the worktree is removed).

The owner has approved pushing to GitHub and deploying the Cloudflare Worker once the merged work passes the tests.

## State at handoff (main = 666575c, pushed and deployed)

Done and live: 2/1 GF robot bidding (js/bidding.js), double-dummy-sampling card play (js/ddplay.js) and opening leads (js/leads.js), friends/strangers mode, ACBL alerts, and many UI changes (see `git log`).

Three agents were working in parallel when this was written. Each owns separate files, so their branches should merge cleanly:

| Worktree (under `.claude/worktrees/`) | Branch | Task | Files it owns |
|---|---|---|---|
| `agent-a0a67cb3feb3e5749` | `worktree-agent-a0a67cb3feb3e5749` | Server security and robustness: **DONE, merged and deployed** (main c0d8685, CACHE v24) | `src/worker.js`, `js/table.js` |
| `agent-a518fafa9ea82813e` | `worktree-agent-a518fafa9ea82813e` | Solver and robot speed: **DONE, merged and deployed** (main 774361c) | `js/analysis.js`, `js/dds-worker.js`, `js/ddplay.js`, `js/leads.js`, `js/wasm/`, solver tests |
| `agent-ae935c428fca3e649` | `worktree-agent-ae935c428fca3e649` | UI, layout and small fixes: **DONE, merged and deployed** | `js/app.js`, `js/net.js`, `style.css`, `index.html`, `sw.js`, README UI lines |

Added later in the session. Each worktree's directory name is `agent-<id>`; find it with `git worktree list`, matched by its handoff note:

| Handoff note at the worktree root | Task | Files it owns |
|---|---|---|
| `HANDOFF-explain.md` | **DONE, merged and deployed.** Every robot call explained on tap: red outline = ACBL alert, gold (`var(--brass)`) = other explanations. Adds `describeCall()` to bidding.js. | `js/bidding.js` (new function only), `js/app.js` (auction rendering) |
| `HANDOFF-bidding.md` | **DONE, merged and deployed** (main 62af5b4, CACHE v29). Bidding round 3 (biggest remaining losses, measured with bidddsim) | `js/bidding.js` situation tables |
| `HANDOFF-heuristic.md` | **DONE, merged and deployed** (main 65915ad, CACHE v28). Heuristic card play (`botPlay`, used at strangers tables, on the server and as the fallback) | `js/bots.js` |

The other worktrees in `.claude/worktrees/` are older, already merged, and can be ignored.

**Read the agents' own notes first:** `HANDOFF-solver.md` and `HANDOFF-ui.md`, at the root of each agent's worktree (worktree isolation stops agents writing next to this file). Each agent was asked to write down what it finished, what's partial and the next steps, and to commit its progress so far as a "WIP:" commit on its branch. Before merging a branch, check that the WIP commit's tests pass. The solver agent was told to keep fresh instances per solve unless reuse is verified, so check that its committed code doesn't reuse instances unverified.

Check each one: `git -C .claude/worktrees/<dir> log --oneline -3` (a new commit means it finished) and `git -C .claude/worktrees/<dir> status --short` (uncommitted work means it stopped partway). To finish a partial one, start a new agent or session in that worktree and give it the task list below.

### Server security and robustness
1. No undo of the opening lead after dummy is seen (unless the opponents agree). Practice undo must still work.
2. Accept a robot's 'thought' only from the socket that was asked (store its uid or a nonce).
3. Friends mode only on private tables (settings and askThink).
4. During a claim, show the claimer's cards only to the opponents, not the claimer's partner.
5. Team match: onlookers never see a board, or its result chat line, before both rooms have played it.
6. Chat and other actions must not push back a robot's alarm that is already due for the same position.
7. Cache viewFor by role, not by uid; rate-limit per socket; lower the onlooker socket cap; per-IP cap.
8. Guard `JSON.parse('null')` in webSocketMessage.
9. A stale claim count gets a clear error.

Regression scripts from the audit: `/private/tmp/claude-501/-Users-admin-Documents/ab904b8a-b1f3-4b05-a9fb-eeb76b126de2/scratchpad/audit-code/`. That folder may be cleared on reboot.

### Solver and robot speed
On a simulated phone, a robot card takes 436 ms (median) and an opening lead 2.41 s, which is the timeout.
1. Make DDS instances reusable correctly: today every solve gets a fresh instance, because reuse gave wrong numbers. Find a reset, or rebuild DDS from source (dds-bridge/dds, Apache-2.0) with emscripten. Ship it only if `node tests/ddtest.js 2000` shows 0 mismatches.
2. A lead time budget that predicts the next solve and keeps partial results.
3. Don't kill the robot worker after slow answers; compile the wasm once and share it; warm up the workers during the auction.
4. Pause hand-record analysis while a robot or lead decision is pending.
5. Fewer workers on low-core devices, and close the lead workers after the lead.

### UI, layout and small fixes
1. Table height from one CSS variable, so the bidding box stays in view on 800 px-tall laptops; scrollIntoView on your turn.
2. Phone portrait and landscape: no overlapping or off-screen hands, and Pass stays visible.
3. Trick cards and the in-table auction box must not cover dummy or the name plates.
4. A toast when your claim is rejected; the claim dialog re-reads the tricks left.
5. goHome, openTable and openOnline call closeModal().
6. Keep keyboard focus in the bidding box after each re-render.
7. Hand record on phones: long suits don't wrap into a fifth row; sticky close button.
8. Unread-chat cue on portrait phones.
9. Accessibility labels on bidding and results controls; 40 px tap targets on touch screens.
10. `.topbar .code:empty { display: none }`.
11. Practice chat shows the typed name.
12. The end-of-board panel doesn't cover the last trick.
13. README: the alert outline is red, not yellow.
14. sw.js: waitUntil fix, and stale-while-revalidate caching.

## Merge, test and deploy (after the agents finish)

```
cd /Users/admin/Documents/sundogx.github.io
git merge --no-ff <branch> -m "..."          # once per branch; resolve any conflicts
cd bridge
sed -i '' "s/const CACHE = 'bridge-v[0-9]*'/const CACHE = 'bridge-vNN'/" sw.js   # bump NN (v27 at 774361c)
node build.mjs && npm test && node tests/sim.js | head -1      # sim: "errors":0, "long":0
npx wrangler deploy --dry-run
npx wrangler dev --port 8787 &   # then:
BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs
```

- Browser checks use Playwright scripts in `/private/tmp/claude-501/-Users-admin-Documents/ab904b8a-b1f3-4b05-a9fb-eeb76b126de2/scratchpad/pw/`: `run.js` (practice robots), `human.js` (play as a human), `claim.js`, `online.js` (friends mode on the local server), `phone.js`, `alert.js`. They need `playwright-core` from `pw/node_modules`; reinstall it with `npm i playwright-core` in a scratch folder if that folder is gone. Chrome is launched with `channel: 'chrome'`.
- Then: `git push origin main` and `cd bridge && npx wrangler deploy` (wrangler is logged in as the site's Cloudflare account). After the deploy, run `BRIDGE_URL=https://bridge.sundogx.workers.dev node tests/online.test.mjs`. It can fail right after a deploy, so rerun once.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't commit `.claude/` or this file.

## Owner's UI choices (keep them)

- **Auction box:** white with single-letter W/N/E/S headers, the vulnerable side's headers red. Levels are black, ♥/♦ red and ♠/♣ black, Pass green. Every red suit symbol anywhere is red.
- **Alerts:** follow the ACBL Alert Procedure. A natural 1NT, transfers and a forcing 1NT are announced; common conventions aren't alerted. Alerts have a red outline, and a dark bubble with the explanation appears right under a tapped call.
- **Top-left board box:** four edges coloured by vulnerability, split by diagonals, a D on the dealer's edge, the board number in the middle. It was enlarged to 92 px.
- **Trick counter:** two plain overlapping white cards in the sidebar, under the auction and the contract text. No graphical contract box.
- **Name plates:** no "Your bid" label (the golden plate is the cue), no "dummy" label, no pulsing animation, no red vulnerable outline. All plates are as wide as a 13-card hand (`calc(var(--cw)*4.36)`) and 32 px tall, with larger seat letters.
- **Pace and layout (owner, 2026-11-20):** robots play a card after 0.9 s at normal speed (online 1 s); single cards are not auto-played by default; the table keeps one height in auction and play.
- **Highlights:** a thin gold outline on hovered (mouse only, not phones) or selected cards; no highlight on the trick's winner (owner, 2026-11-19). A finished trick stays up 1.7 s (server robots 1.8 s).
- **Chat:** as tall as the table on desktop, no quick-chat buttons, placeholder "Table talk", nothing shown when empty.
- **Card backs:** blue stripes. No copyrighted art such as Totoro.
- **Friends mode:** a host toggle in Table settings. Robots use the solver in a player's browser.
