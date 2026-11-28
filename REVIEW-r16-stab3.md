# Review r16-stab3 at 03b66af: MERGE WITH FIXES (coordinator saved)
Build 0 changed; npm test, sim 0/0, ui-stab api/history/offline(all) pass (offline imports fails on main too: analysis.js); stab phone/desktop ok; online, online-multi, online-adv, online-stab pass; no console errors. Shots: scratchpad/r16-review-stab3/shots/.
1. MEDIUM: desktop auction no longer fits: top bar reserved 2 rows (66 px) but --feltH still assumes 29 px (style.css:118 + new rule :388); bidding box bottom 829 at 1280x800 (was 792), 797 at 1366x768, page scrolls 29 px each South bid (app.js:682 scrollIntoView) cutting off the title. Fix: --feltH calc(var(--vh) - 417px) for >560 px (or keep top bar on one row by moving buttons into More).
2. LOW: reserved gaps on online tables (~200 px gap, settings row wraps) and onlookers; limit reservation to practice tables (.topbar:has(#ltMoreBtn:not(.hidden))).
3. LOW: AbortSignal.timeout needs Safari 16 (app.js:1482): use AbortController + setTimeout fallback.
4. LOW: raw 'bad request' (worker.js:106) could reach toast: make it a sentence.
5-8. OK: home hiding safe (fallbacks verified), history trim correct, lead score line works (18 px empty line), no other visual changes.
