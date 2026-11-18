# Bridge

Play bridge with friends or robots in the browser. Up to four people play from their own phones or computers.

- **The page** is the files in this folder, served by GitHub Pages at `https://sundogx.github.io/bridge/`.
- **The tables** run on a Cloudflare Worker (`src/worker.js`, configured in `wrangler.jsonc`). Each table is a Durable Object that deals, checks every bid and play, runs the robots, and sends each player only their own cards, over a WebSocket. Nothing uses Claude's artifact storage.
- `config.js` holds the Worker's address (`window.BRIDGE_API`). Practice with robots works without it.

## How the code is laid out

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page's markup and styles. |
| `js/engine.js` | Cards, the auction, legal plays, trick winners, scoring. |
| `js/bots.js` | Robot bidding, heuristic card play, and how robots answer claims. |
| `js/ddplay.js` | Robot card play by double-dummy sampling (see below). |
| `js/table.js` | The table itself: seats, the actions (bid, play, claim, undo…), who may see which hands. |
| `js/par.js` | The par contract from a double-dummy table. |
| `js/net.js` | The WebSocket connection to a table on the server (reconnects, held moves). |
| `js/analysis.js` | Runs the double-dummy solver in background workers; hand-record analysis and PBN export. |
| `js/app.js` | Everything on screen: drawing the table, bidding box, options, keyboard, lobby. |
| `js/dds-worker.js`, `js/wasm/` | The WebAssembly solver (see below); it also picks the practice robots' cards. |
| `src/worker.js` | The Cloudflare Worker: one Durable Object per table, plus the lobby. |
| `src/game.js` | **Generated** by `build.mjs` from `js/engine.js`, `js/bots.js` and `js/table.js`, so the server runs exactly the same rules and robots as the page (except the solver-driven card play, which is page-only). Don't edit it; `npm run dev` and `npm run deploy` rebuild it. |
| `sw.js` | Service worker: caches the app so practice works offline. Bump `CACHE` and keep `CORE` in step when files are added. |
| `tests/` | `npm test` (rules and robots), `node tests/ddtest.js` (solver, robot sampler), `node tests/playsim.js` (robot card play, sampling against heuristic), `BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs` (a running server). |

The page's scripts are plain scripts that share globals, loaded in the order above. Practice games run entirely in the page; online tables run on the server, which sends each person only the cards they may see.

## Deploy the server (once)

You need a free Cloudflare account (dash.cloudflare.com/sign-up) and Node.js.

    cd bridge
    npm install
    npx wrangler login
    npm run deploy

Wrangler prints an address like `https://bridge.<your-subdomain>.workers.dev`. Put it in `config.js`:

    window.BRIDGE_API = 'https://bridge.<your-subdomain>.workers.dev';

Commit and push. The Worker only accepts requests from `https://sundogx.github.io` (see `ALLOWED_ORIGINS` in `src/worker.js`).

## Run it locally

    cd bridge && npm install && npm run dev

Open http://localhost:8787 (the Worker serves this folder too, so `config.js` can stay empty).

## Limits

The free plan allows 100,000 Worker requests a day; 20 WebSocket messages count as one. A board uses about 80 messages. Tables unused for 3 days are deleted.

## Double-dummy analysis

The hand analysis runs DDS (Bo Haglund and Soren Hein, Apache-2.0) compiled to WebAssembly, from the npm package `@bridge-tools/dd` 0.2.2 (MIT). The files are in `js/wasm/` with their licence notes. `js/dds-worker.js` loads it in a Web Worker, one job per strain, and gives **every solve a fresh instance**: this build returns wrong numbers if an instance is reused or re-initialised. `js/par.js` turns a table into the par contract. `node tests/ddtest.js` checks the solver against a brute-force search on small endings.

## Robot card play

In practice games the robots choose their cards the way GIB and BEN do, by double-dummy sampling (`js/ddplay.js`). On a robot's turn the page sends a worker only what that robot may see: its own hand, dummy once it is face up (declarer sees both of its hands), the cards played so far, and the auction. The worker deals the unseen cards at random about 24 times, consistent with that: suits a player has shown out of, and the HCP ranges and suit lengths the auction showed (from `shown()` in `js/bots.js`, plus the opening-bid ranges). It solves every layout for every legal card and plays the card with the best average score for its side. The heuristic robot (`botPlay`) breaks ties, which keeps sequence leads, signals and low-from-equals. It also plays outright when there is only one sensible card, when the solver takes more than about 1.5 seconds, or if the solver fails. The solver thinks during the robot's usual pause, so play is no slower than before. For the opening lead, the solver may only replace the heuristic's lead with another suit's conventional lead card that scores 30 points better on average. Leads chosen purely by the solver measured slightly worse.

`node tests/playsim.js [boards] [K]` replays the same deals and auctions with one side's play changed. Measured against the heuristic with K = 20 layouts per decision: declarer play +2.6 ± 0.2 IMPs a board (+1.1 tricks, 400 boards), and defence +2.1 ± 0.3 IMPs a board (+0.8 tricks, 300 boards). A decision takes about 0.2 to 0.3 seconds on one core, and an opening lead about 1.4 seconds.

Online tables keep the heuristic robot. A Durable Object on the Workers Free plan gets about 10 ms of CPU time per invocation, and one solve of a full deal takes about 70 ms.
