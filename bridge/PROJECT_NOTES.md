# Bridge table: project notes for future chats

A browser bridge app in one self-contained HTML file (`bridge.html`). It follows the basic feature set of BBO, IntoBridge and RealBridge: four seats filled by humans or robots, a bidding box, alerts, play with dummy, claims, undo, chat, kibitzing, hand records, double-dummy analysis and team matches.

**Start here:** unzip `bridge-source.zip`. Edit the source modules, never `bridge.html` directly, and run `python3 build.py` to rebuild.

## Files in the source bundle

| File | What it holds |
|---|---|
| `engine.js` | Pure rules: deal (with a seedable RNG), auction legality, end of auction, final contract and declarer, trick play, follow-suit, trick winner, duplicate scoring, IMP table. No DOM. |
| `bots.js` | Robot bidding (natural SAYC-style, plus Stayman, Jacoby transfers with super-accept, quantitative 4NT, Blackwood, automatic alerts), card play v1 and v2 (finesses, cover honour with honour, ruff in short hand, signals), claim acceptance (`sureTricks`), and `simulateBoard` (four robots play a deal, used for practice comparisons). |
| `dds.js` | Double-dummy solver and `parScore`. Exposes `DDS.strain(hands, strain, onProgress)`, `DDS.table(...)` and `DDS.solver(masks, trump).maxNS(leader, tricks, guess, budget)`. |
| `template.html` | All UI, CSS and app logic. The build replaces `/*ENGINE*/`, `/*DDS*/` and `/*BOTS*/` with the module sources. |
| `build.py` | Assembles `bridge.html`. |
| Tests | `test.js` (scoring and auction), `sim.js` (3,000 robot-only boards checking for illegal calls and plays), `ddtest.js` (solver against brute force on small endings), `ui_test.js` (headless practice game plus two-client multiplayer), `ui_test2.js` (undo, alerts, claims), `host_test.js` (lock, kick, host handoff), `match_test.js` (team match), `feat_test.js` (hints, replay, claim line, convention cards), `pairs_test.js`, `mp_test.js` and `move_test.js` (pairs event, matchpoint arithmetic, E-W movement with a player following his move), `review_test.js`, `sched_test.js`, `share_test.js`, `adj_test.js`, `results_test.js` (scoreboard and shared results), `newfeat_test.js` (deal types, bidding-only practice with real double-dummy workers via a worker_threads stand-in, keyboard play), `maketest.js` (make rate under different robot settings), `defsim.js` (paired self-play: declarer tricks with a defence feature on versus off), `bench*.js` (solver timing). |

Run tests with Node 18+ after `npm i jsdom@24`. For example: `node test.js`, `node sim.js`, `node ddtest.js 400 0`, `node ui_test.js`.

## How multiplayer works

There is no server. Table state is one JSON object in the Claude artifact's shared storage (`window.storage`, `shared=true`), visible to everyone using the published artifact.

**Storage keys**

| Key | Contents |
|---|---|
| `bt:t:<CODE>` | Public table, listed in the lobby |
| `bt:p:<CODE>` | Private table, joined by its 5-letter code only |
| `bt:w:<CODE>:<userId>` | Spectator heartbeat |
| `bt:h:<CODE>` | Shared hand record snapshot |
| `bt:r:<CODE>` | Shared event results snapshot |
| `bt:me` (personal) | The user's `{id, name}` |

**Writing state.** Every action goes through `act(fn)`, which works like this:
1. Fetch the freshest copy.
2. Apply the action from the `A` object to a clone, checking turn and legality.
3. Bump `version` and save.

Clients poll every 1.5 seconds and re-render when `version` increases.

**Robots.** Robot moves are made by one client, the "driver": the seated human with the lowest id. Any seated client takes over if the table has been idle for more than 6 seconds.

**Hidden cards.** All four hands are kept in shared state, and the UI hides other players' cards. It is fine among friends but not cheat-proof.

**Table state shape:** `id, name, private, local, host, locked, allowUndo, kibSee, boardLimit, seats{N,E,S,W: null | {kind:'human',id,name} | {kind:'robot'}}, board, dealer, vul, hands, auction[{call,by,alert}], contract{level,strain,doubled,declarer}, play{tricks[{leader,cards[{seat,card}]}]}, phase (waiting|auction|play|done), claim, history[], chat[], seed, match{room,otherKey,...}, version, updatedAt`.

Cards are written as suit and rank, such as `SA` or `HT` (T means ten). Calls are `1C`…`7N`, `P`, `X` and `XX`.

## Double-dummy solver

The solver is an alpha-beta search on tricks that keeps rerunning with a target trick count until the answer is pinned down. Its techniques:
- **Card equivalence:** cards in an unbroken run count as one move, taking into account cards already played to the current trick.
- **Quick-trick cutoffs,** counting both the leader's own winners and winners the leader can reach in partner's hand.
- **Move ordering heuristics** for leads and for each following position.
- **A transposition table** at the start of each trick. It stores relative-rank patterns with length-pattern lists, which is a partition-search style technique. Each entry also keeps the best card to lead, tried first next time.

It runs in Web Workers built from the page's own script tags, one job per strain on up to two workers. The contract's strain goes first, and results are cached in memory for each set of hands.

Typical speed is 0.1 to 1 second per cell. Some lopsided deals still take a minute or two for the whole table.

**Correctness rule:** any solver change must pass `ddtest.js` (brute force on endings) with 0 mismatches.

## Feature list

- **Lobby:** your name, practice with robots, open a public or private table, open a team match (two rooms, same deals, teams swap directions, IMP scoring), join by code, list of open tables.
- **Table:** sit down or add a robot, a bidding box styled after physical bidding cards, alerts that only the opponents see, an auction grid (tap any call to see what it shows; `explainCall` in template.html), card fan with legal cards highlighted, dummy shown after the opening lead, last trick, claim and concede with accept or reject, undo (backs up past robot moves only), chat, board clock with an optional time limit, turn sound and vibration, spectator count.
- **Pairs events:** 2 to 6 tables open together with one seed, so every table gets the same deals. Each table stores `event {id, name, idx, keys, codes}` and fetches the others every 5 seconds (`eventRooms`). `eventBoards()` matchpoints every board finished at two or more tables (2 points per table beaten, 1 per tie). `eventStandings()` ranks every N-S and E-W pair by percentage. Hand records list all tables' results. The Event tables button lets you move between tables. Movement is chosen in the lobby (`event.movement`: `mitchell`, `howell` or `none`, with `event.roundLen` boards per round). `schedule(event, round)` returns each table's `{NS, EW}` pair ids: Mitchell uses `NSp` and `EWp` (E-W pair p sits at table p + round); Howell uses `P1`…`P2n` from the circle method, so every pair meets every other pair once in 2n − 1 rounds, with N-S/E-W balanced greedily (`sched_test.js` checks both properties for 2 to 6 tables). After every round, once every table has finished it, the first table with a seated human (its driver) moves every pair's two occupants from their old schedule position to their new one, bumps `event.round`, starts the next board everywhere, and records `event.moved[userId] = destination key`. A moved player's client sees that and opens the new table automatically (`followMove`). Pairs are numbered by starting table: N-S pair p stays at table p, and E-W pair p sits at table p + round. `finishBoard` stores `pNS`, `pEW` (pair ids) and a `players` snapshot in each record, and standings aggregate by pair id (`pairLabel` turns ids into "N-S 2" or "Pair 5"). Tables with only robots are played out by that same driver (`driveRobotTables`) so they keep pace with the field.
- **Convention cards:** one per partnership, editable by that side's seated players and readable by everyone. A side with robots shows the robot system card (`ROBOT_CC`) unless the human has written their own. Stored in `t.cc`.
- **Director:** the event creator (`event.director`) sees an Adjust button for every table's result in a hand record's All tables list. They can give an artificial score (average plus N-S 60%, average 50%, average plus E-W 40%), correct declarer's tricks (score recalculated; the original is kept in `rec.orig`), or remove the adjustment. Artificial averages keep their fixed share and are excluded from the other tables' comparison. The edit is written to that table's storage and announced in its chat.
- **Live scoreboard:** the Event tables window shows every table's pairs, round, board and current state (bidding, contract and tricks, done, waiting for the move), refreshing every 3 seconds while open.
- **Shareable event results:** Share results (in the scoreboard or the results tab) saves a snapshot under `bt:r:<CODE>` with standings and every board's traveller (all tables' contracts, scores and percentages). The lobby's Open box accepts both hand record and results codes.
- **Shared hand records:** Share in a hand record saves a snapshot under `bt:h:<CODE>`; anyone can open it from the lobby with the code (diagram, auction, double-dummy table, review, PBN).
- **Review:** hand records have a "Review trick by trick" view showing all four remaining hands before each trick, the cards played, and the running trick count.
- **Practice deal types:** the lobby's deal menu (`t.dealType`) picks deals from South's point of view with `dealOfType` and the `DEAL_TYPES` filters: 1NT opener, strong hand, game zone, slam zone, competitive, 6+ card suit, defence.
- **Bidding-only practice** (`t.bidOnly`): when the auction ends, the table goes to phase `ddwait`, and `checkBidOnly` finishes the board with the double-dummy trick count once the solver has that cell. Without workers, robots play it out instead. The robot table's contract is scored double dummy too (`otherScore`), so the IMP comparison is like for like. Records carry `ddScored`.
- **Keyboard:** bid with 1–7 then C, D, H, S or N; P passes, X doubles, R redoubles. Play by typing rank and suit in either order (T, 1 or 0 for ten); a rank alone plays when it is the only legal card of that rank while following suit. Ignored while typing in a text field or when a window is open.
- **Practice extras:** a Hint button (the robot's call or card for your seat, highlighted in your hand) and Replay (play the same deal again; the earlier result is removed).
- **Claims:** can include a line of play ("draw trumps, run hearts"), shown in the claim banner and in chat.
- **Host settings:** lock seats, remove a player, allow undo, whether spectators see all hands, time per board, redeal.
- **Results:**
  - Ordinary tables: compared against par, in IMPs.
  - Practice: compared against four robots playing the same deal.
  - Team match: scored across both rooms.
- **Hand records:** hand diagram, auction, trick-by-trick play, double-dummy table, par, and PBN export (copy one board, download all).

## Known limitations and ideas for next steps

- Some lopsided deals still take one or two minutes to solve. Phones are slower.
- Robots are decent but weaker than BBO's robots, especially in competitive bidding and defence. Robot card-play features listed in `BOT_DEFAULT_OFF` measured as neutral or harmful in self-play. Defence features: `setcash` (cash the setting tricks) measured at -0.031 ± 0.008 declarer tricks per board and is on; `sluff` (avoid giving a ruff-and-discard) is neutral and on; `trlead` (trump lead against dummy ruffs) is neutral and off. Measure new ideas with `node defsim.js 3000 <feature>`. Bidding features are measured with `node bidsim.js 3000 <feature> [seed]` (one side uses the feature, compared in IMPs; each deal played with the feature for N-S and for E-W): `pendbl` (penalty double when the opponents compete to the 3 level or higher against 19+ combined points with trump length or honours; partner leaves it in) measured +0.022 ± 0.011 and +0.050 ± 0.013 IMPs per board on two seeds and is on; `balance` (lighter action in the pass-out seat, with partner's inference adjusted) measured −0.004 to −0.046 in several versions and is off.
- On phones (560 px wide or less) the board-info corners get their own row, the top hand spans the full width, and playable dummy cards are at least 28 × 32 px. There's no screenshot tooling in this environment, so this layout is untested visually.
- There is no video or audio (RealBridge's signature feature), no tournaments or movements across more than two tables, and no convention cards.
- Polling with last-write-wins can rarely drop a simultaneous chat message.
- Possible next steps: a convention card per partnership, bid explanations shown on hover for every robot bid, a faster solver for the worst deals, and a better mobile layout for dummy on the side seats.
