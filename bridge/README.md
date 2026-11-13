# Bridge

Play bridge with friends or robots in the browser. Up to four people play from their own phones or computers.

- **The page** is the files in this folder, served by GitHub Pages at `https://sundogx.github.io/bridge/`.
- **The tables** run on a Cloudflare Worker (`src/worker.js`, configured in `wrangler.jsonc`). Each table is a Durable Object that deals, checks every bid and play, runs the robots, and sends each player only their own cards, over a WebSocket. Nothing uses Claude's artifact storage.
- `config.js` holds the Worker's address (`window.BRIDGE_API`). Practice with robots works without it.

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
