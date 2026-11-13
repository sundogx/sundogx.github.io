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
| `js/bots.js` | Robot bidding and card play, and how robots answer claims. |
| `js/table.js` | The table itself: seats, the actions (bid, play, claim, undo…), who may see which hands. |
| `js/par.js` | The par contract from a double-dummy table. |
| `js/net.js` | The WebSocket connection to a table on the server (reconnects, held moves). |
| `js/analysis.js` | Runs the double-dummy solver in background workers; hand-record analysis and PBN export. |
| `js/app.js` | Everything on screen: drawing the table, bidding box, options, keyboard, lobby. |
| `js/dds-worker.js`, `js/wasm/` | The WebAssembly solver (see below). |
| `src/worker.js` | The Cloudflare Worker: one Durable Object per table, plus the lobby. |
| `src/game.js` | **Generated** by `build.mjs` from `js/engine.js`, `js/bots.js` and `js/table.js`, so the server runs exactly the same rules and robots as the page. Don't edit it; `npm run dev` and `npm run deploy` rebuild it. |
| `sw.js` | Service worker: caches the app so practice works offline. Bump `CACHE` and keep `CORE` in step when files are added. |
| `tests/` | `npm test` (rules and robots), `node tests/ddtest.js` (solver), `BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs` (a running server). |

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
