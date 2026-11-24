# Common rules for round-8 feature agents (local file, not in git)

- Repo: your worktree (copy of /Users/admin/Documents/sundogx.github.io); code in bridge/. Read bridge/README.md and /Users/admin/Documents/sundogx.github.io/HANDOFF.md first ("Owner's UI choices": keep them; minimal look, red ♥/♦ everywhere, no flashing/pulsing, thin outlines, no redundant labels, no copyrighted art or quiz text).
- Put your code in a new `bridge/js/<feature>.js`, loaded like skip.js/showpoints.js, with small, clearly marked hooks in app.js / index.html / style.css (other agents edit those too: keep hooks small to ease merges). Add new files to `CORE` in sw.js but do NOT bump CACHE (the merger does).
- Do not touch bridge/ben/, js/bidding.js, js/bots.js `botPlay`, js/ddplay.js, js/leads.js (other agents own them) except for read-only use of their exported functions.
- Practice-only unless stated; don't change server behaviour (src/worker.js, js/table.js) unless your task says so.
- Before each commit: `cd bridge && node build.mjs && npm test` passes and `node tests/sim.js | head -1` shows "errors":0. Check your UI in a real browser with Playwright (playwright-core, `channel: 'chrome'`; serve bridge/ with e.g. `npx http-server` or python http.server), on desktop and a phone-size viewport; look at screenshots.
- Add a short README section for the feature.
- Never push, never merge to main, never deploy. Commit on your branch; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't commit .claude/.
- Write HANDOFF-feat-<name>.md at the worktree root (what works, how tested, known gaps) and commit it.
- Final message: what you built, how tested, branch name, last commit hash.
