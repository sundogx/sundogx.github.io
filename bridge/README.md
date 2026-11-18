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
| `js/bidding.js` | Robot bidding: the 2/1 system below, and what every call in an auction means (robots read human partners with it). |
| `js/bots.js` | Heuristic robot card play, and how robots answer claims. |
| `js/ddplay.js` | Robot card play by double-dummy sampling (see below). |
| `js/table.js` | The table itself: seats, the actions (bid, play, claim, undo…), who may see which hands. |
| `js/par.js` | The par contract from a double-dummy table. |
| `js/net.js` | The WebSocket connection to a table on the server (reconnects, held moves). |
| `js/analysis.js` | Runs the double-dummy solver in background workers; hand-record analysis and PBN export. |
| `js/app.js` | Everything on screen: drawing the table, bidding box, options, keyboard, lobby. |
| `js/dds-worker.js`, `js/wasm/` | The WebAssembly solver (see below); it also picks the practice robots' cards. |
| `src/worker.js` | The Cloudflare Worker: one Durable Object per table, plus the lobby. |
| `src/game.js` | **Generated** by `build.mjs` from `js/engine.js`, `js/bidding.js`, `js/bots.js`, `js/ddplay.js` and `js/table.js`, so the server runs exactly the same rules and robots as the page. Don't edit it; `npm run dev` and `npm run deploy` rebuild it. |
| `sw.js` | Service worker: caches the app so practice works offline. Bump `CACHE` and keep `CORE` in step when files are added. |
| `tests/` | `npm test` (rules, robots, bidding fuzz), `node tests/ddtest.js` (solver, robot sampler), `node tests/playsim.js` (robot card play, sampling against heuristic), `BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs` (a running server). Bidding: `node tests/bidddsim.js` (match against the old bidding, scored double-dummy), `node tests/bidshow.js` (read auctions), `node tests/bidwhy.js` (why a robot made a call). |

The page's scripts are plain scripts that share globals, loaded in the order above. Practice games run entirely in the page; online tables run on the server, which sends each person only the cards they may see.

## Robot bidding system

The robots play **2/1 Game Forcing**, close to the ACBL 2/1 card. Conventional calls carry an alert that explains them; tap a call with a yellow outline to read it. Robots read your calls by the system below whether you alert them or not.

- **Openings.** 1♥/1♠ five-card majors, 11-21 points (lighter in third seat, rule of 15 in fourth). 1♦ usually 4+ (3 only with 4-4-3-2), 1♣ 3+. 1NT 15-17 balanced (may hold a five-card major), 2NT 20-21. 2♣ strong and artificial (22+, or 9+ tricks); 2♦ waiting, 2NT rebid 22-24, 3♣ second negative over a major rebid. Weak twos in ♦/♥/♠ (6 cards, 5-10) with 2NT feature ask; three-level preempts with 7 cards, 4♥/4♠ with 8.
- **Responding to 1♥/1♠.** 1NT forcing one round (6-12; a passed hand's 1NT is not forcing). A new suit at the two level is game forcing (2♥ over 1♠ shows 5). Single raise 6-10; 3 of the major is a limit raise with 4 trumps (a 3-card limit raise goes 1NT then 3 of the major); 4 of the major is preemptive. Jacoby 2NT: 4+ trumps, game forcing; opener shows a singleton or void at the three level, else 3 of the major = 17+, 3NT = 14-16, 4 of the major = minimum. Splinters: double jumps (1♥-3♠, 4♣, 4♦; 1♠-4♣, 4♦, 4♥) show 4+ trumps, game values and a singleton or void.
- **Responding to 1♣/1♦.** Majors up the line (a weak hand bids a 4-card major before diamonds); 1♦-2♣ is game forcing; raises 6-10 and limit; 1NT 6-10, 2NT 11-12, 3NT 13-15 without a 4-card major.
- **Opener's rebids.** 1NT 12-14, 2NT 18-19; reverses (16+) force one round; a jump in a new suit is game forcing; after 1M-1NT opener may rebid a 3-card minor. After 1x-1y-1NT, **new minor forcing** (2 of the unbid minor) asks for 3-card support or the other major; elsewhere the **fourth suit** is artificial and game forcing.
- **Notrump.** Stayman (Smolen over a 2♦ reply with 5-4 in the majors and game values; 2♥/2♠ over 2♦ = 5-4 invitational), Jacoby transfers with a super-accept, Texas 4♦/4♥, 2♠ = transfer to clubs for a weak minor (bid 3♦ to play diamonds), 2NT invitational, 4NT quantitative. The same over 2NT and 2♣-2♦-2NT one level higher, and over our 1NT overcall (15-18). If they overcall our 1NT: double is penalty, a new suit at two is to play, three of a major forcing.
- **Slams.** Roman Key Card Blackwood 1430 (5♣ 1 or 4, 5♦ 0 or 3, 5♥ 2 without the queen, 5♠ 2 with it) with the next step asking for the trump queen. 4NT is quantitative when no suit is agreed and partner last bid notrump.
- **Competition.** Overcalls: 1-level 8-17 with 5 cards, 2-level 10-17 with a good suit; weak jump overcalls (6 cards at the two level, 7 at the three level); 1NT overcall 15-18 (11-15 in the balancing seat). Michaels cue bid (both majors over a minor; the other major and a minor over a major; advancer bids 2NT to ask for the minor) and Unusual 2NT (the two lowest unbid suits). Takeout doubles, with the advancer's cue bid showing 12+; jumps 9-12 opposite a direct double. A cue bid of their suit by partner of an overcaller (or by responder after an overcall) is a limit raise or better. Responder's doubles are **negative** through 3♠; opener reopens with a double when short in their suit. Over a takeout double: redouble 10+, Jordan 2NT = limit raise or better, jump raise preemptive. Partner's double of their 1NT is for penalties. Later doubles are for penalties; competitive decisions follow the law of total tricks.
- **Not played.** Inverted minors, Drury, Bergen raises, support or responsive doubles beyond the basic case, lebensohl, Gerber, DONT/Cappelletti, cue-bidding controls.

Measured with `node tests/bidddsim.js` against the previous natural bidding (both systems bidding the same deals at two tables, contracts scored double-dummy) it gains about +1.0 IMP a board (3,000 held-out boards: +1.04 ± 0.09), and it lands nearer par.

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

In practice games the robots choose their cards the way GIB and BEN do, by double-dummy sampling (`js/ddplay.js`). On a robot's turn the page sends a worker only what that robot may see: its own hand, dummy once it is face up (declarer sees both of its hands), the cards played so far, and the auction. The worker deals the unseen cards at random about 24 times, consistent with that: suits a player has shown out of, and the HCP ranges and suit lengths the auction showed (from `shown()` in `js/bidding.js`, plus the opening-bid ranges). It solves every layout for every legal card and plays the card with the best average score for its side. The heuristic robot (`botPlay`) breaks ties, which keeps sequence leads, signals and low-from-equals. It also plays outright when there is only one sensible card, when the solver takes more than about 1.5 seconds, or if the solver fails. The solver thinks during the robot's usual pause, so play is no slower than before. For the opening lead, the solver may only replace the heuristic's lead with another suit's conventional lead card that scores 30 points better on average. Leads chosen purely by the solver measured slightly worse.

`node tests/playsim.js [boards] [K]` replays the same deals and auctions with one side's play changed. Measured against the heuristic with K = 20 layouts per decision: declarer play +2.6 ± 0.2 IMPs a board (+1.1 tricks, 400 boards), and defence +2.1 ± 0.3 IMPs a board (+0.8 tricks, 300 boards). A decision takes about 0.2 to 0.3 seconds on one core, and an opening lead about 1.4 seconds.

Online tables have a host setting, **Friends mode** (on by default for private tables, off for public ones). A Durable Object on the Workers Free plan gets about 10 ms of CPU time per invocation, and one solve of a full deal takes about 70 ms, so the server can't run the solver itself. In friends mode it sends the robot's view (`ddView`) to one connected player's browser (seated players first, in turn), which solves it and sends the card back (`think` and `thought` messages in `src/worker.js` and `js/net.js`). That browser then holds the robot's cards, which is why it is meant for friends. If no answer arrives within 2.5 seconds the robot plays its heuristic card. With friends mode off (strangers), no hidden card ever leaves the server and the robots play the heuristic.
