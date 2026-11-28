# Review r16-feat17 (Your mistakes) at 00fee70: MERGE WITH FIXES (coordinator saved)
Tests pass (npm test + drilltest, sim 0/0, Playwright 25/25 each width). Hidden hands not leaked; positions match engine; storage safe; unused cost +18 kB (7 kB gz), no worker at load.
1. MEDIUM: Hand record -> Play from here (any openTable while drills open) leaves #drills visible over the table; scan timer, worker and board scan keep running; Escape then draws home over a live table (drills.js:354; app.js:1531 showTableView). Fix: in showTableView add `if (typeof DR !== 'undefined' && DR.on) leaveDrills(false);` or drills.js-only guard in drStep/keydown.
2. LOW: add ['drilltest.js'] to tests/all.js at merge.
3. LOW: focus drops to body on open and after Next/N: call drFocus() after drNext() (drills.js:189, 351-352, 365).
4. LOW: drills DDS worker never idles out (130-147): DD_IDLE_MS timer when DR.wait empty.
5. LOW: blob URL never revoked (143).
6. INFO: Play on from here returns to History record, not Your mistakes.
7-8. INFO: cost small; README History note drift; first problem ~0.83 s not 0.4 s.
