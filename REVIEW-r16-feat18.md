# Review r16-feat18 (Your mistakes: Bidding) diff vs r16-feat17 at 8022962: MERGE WITH FIXES (coordinator saved)
Tests pass (npm test with drilltest+drillbidtest, sim 0/0, drillbid.pw 21/21 each width, drills.pw ok). Selection sound, no hidden info, legal box, alerts ok, DD off main thread, no cost unused (+9.7 kB min, 2.8 kB gz), storage back-compatible.
1. LOW (merge): add ['drilltest.js'], ['drillbidtest.js'] to tests/all.js.
2. LOW: loss overstated (drills.js:426) for 21% of problems (+5.6 IMPs avg): loss = min(vs table, vs mine-with-robots).
3. LOW: one board can block main thread 74-141 ms desktop (300-500 ms phone) (drills.js:447, also drBidChoose :484): one board per step after a slow one, or move check to a worker.
4. LOW: malformed record stalls all checks (drills.js:116): try/catch per board, mark bscanned either way.
5. INFO: check never restarts after DD.failed (:440): call requestDD / ddRetry after 120 s.
6. INFO: guard bpHandHTML (:459) like bpCallHTML.
7-9. INFO: Practise these stores kind; stale robots' calls -> bump DR.BV if bidding16 merges; two DDS workers on phones.
