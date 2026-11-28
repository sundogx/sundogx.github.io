# Review r16-feat16 (Deal setup) at f1ab0a7: MERGE WITH FIXES (coordinator saved)
Tests pass (npm test, sim errors 0/long 0, Playwright 24/24 each width). Alerts per owner choices; global wrapping safe; PBN ok.
1. Medium: Download PBN can freeze 7-8 s (dealgen.js:200-204, :404): one total budget (~1.5 s) and stop at first miss, or disable Download when !r.hits.
2. Low: Enter on a sample-auction call does nothing (dealgen.js:442-447 stopPropagation on every key blocks app.js:1242-1250): let Enter/Space through on '#dealGen .agrid [data-alert]'.
3. Low: main-thread long tasks: open ~280 ms, each field change ~154 ms (dgEstimate :338 150 ms + dgFind 200 ms), practice board up to 300 ms (DG_PRACTICE_MS :234; others use 80). Cut estimate ~50 ms, sample ~80 ms, or chunk with setTimeout.
4. Nit: Play from here ignores the setup (playfrom.js:64-66, not this branch's file).
5. Nit: dead guard dealgen.js:417.
6. Nit: PBN file name UTC date vs Date tag local date (:407 vs :193): use local in both.
7. Nit: at 390 px Leave wraps under the title.
Merge needs CACHE bump in sw.js.
