# Handoff: "Use BEN robots" UI and wiring

The page side of the BEN option and a stub worker are done. Everything works end to end with the stub, which answers with the app's own robots. The BEN port replaces the stub's internals.

## Files

- `bridge/js/benbridge.js` (new, the app's own code, no BEN code): the `BenBridge` object.
  - It starts the worker lazily, sends requests with timeouts and checks the answers.
  - It falls back to the usual robots, with one toast per visit.
  - It also has the Options row and the progress bar.
- `bridge/ben/ben-worker.js` (stub): a classic worker.
  - Bids with `botCall`, leads with `botLead`, plays with `ddChoose` and DDS.
  - Has `cachedFetch` (Cache API `ben-models-v1`, with byte progress) and `loadModels`, which reads `models/manifest.json`.
  - The port replaces `loadModels`, `bid`, `lead` and `play`.
- `bridge/ben/INTERFACE.md`: the messages, the engine.js representation, the `ddView` structure, the manifest format and the caching rules.
- `bridge/js/app.js`: 3 small hunks.
  - `scheduleRobot`: asks `BenBridge.call` during the auction and applies the result with `BenBridge.applyCall`, else `A.robotStep`.
  - `auctionGridHTML`: an `a.ben` call shows only `a.explain` or `a.alert`, never `describeCall`.
  - `showOptions`: adds the row (only when `!T || T.local`) and wires it.
- `bridge/js/analysis.js`: `robotDDCard` asks `BenBridge.card` first. The old body is now `robotDDCardStd`, the fallback.
- `bridge/index.html`: the script tag. `bridge/style.css`: `.benload`, `.benbar` and `.benbox`. `bridge/README.md`: a new section, "BEN robots (option)".

## sw.js change (CACHE not bumped)

- `activate` used to delete **every** cache other than `CACHE`, which would have wiped the models on each update. It now deletes only the old `bridge-` caches.
- `fetch` ignores `/ben/models/`, so the models are neither duplicated into the app cache nor revalidated in the background. The worker caches them itself.
- `js/benbridge.js` was added to `CORE`.
- Since sw.js's bytes changed, browsers install the new service worker on their next visit even without a CACHE bump. It re-precaches into the same `bridge-v42` name. Bump CACHE with the next release as usual.

## Behaviour

- **Turning it on.** Ticking "Use BEN robots" shows the size and Download/Cancel. The size is `totalBytes`, or the sum of `files[].bytes`, from `ben/models/manifest.json`, else "about 60–100 MB". Download sets `localStorage['bridge-ben']='1'` and starts loading. A 3 px bar at the top of the page, plus a bar and "N MB of M MB" in Options, show the progress.
- **Turning it off.** Unticking removes the key and terminates the worker. The cached models stay. There is no "delete download" button; one could be added with `caches.delete('ben-models-v1')`.
- **After a reload** the worker isn't started until the first robot decision of a practice board. While it loads, the usual robots decide.
- **Timeouts:** about 4 s for a bid or a card, 5 s for a lead. A late, wrong or illegal answer means the usual robot decides that turn. A load error, a worker `onerror`, or two late answers in a row mean the state is `failed` for the visit, with one toast. Re-ticking the option retries.
- **BEN calls** are stored as `{call, by, alert?, ben: true, explain?}`. `ben` also stays in the hand record.

## Tested

Tested in Chrome (`channel: 'chrome'`, Playwright). The scripts are in `/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/benui/`: run `node sync.mjs` and then `node test.mjs`. All checks pass:

- **Toggle:** off by default; the confirm shows the size, and Cancel leaves it off; credit and links are shown; toggling off stops all requests; the option is hidden at an online table.
- **A full board with the stub:** every robot call came from BEN (no 2/1 text on them), and the lead and the cards were answered by BEN.
- **Reload:** the choice is kept, and the worker starts lazily.
- **Manifest and caching:** the size comes from the manifest; the progress bar is shown; the models are in `ben-models-v1` and not in `bridge-v42`; they are fetched from the network once, with sw.js controlling the page.
- **Fallback:** for a worker that throws on requests, one that throws at load, and one that never answers, the board finishes with the usual robots and there is exactly one toast.
- `npm test` passes.

## Notes for the porting agents and the owner

- Put large files, including onnxruntime-web's `.wasm`, under `ben/models/` and load them through `cachedFetch`. Otherwise the app's service worker caches them.
- For a module worker, put `"worker": "module"` in the manifest.
- The credit's `bridge/ben` link points at the GitHub source folder (`github.com/sundogx/sundogx.github.io/tree/main/bridge/ben`), not the Pages URL, which has no index page.
- **Not covered by BEN:** the Hint button's suggested **call** is still `botCall`; a Hint **card** does go to BEN. The Results comparison table (`simulateBoard`) still uses the usual robots.
- **Friends mode** (not done) would be easy for card play only. The server already sends a robot's `ddView` to a player's browser, which calls `robotDDSolve(view, prefer)`. That path could call `BenBridge` with `{type:'play'|'lead', …}` first, skipping the `t.local` check when the host has a "BEN robots" table setting. Bidding is done on the server (`botCall` in `src/worker.js`), so BEN calls would also need the server to delegate robot calls to the browser the same way.
- A pre-existing detail, not changed: while a finished board is still on the table, its record's auction is the same array as `T.auction`. People's calls in that record are then treated as "live" and get no system text.
