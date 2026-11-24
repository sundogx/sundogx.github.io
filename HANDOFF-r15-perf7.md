# Round 15, perf7: render() without forced layouts

Branch `r15-perf7` (from main 1056dbe). Only bridge/js/app.js changed (fitTrick, renderHand's width, renderFelt's
auction-grid scroll). Scripts in scratchpad
`/private/tmp/claude-501/-Users-admin-Documents/f1461e61-4b45-4a17-ba73-8fe0b25e9390/scratchpad/perf7/`:
- `rbench.js <bridgeRoot> bench|prof|dom|resize [boards] [throttle] [out.json]`: Chrome (playwright-core,
  channel chrome), 390x844 phone (VW/VH env to change), serves the folder by request interception. Plays N seeded
  practice boards in the page (S by botCall/botPlay, others A.robotStep, claims accepted), keeping every state;
  boards rotate plain / "Show all hands" / "Show tricks per card" (fake Learn.res badges, so Learn.decorate runs).
  Robots are held off (robotTimer) while replaying. `bench`: 4x CPU, each state through render() with a frame
  between, CDP trace: render() ms, Layout/UpdateLayoutTree ms and counts per render (REPS env repeats).
  `prof`: CPU profile of everything under render(). `dom`: outerHTML of #felt #myHand #bidArea #playInfo #side
  #topBar (+ the felt auction grid's scrollTop) after every state, screenshot md5 every 7th state.
  `resize`: a state, then a viewport change (5 sizes in turn), snapshot after two frames.
- `cmp.js a.json b.json`: state-by-state DOM / screenshot comparison. `main/`: git archive of main (the "before").

## Where the time went (main, profile of 3x199 renders at 4x)
Samples under render(): renderFelt 70%; fitTrick 27% (all of it the forced style+layout after the felt patch);
patchHTML 19% (HTML parsing + replaceWith: inherent); renderFelt self 10% (mostly `.agrid` scrollHeight, a forced
layout in the auction); renderHand 10% (self ~6%: `#myHand.clientWidth`, forced layout after fitTrick's --tk);
feltGeom 5%; seatBlock string building ~3% (colsHTML <1%); Learn.decorate ~1.3%. So the JS string building is
small; the forced layouts were the cost.

## Changes
1. dd07e6c fitTrick / renderHand: sizes from ResizeObservers. The middle of the table (.pos-center) is observed when a
   new one appears; its size and the trick's --tw/--th/--tg are kept, so fitTrick sets --tk from the kept numbers with
   no layout. The observer's first call for the new element (after the browser's layout, before paint) refits if the
   size differs. `#myHand` is observed once; renderHand uses the kept width, and the observer redraws the hand if the
   width changes from the one used. Before the first observation both fall back to the old live reads.
2. f57f869 renderFelt: a new `.agrid` on the felt is observed and scrolled to its bottom in the observer's first call
   (before paint) instead of reading scrollHeight at once. When the grid element is unchanged (a render that didn't
   redraw the middle) it still scrolls at once, as before.

## Measurements (phone 390x844, 4x CPU, 199 states of 4 boards; machine shared with other agents, so alternating runs)
| run | render() ms | layout ms | style ms | layouts / render | style recalcs / render |
|---|---|---|---|---|---|
| main (4 runs) | 3.5 / 4.5 / 5.5 / 6.1 | 1.23-2.13 | 0.74-1.15 | 1.874 | 2.538 |
| after change 1 (2 runs) | 3.77 / 3.90 | 1.73-1.91 | 0.95-0.98 | 1.372 | 1.377 |
| after 1 vs 1+2, 597 renders alternating | 3.53, 3.48 -> 2.85, 3.16 | 1.63, 1.59 -> 1.46, 1.58 | | 1.372 -> 1.126 | 1.377 -> 1.131 |
| branch (final, alternating with main's 3.5 / 4.5 runs) | 2.32 / 2.41 | 1.21-1.22 | 0.65-0.68 | 1.126 | 1.131 |

render() -34% to -47% against main in the same back-to-back runs; forced layouts per render 0.87 -> 0.13, style
recalcs 2.54 -> 1.13.

Identical: DOM (with the auction grid's scrollTop) equal to main on all 297 states (6 boards) at 390x844, 297 at
844x390, 242 at 1280x800, and 99 resize steps across 5 viewports. Screenshot md5s differ in 2-11 of the sampled
states between any two runs, main against main too (same indices recur); a desktop rerun of main vs branch with the
PNGs saved gave 0 differences. Checks: build + npm test pass (tests/workerbuild.js needs node_modules; the worktree
has none, so I ran it with a temporary symlink to the main folder's), sim.js 3000 games errors 0, long 0.

## Tried, not shipped
- Caching cssPx (--cw/--ch, keyed on phoneInfo.matches) and using it in renderHand: style recalc count unchanged
  (1.377 both), times within noise. Reverted.

## Open
- feltGeom (js/app.js renderFelt -> seatBlock) still forces a layout when something earlier in render() (renderTop,
  renderOnline, the `bidding` class) changed the page: ~0.13 layouts per render now. A ResizeObserver cache on #felt
  would need a redraw of the felt when its size changes (bidding class toggles every board) and care that the felt's
  size doesn't depend on the seats' content (a loop).
- patchHTML (HTML parsing + replaceWith) is now the largest JS item (~25% of render()); a seat's plate and hand are
  one part, so a card played rebuilds that seat's whole hand. Splitting parts finer would cut it, at some risk.
- renderAuctionPane rebuilds the side auction grid every trick (aSig includes the completed-trick count, for the
  trick box in pinfoHTML); only the trick box changes.
