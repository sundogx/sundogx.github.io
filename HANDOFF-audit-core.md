# Audit: core rules code (round 8)

Area: js/engine.js, js/par.js, the claim solver in js/bots.js (`sureTricks`, `exactTricks`, `claimSolver`,
`claimTopTricks`, `claimAccept`), js/analysis.js (DD table, par line, play review, PBN export).

## Method

New test `bridge/tests/rulesfuzz.js` (in `npm test` at 600 cases, about 7 s CPU; `node tests/rulesfuzz.js 30000` for a
long run). Each check compares the code with a reference written separately from the Laws:

1. Scoring (Law 77): all 23,520 cases (level x strain x undoubled/X/XX x 4 vulnerabilities x 4 declarers x 0-13
   tricks) against a table-driven scorer: undertrick steps 100/200/200/300 nv and 200/300 vul, doubled and redoubled
   overtricks, the insult bonus, game reached by doubling, slam bonuses, `scoreNS` sign.
2. Board rotation: dealer and vulnerability for boards -40..64 against the Law 2 cycle and printed spot checks.
3. IMPs: every difference 0..5000 (both signs) against the WBF scale.
4. Auctions: random auctions biased towards X/XX. After every call it checks the turn, the end of the auction, the full
   legal-call list and `isLegalCall` against a reference state machine (insufficient bids, X only of an opponent's
   undoubled bid, XX only of an opponent's X, 4 passes or 3 passes after a call). It also checks the final contract
   and declarer (first player of the side to name the strain).
5. Tricks: random full deals in every strain: `playTurn`, `legalPlays` (follow suit), `trickWinner`, `tricksWon`.
6. Par: `parScore` against a minimax over the auction. The side to move lets the contract stand (doubled if it fails)
   or bids any higher contract with its better declarer. Both orders of who bids first are tried. Random tables
   (uniform and realistic) plus a separate run on 2,000 real double-dummy tables x 4 vulnerabilities (8,000 cases,
   from `tests/bidddsim.js 2000 1`) all matched the minimax. Sacrifices, cheapest sacrifice level, best declarer and
   passed-out boards are covered. The check also confirms that the par contract shown scores the par score and is
   doubled exactly when it fails.
7. PBN export: random boards (with random auctions, full and part play, claims, passed out) go through
   `analysis.js pbnBoard` and are read back by `share.js parsePBN`. Board, dealer, vulnerability, hands, auction,
   contract, every trick, result and score must match.
8. Claims: on random endings of 1-7 tricks (some mid-trick), `exactTricks` and `sureTricks` must equal a separate
   memoised minimax. `claimTopTricks` (the fallback when the search runs out of nodes) must never count more than the
   double-dummy result, and `claimAccept` must be exact. `tests/claimtest.js 400` also passed (brute force and DDS,
   0 mismatches).

A mutation check showed the test is not vacuous. Six planted bugs were each caught: XX overtricks nv, the IMP boundary
at 430, X of partner's bid, par without sacrifices, the vulnerability of board 11, and trick winner ignoring trumps.

## Bug fixed

**Board numbers below 1 gave no dealer (js/engine.js `boardDealer`/`boardVul`, js/share.js `parseLIN`).**
`SEATS[(n - 1) % 4]` is `undefined` for n = 0 and for most negative n (JS `%` keeps the sign). The importer reads the
board number from the file, so these inputs reached it:
- a LIN record with `ah|Board 0|` and no dealer digit in `md|`;
- a PBN with `[Board "-2"]` and no `[Dealer]` tag.

Both imported with dealer `undefined`, the first call `by: undefined`, and the contract `declarer: undefined`. With
LIN `Board 0`, `buildDeal` also showed board 1 while the dealer came from board 0.

Repro (before):
`parseLIN('md|S4TKHJD68QC679TKA,S35H479TQKD24TAC8,S2789H3AD379JKC35,|ah|Board 0|sv|o|mb|1C|mb|p|mb|p|mb|p|')`
gives `dealer: undefined`, `contract.declarer: undefined`.

Fix:
- engine: wrap with a positive modulo, so board 0 is treated as board 16;
- share.js: LIN `ah|Board 0|` counts as board 1, as PBN `[Board "0"]` already did.

Tests:
- rulesfuzz section 2 (boards -40..0 equal boards 8..48);
- a new check in tests/sharetest.js (`lin board 0`).

## No other bugs found in

Scoring, IMPs, vulnerability/dealer rotation, auction legality and end, declarer, legal plays, trick winners, par,
the claim solver and its fallback, and the PBN export round trip.

## Unfixed findings / notes

- **Par order dependence (js/par.js).** `parScore` takes no dealer. On some tables par depends on which side gets to
  bid first. DDS handles this with `DealerPar`, which gives the dealer's side the first chance. On those tables
  `parScore` gives one of the two answers, chosen without regard to the dealer. This shows up only on artificial tables
  (428 of the 3,000 test tables, all of them uniformly random, none of the realistic ones). It happened 0 times in 8,000 real deals, so I left it. A fix would replace
  the greedy loop with the minimax in rulesfuzz.js `refPar` (35x2 states) and pass `h.dealer`.
- js/bots.js:1015-1017: the comment above `exactTricks` describes `claimTopTricks` (it belongs above line 1050). This
  is a cosmetic, misplaced comment. Not moved because bots.js is being edited by the robot agents.
- js/analysis.js `pbnBoard`:
  - `[Date]` is the export date, not the date the board was played.
  - Names are escaped only for `"` (changed to `'`), not for a backslash. PBN strings treat `\` as an escape, so a
    name containing `\` may not read back right in other programs.
  - There is no LIN export (LIN is import only, in js/share.js).
- js/ddplay.js `ddRun` (not my file): when DDS lists one card of a group, `ddRun` copies that result to cards next to
  it in rank. It also counts a card played to the current trick as "already played: still equal". So K and J around
  an opponent's Q in the same trick could share a result. This is only a problem if DDS itself groups them, which it
  should not, because the trick card is known to it. analysis.js `ddRunOf` handles this case conservatively (trick
  cards break a run). I didn't verify this further.
