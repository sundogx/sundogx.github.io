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
| `js/leads.js` | Robot opening leads (see below). |
| `js/bots.js` | Heuristic robot card play, and how robots answer claims. |
| `js/ddplay.js` | Robot card play by double-dummy sampling (see below). |
| `js/table.js` | The table itself: seats, the actions (bid, play, claim, undo…), who may see which hands. |
| `js/par.js` | The par contract from a double-dummy table. |
| `js/net.js` | The WebSocket connection to a table on the server (reconnects, held moves). |
| `js/analysis.js` | Runs the double-dummy solver in background workers; hand-record analysis and PBN export. |
| `js/app.js` | Everything on screen: drawing the table, bidding box, options, keyboard, lobby. |
| `js/dds-worker.js`, `js/wasm/` | The WebAssembly solver (see below); it also picks the practice robots' cards. |
| `src/worker.js` | The Cloudflare Worker: one Durable Object per table, plus the lobby. |
| `src/game.js` | **Generated** by `build.mjs` from `js/engine.js`, `js/bidding.js`, `js/leads.js`, `js/bots.js`, `js/ddplay.js` and `js/table.js`, so the server runs exactly the same rules and robots as the page. Don't edit it; `npm run dev` and `npm run deploy` rebuild it. |
| `sw.js` | Service worker: caches the app so practice works offline. Bump `CACHE` and keep `CORE` in step when files are added. |
| `tests/` | `npm test` (rules, robots, bidding fuzz), `node tests/ddtest.js` (solver, robot sampler), `node tests/playsim.js` (robot card play, sampling against heuristic), `node tests/heurstim.js` (the heuristic robot against its previous version, and where it loses tricks against double dummy), `node tests/heurfit.js` (fits the heuristic's switch and discard weights), `node tests/leadsim.js` (opening leads), `BRIDGE_URL=http://localhost:8787 node tests/online.test.mjs` (a running server). Bidding: `node tests/bidddsim.js` (match against the old bidding, scored double-dummy; `--base=basebid` plays the 2/1 system before the constructive changes, `tests/fixtures/basebid.js`), `node tests/bidloss.js` (where uncontested auctions lose against the best double-dummy contract), `node tests/bidshow.js` (read auctions), `node tests/bidwhy.js` (why a robot made a call)., `node tests/bidpar.js` (where the robots lose IMPs against par, by side and auction type) |

The page's scripts are plain scripts that share globals, loaded in the order above. Practice games run entirely in the page; online tables run on the server, which sends each person only the cards they may see.

## Robot bidding system

The robots play **2/1 Game Forcing**, close to the ACBL 2/1 card. Conventional calls carry an alert that explains them. Every robot call can be tapped to read what it means (`describeCall` in `js/bidding.js` builds the text from the call's meaning in the system): calls the ACBL rules require to be alerted have a red outline, all other explained calls a gold one, and announced calls (a natural 1NT opening, transfers, a forcing 1NT) show their announcement. Robots explain their calls to everyone, their partner included; a human's own alert is hidden from that human's partner. `node tests/describe.js` checks the explanations. Robots read your calls by the system below whether you alert them or not.

- **Openings.** 1♥/1♠ five-card majors, 11-21 points (lighter in third seat, rule of 15 in fourth). 1♦ usually 4+ (3 only with 4-4-3-2), 1♣ 3+. 1NT 15-17 balanced (may hold a five-card major), 2NT 20-21. 2♣ strong and artificial (22+, or 9+ tricks); 2♦ waiting, 2NT rebid 22-24, 3♣ second negative over a major rebid. Weak twos in ♦/♥/♠ (6 cards, 5-10) with 2NT feature ask; three-level preempts with 7 cards, 4♥/4♠ with 8.
- **Responding to 1♥/1♠.** 1NT forcing one round (6-12; a passed hand's 1NT is not forcing). A new suit at the two level is game forcing (2♥ over 1♠ shows 5). Single raise 6-10; 3 of the major is a limit raise with 4 trumps (a 3-card limit raise goes 1NT then 3 of the major); 4 of the major is preemptive. Jacoby 2NT: 4+ trumps, game forcing; opener shows a singleton or void at the three level, else 3 of the major = 17+, 3NT = 14-16, 4 of the major = minimum. Splinters: double jumps (1♥-3♠, 4♣, 4♦; 1♠-4♣, 4♦, 4♥) show 4+ trumps, game values and a singleton or void.
- **Responding to 1♣/1♦.** Majors up the line (a weak hand bids a 4-card major before diamonds); 1♦-2♣ is game forcing; raises 6-10 and limit; 1NT 6-10, 2NT 11-12, 3NT 13-15 without a 4-card major.
- **Opener's rebids.** 1NT 12-14, 2NT 18-19 (even with a 4-card spade suit over 1♥; responder bids 3♠ with four); reverses (16+) force one round; a **jump shift** (19+, or 17-18 with four losers, unbalanced) is game forcing; after 1M-1NT opener may rebid a 3-card minor. After 1x-1y-1NT, **new minor forcing** (2 of the unbid minor) asks for 3-card support or the other major; elsewhere the **fourth suit** is artificial and game forcing. Responder's new (third) suit after opener's rebid is forcing one round.
- **Notrump.** Stayman (Smolen over a 2♦ reply with 5-4 in the majors and game values; 2♥/2♠ over 2♦ = 5-4 invitational), Jacoby transfers with a super-accept, Texas 4♦/4♥, 2♠ = transfer to clubs for a weak minor (bid 3♦ to play diamonds), 2NT invitational, 4NT quantitative. The same over 2NT and 2♣-2♦-2NT one level higher, and over our 1NT overcall (15-18). If they overcall our 1NT at the two level, **lebensohl**: a new suit at two is to play, a three-level suit forces to game, double is penalty; 2NT asks opener for 3♣, after which responder passes or signs off in a suit ranking below theirs, invites in a suit ranking above, or shows game values with a stopper (their suit = 4 cards in an unbid major, 3NT = no major). Bid directly, the cue bid and 3NT deny a stopper ("fast denies").
- **Slams.** Hands are valued for slam beyond high cards: with a fit, losing-trick count (24 less both hands' losers, partner's losers estimated from what partner has shown) checked against points with shortness or length, less kings, queens and jacks opposite partner's shown shortness; partner is credited with a little above the bottom of the range shown. About 31 such points and 12 tricks, with no side suit that may hold two fast losers, start a slam try; in notrump, about 31 combined high-card points invite with a quantitative 4NT. **Control bids**: once a major is agreed in a game-forcing auction, a new suit below four of the major shows first- or second-round control (ace, king, singleton or void) and slam interest, cheapest first; with every side suit controlled between the hands, 4NT asks for key cards, and without interest the bid is four of the major. Roman Key Card Blackwood 1430 (5♣ 1 or 4, 5♦ 0 or 3, 5♥ 2 without the queen, 5♠ 2 with it) with the next step asking for the trump queen (with no queen, the asker stops at five); with all key cards and the queen, 5NT is a grand slam try (seven with two side kings, or one and five trumps). 4NT is quantitative when no suit is agreed and partner last bid notrump. After 2♣-2♦-3NT (25-27), responder bids 6NT with 8+, invites with 4NT on 6-7, or transfers with 4♦/4♥.
- **Game judgement.** The robots bid game with about 24 combined points (their own valuation plus partner's expected strength), slightly more aggressive than 25, which suits IMP scoring. When a robot's system table has no call for its hand, it bids naturally rather than pass below game with values.
- **Competition.** Overcalls: 1-level 8-17 with 5 cards, 2-level 10-17 with a good suit; weak jump overcalls (6 cards at the two level, 7 at the three level); 1NT overcall 15-18 (11-15 in the balancing seat). Michaels cue bid (both majors over a minor; the other major and a minor over a major; advancer bids 2NT to ask for the minor) and Unusual 2NT (the two lowest unbid suits). Takeout doubles, with the advancer's cue bid showing 12+; jumps 9-12 opposite a direct double. A cue bid of their suit by partner of an overcaller (or by responder after an overcall) is a limit raise or better. Responder's doubles are **negative** through 3♠; opener reopens with a double when short in their suit. Over a takeout double: redouble 10+, Jordan 2NT = limit raise or better, jump raise preemptive. Partner's double of their 1NT is for penalties. Later doubles are for penalties; competitive decisions follow the law of total tricks.
- **More competition.** The robots know the vulnerability. Not vulnerable against vulnerable, preempts, weak jump overcalls and one-level overcalls may be a point lighter; vulnerable, overcalls need about a point more or a better suit. Over their game the robots sacrifice with a long fit and little defence (9 trumps at the four level, 10 at the five level; 11 when both sides are vulnerable; never vulnerable against not vulnerable), and they double vulnerable opponents for penalty a point more readily. **Support doubles**: after 1x-1♥/1♠ and an overcall up to 2♥ (or a double), opener's double (redouble) shows exactly 3-card support; a raise shows 4. **Responsive doubles** also after partner's overcall and their raise (the two other suits, no fit); the overcaller then bids rather than defends. After partner doubles their weak two, **lebensohl**: 2NT is weak and asks for 3♣ (pass or sign off), a three-level suit shows 8-11, a cue bid or 3NT game values. Over their strong 2♣, suit overcalls are preemptive and double shows clubs; if they come in over our 2♣, responder's pass is waiting, a double is penalty, and our side is forced to game. When they redouble our takeout double, the advancer bids his best suit (pass = wants to defend), and so does the doubler if it comes back to him. Opener converts a negative double at the one level only with 5 good trumps.
- **After a takeout double or a redouble.** The doubler bids again over partner's simple advance only with extras: a raise shows 18+ in support points (19+ invites with a jump raise, game with 22+, or 18+ and three trumps when partner was pushed to the three level), 1NT/2NT 18-20 balanced, 3NT 22+ (20+ over a three-level advance), a new suit 18+ with five cards; all three points lighter after a balancing double or a free bid by partner. After 1x (X) XX, if they run below two of our suit every double is for penalty: opener doubles with four good trumps, else passes (forcing) unless he has a long suit or two-suiter to show; the redoubler then doubles with trumps, or bids (3NT with 14+ and a stopper, a raise, notrump with a stopper, his longest suit). If partner passes our opening and RHO comes in, opener's double is takeout with 16+.
- **Odds and ends.** A robot with a good six-card suit and about 13+ points (counting length) competes once at the three level. After 1x-1y-1z responder's jump to 2NT invites (11-12). After 1m-1M-3m (opener's six-card minor, 16-18) responder bids 3NT with 10+, or three of his major with five. Over their weak two, partner of a 2NT overcall bids game with 8+.
- **When they interfere in our auctions.** A double that takes no room (penalty or lead-directing, or any double once we are game forcing or opened 1NT, 2NT or 2♣) is ignored: the system stays on (completing transfers, answering Stayman, and so on). Once we are game forcing, a bid by them is ignored too when the call the system wants is still available; a double is then for penalty (trump length, or most of the high cards against their notrump, or their sacrifice over our game), and a penalty double is left in.
- **Not played.** Inverted minors, Drury, help-suit game tries, Bergen raises, serious 3NT, Last Train, Exclusion Blackwood, Gerber, DONT/Cappelletti (Cappelletti was tried and measured slightly worse than natural overcalls and a penalty double), Leaping Michaels, Rosenkranz doubles. Inverted minors, Drury and help-suit game tries were tried and measured no better (see below).

Measured with `node tests/bidddsim.js` against the previous natural bidding (both systems bidding the same deals at two tables, contracts scored double-dummy) it gains about +1.0 IMP a board (3,000 held-out boards: +1.04 ± 0.09), and it lands nearer par.

The constructive changes above (slam valuation, control bids, the grand slam try and queen-ask fix, jump shifts, 2NT 18-19 rebids, responder's forcing new suit, no passing below game with values, 24-point games, 2♣-2♦-3NT responses) were tuned on 9,000 boards and measured on 4,000 held-out boards against the 2/1 system before them (`--base=basebid`): **+0.064 ± 0.025 IMPs a board**, with 170 boards bid differently (the gain comes from those). Inverted minor raises, Drury and help-suit game tries measured slightly negative (-0.001 to -0.004 a board on the tuning boards) and were left out; so was fast-arrival meaning for jumps to game.

The competitive changes above (vulnerability, support and responsive doubles, both lebensohls, sacrifices, defence to and after a strong 2♣, the system staying on over interference, running from a redouble, 24-point games in contested auctions too, and inviting 2NT only with 23+ combined) were tuned on 9,000 boards and measured on 4,000 held-out boards against the bidding with the constructive changes but none of these: **+0.27 ± 0.04 IMPs a board** (+0.38 ± 0.05 against `--base=basebid`). Against opponents who make a random call 15% of the time (as a human might), they gain about +0.28 IMPs a table. Cappelletti over their 1NT and sounder preempts and weak jump overcalls when vulnerable measured slightly worse and were left out. `node tests/bidddsim.js ... --off=supx,leb,...` switches features off by name to measure them.

The third round (the doubler's rebids, doubles after our redouble, opener's strong takeout double, competing with a six-card suit at the three level, the 2NT invitation and the replies to 1m-1M-3m, and game opposite a 2NT overcall) started from where `node tests/bidpar.js` and `node tests/bidloss.js` showed the IMPs going: in contested auctions mostly partscores where our side could make game, or where the side that bid on could have been doubled. It was tuned on 4,000 new boards and checked on four older 3,000-board sets, then measured once on 4,000 held-out boards against the bidding before it (`--base=basebid3`, `tests/fixtures/basebid3.js`): **+0.077 ± 0.020 IMPs a board**, with 226 boards bid differently, most of it in contested auctions (+0.41 ± 0.05 against `--base=basebid`). Each feature switches off with `--off=` (`xreb`, `xxrun`, `xstrong`, `ls3`, `j2n`, `j3m`, `o2n`), and `--k=name:value` sets the tuning knobs (`ls3`, `x3n`, `x3nl`, `xr1`, `o2n`). Bidding games and accepting invitations more lightly when vulnerable (IMP odds: a vulnerable game needs about 37%, a non-vulnerable one about 45%) measured no better, either way round, and was left out; so did a looser penalty double after our redouble (any three trumps) and a 3NT rebid by the doubler on 17-18. The 2NT-overcall change measured neutral and was kept because it is the standard treatment.

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

The hand analysis runs DDS (Bo Haglund and Soren Hein, Apache-2.0) compiled to WebAssembly. The files are in `js/wasm/` with their licence notes.

- **The build.** `js/wasm/build.sh` (needs Emscripten: `brew install emscripten`) builds it from the same DDS 2.9.0 sources and C interface as the npm package `@bridge-tools/dd` 0.2.2 (MIT). That package's build is unoptimised, with assertions and a fixed 50 MB of memory per instance. This one is `-O3`, with memory that starts at 16 MB and grows. It solves about twice as fast, and the wasm is 304 KB instead of 705 KB, the glue 14 KB instead of 189 KB.
- **The workers.** `js/dds-worker.js` runs the solver in Web Workers. The page compiles the wasm once and sends it to each worker. Each worker **keeps one solver instance** for all its solves.
  - DDS keeps its transposition table between solves only for the same or a similar deal, as in its own batch calls.
  - An earlier note here said reuse gave wrong numbers. The cause was code that read stale entries from the reused output buffer, which is now cleared before every solve.
  - Creating and initialising an instance used to cost more than the solve itself in mid-play positions.
- **The checks.** `node tests/ddtest.js [n]` checks a reused instance against a brute-force search on n endings and on mid-trick positions card by card. It also checks full deals solved on a reused instance against a fresh instance. `FRESH=1` gives every solve a fresh instance instead. On 5,000 endings, 11,179 mid-trick cards and 400 full deals there were no mismatches.
- **Analysis workers.** The hand record uses one worker per strain job: two workers, or one on devices with four cores or fewer. It waits while a robot is thinking about a card or a lead.
- **Par.** `js/par.js` turns a table into the par contract.

## Robot card play

In practice games the robots choose their cards the way GIB and BEN do, by double-dummy sampling (`js/ddplay.js`). On a robot's turn the page sends a worker only what that robot may see: its own hand, dummy once it is face up (declarer sees both of its hands), the cards played so far, and the auction. The worker deals the unseen cards at random about 24 times, consistent with that: suits a player has shown out of, and the HCP ranges and suit lengths the auction showed (from `shown()` in `js/bidding.js`, plus the opening-bid ranges). It solves every layout for every legal card and plays the card with the best average score for its side. The heuristic robot (`botPlay`) breaks ties, which keeps sequence leads, signals and low-from-equals. It also plays outright when there is only one sensible card, when the solver takes more than about 1.5 seconds, or if the solver fails. The solver stops before a layout that would probably take it past the time budget, using the average time per solve so far. A late answer only means the heuristic card for that turn: the worker isn't restarted unless it is more than 10 seconds behind. The solver thinks during the robot's usual pause, so play is no slower than before. In practice games the workers are started and warmed up during the auction (`robotDDWarm`), so the opening lead and the first cards don't wait for them.

### Opening leads

The opening lead is the decision with the least information, so it has its own code, `js/leads.js`.

- **The card in a suit** is the standard one: top of a sequence (KQJ, QJT, and KQT), the middle card of an interior sequence (K**J**T, Q**T**9, and A**J**T against notrump), the ace against a suit contract (no underleading aces), top of a doubleton, fourth best from an honour, and second highest from three or four small cards.
- **The prior** rates leading each suit from the leader's holding and the auction, the way Bird and Anthias's *Winning Notrump Leads* and *Winning Suit Contract Leads* rate leads by simulation. It is a linear score on 25 features: sequences, AK, interior sequences, length, singletons and doubletons, unsupported kings, queens and aces, honour doubletons, partner's suit, the opponents' suits, unbid suits, majors against notrump, trumps, and trumps after dummy gave preference. The weights are fitted (ridge regression) to the double-dummy result of every lead on 1,500 robot auctions: `node tests/leadsim.js fit`. The fit agrees with the books:
  - Sequences, AK and partner's suit are good leads.
  - Unsupported kings and queens, and the opponents' suits, are bad leads.
  - Against suit contracts, singletons and doubletons are good, and a trump lead is slightly bad.
  - Against notrump, length and the majors help.
- **The heuristic robot** (`botLead`, used in strangers mode and as the fallback) leads the suit with the best prior.
- **The solver robot** (`leadChoose`, `leadPick`) deals the unseen cards up to 48 times, consistent with the auction (`leadLimits`). It solves each layout and leads the suit whose card takes the most defensive tricks on average, plus twice the prior.
  - `leadLimits` uses the minimum *and* maximum HCP and suit lengths from `shown()`, and no five-card major for a direct 1NT-3NT.
  - The prior steadies the choice, because ~24-48 layouts are a noisy estimate. Averaging IMPs or points instead of tricks measured about the same.
  - The page splits the layouts between workers: half the device's cores, from one to four (`robotDDLead` in `js/analysis.js`). Each worker sends back every result as soon as it has solved it, and stops before a layout that would probably end past the 1.7-second budget. The page pools what has arrived and decides by about 2.2 seconds at the latest, so a slow worker still contributes. The lead workers are closed after the lead and started again during the next auction.
  - `ddView` adds the limits and the prior to the robot's view (`leadView`), so in friends mode the browser doing the thinking needs nothing more.

Measured with `node tests/leadsim.js` on 2,215 held-out boards. Each board is a robot auction, and every lead is scored by the true double-dummy result, with 24 layouts. The comparison is against the previously shipped rule: the old heuristic lead, replaced only by another suit's card that the solver rated 30 points better on 24 layouts.

| Lead | IMPs a board | Tricks | Contracts set | Played out by the robots |
|---|---|---|---|---|
| Solver with prior (new) | +0.07 ± 0.03 | +0.03 | 50.4% (shipped 49.3%) | +0.08 ± 0.08 |
| Heuristic `botLead` (new) | +0.01 ± 0.04 | +0.02 | 49.8% | +0.11 ± 0.08 |
| Solver without prior | +0.02 ± 0.03 | +0.02 | 50.2% | +0.00 ± 0.08 |
| Old heuristic alone | −0.03 ± 0.03 | −0.01 | 48.9% | +0.04 ± 0.06 |

- Against games, the contract is now set more often: 3NT and higher 39.1% (was 37.7%), and suit games 46.1% (was 44.4%).
- The last column plays every lead out with the heuristic robots instead of double-dummy.
- Against the old heuristic alone, the new solver lead gains +0.10 ± 0.04 IMPs a board, and `botLead` +0.04 ± 0.04.
- In the page the solver gets up to 48 layouts rather than 24. In tuning, more layouts helped slightly.

For scale, an oracle that knew all four hands would gain only about +0.75 IMPs a board over the old heuristic, choosing among the same cards. Most of the value of a lead is a guess the auction can't settle.

The neural-network leader of BEN (github.com/lorserker/ben) was considered and not used:
- Its lead networks are small: an ONNX export of about 2.3 MB each, and onnxruntime-web is about 3 MB compressed.
- But BEN is GPL-3.0.
- The lead network reads the auction only through BEN's own bidding-info network, trained on GIB/BEN system auctions, which would need a JS port of its auction encoding.
- BEN itself picks among the network's candidates by sampling and double-dummy solving, as here.

### The heuristic robot (`botPlay`)

`botPlay` in `js/bots.js` plays without the solver. It is what the robots use at strangers tables and on the server, the fallback when the solver is slow, the tie-breaker inside the solver play, and the play model that `ddConsistency` replays. It is synchronous and cheap (about 0.01 ms a card at the median and under 0.1 ms at p99; the opening lead is `botLead`), and it reads only what that seat may see.

- **Declarer counts and plans** (`suitCount`, `declPlan`). For each suit it counts the sure tricks from the top, and the tricks once the suit is developed (round by round: our top card wins if it beats theirs, otherwise we duck and they win).
  - In a suit contract it ruffs losers in the short trump hand first. It draws trumps with a master, toward partner's higher trumps, or with the top of a sequence. It leaves the opponents' trumps alone when they are all higher than ours.
  - If the sure tricks are enough, it cashes them, short hand first. If not, it develops the suit that gains the most tricks (leading toward honours, or the top of a sequence) instead of cashing winners early.
  - In second seat it wins with a master when it can (`second`). With a tenace opposite, it leads toward it (`fin`).
- **Defenders** choose a suit to lead after the opening lead (`swF`) and a suit to discard (`dsF`) by a linear score on simple features: partner's signals and lead, through strength or up to weakness, ruffs for dummy or ruff-and-discard, honours that would be led away from or unguarded, length against dummy's, the suits the opponents bid, and so on. The weights (`BOT_SWITCH_W`, `BOT_DISCARD_W`, by notrump or suit contract and for discards by side) are fitted by ridge regression to the double-dummy result of every candidate suit on 1,200 robot boards: `node tests/heurfit.js 1200 switch|discard`. The rest is standard: second hand low, third hand high, covering an honour with an honour, cashing the setting tricks, and attitude signals.
- Features switched off by default (`BOT_DEFAULT_OFF`, measured neutral or worse): a hold-up with a single stopper in notrump by the rule of 7 (`holdup`, −0.02 IMPs), and leading trumps against dummy's ruffs (`trlead`). Letting partner's honour run in third seat when we hold the next card measured −0.03 and was removed.

`node tests/heurstim.js [boards] cmp [seed]` plays the same deals and robot auctions with one side's card play changed, against the previous heuristic (frozen in `tests/fixtures/basebots.js`). On 2,979 held-out boards (seed `test`; the work was tuned on `dev`):

| Side changed | IMPs a board | Tricks a board |
|---|---|---|
| Declarer | +1.07 ± 0.09 | +0.35 ± 0.03 |
| Defenders | +0.29 ± 0.08 | +0.13 ± 0.03 |

With the new heuristic in all four seats, declarer takes 0.41 tricks fewer than the double-dummy result of the deal, against 0.64 before. `node tests/heurstim.js 600 leak` solves every decision double-dummy and totals the tricks lost by kind of decision and by the rule that chose the card. Against perfect play the declaring side now loses 1.81 tricks a board (was 2.27) and the defenders 1.35 (was 1.66). The largest leaks left are declarer's leads in suit contracts, defenders' switches, and declarer's third-hand play (the cheapest card that wins).

`node tests/playsim.js [boards] [K]` replays the same deals and auctions with one side's play changed. Measured against the heuristic with K = 20 layouts per decision: declarer play +2.6 ± 0.2 IMPs a board (+1.1 tricks, 400 boards), and defence +2.1 ± 0.3 IMPs a board (+0.8 tricks, 300 boards). A decision takes about 0.2 to 0.3 seconds on one core; an opening lead at most about 1.7 seconds, shared between workers. (These playsim numbers predate `js/leads.js`: its base robot now leads with `botLead`, and its `lead*` variants with the solver lead above.)

**Reading the play (from BEN).** After the opening lead the robots also use what the other players' cards say, as BEN does with its card-play networks: the worker deals 96 layouts, replays the play so far in each one through the heuristic robot (`botPlay`, which plays standard carding: conventional leads, attitude signals, second hand low, third hand high, discards from weak suits), and every card the hidden player would not have chosen in that layout (or a card equal to it) multiplies the layout's weight by 0.8. A lead that isn't the conventional card of its suit in that layout (the Q from KQ) counts 0.25, a lead from another suit 0.7. The 24 best-fitting layouts are solved and averaged by weight (`ddConsistency` in `js/ddplay.js`; `RobotDD.DECL` / `RobotDD.DEF` in `js/analysis.js`). That costs about 10 ms per decision. Measured against the previous sampler with `NEW=… node tests/playsim.js` (all four seats sampling, one side reading the play; K = 20): declarer +0.19 ± 0.10 IMPs a board (+0.08 tricks, 961 boards), defence +0.31 ± 0.11 IMPs a board (+0.10 tricks, 793 boards). Harder filtering (0.5 per mismatch, or solving the best 20 of 200) measured worse for the defenders, and ranking cards by IMPs instead of average points (BEN's `use_real_imp_or_mp`) didn't help on top.

BEN itself (github.com/lorserker/ben) is GPL-3.0 and its card-play networks are about 7 MB each (eight of them, plus 11 MB for onnxruntime-web), trained on BEN's own bidding, so they aren't used here; `tests/notes-ben-leads.md` has notes on its opening-lead model.

Online tables have a host setting, **Friends mode**, for private tables only (on by default there; a public table never has it). A Durable Object on the Workers Free plan gets about 10 ms of CPU time per invocation, and one solve of a full deal takes about 70 ms, so the server can't run the solver itself. In friends mode it sends the robot's view (`ddView`) to one connected player's browser (seated players first, in turn; onlookers only if nobody is seated, and never in a team match), which solves it and sends the card back (`think` and `thought` messages in `src/worker.js` and `js/net.js`; the request carries a random nonce, and only the browser asked may answer). That browser then holds the robot's cards, which is why it is meant for friends. If no answer arrives within 2.5 seconds the robot plays its heuristic card. With friends mode off (strangers), no hidden card ever leaves the server and the robots play the heuristic.
