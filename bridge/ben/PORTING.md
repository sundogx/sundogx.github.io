# PORTING.md: BEN's bot logic in JavaScript

This is the spec for porting BEN's bidding, opening lead and card play to the browser
(`bridge/ben/`, GPL-3.0). It is derived from BEN, github.com/lorserker/ben, by Lorand Dali and
Thorvald Aagaard, at commit `5098782eaac4df07482a1178ce3f6000319fe95e` (2026-11-17), with the
configuration `src/config/BEN-21GF.conf` (BEN's 2/1 Game Forcing system). File and function
references (`botbidder.py: BotBid.bid`, ...) are to BEN's `src/` folder at that commit: read the
code there when this text is unclear. Clone it with
`git clone https://github.com/lorserker/ben && git -C ben checkout 5098782e` (2.3 GB; the models are
plain git files, no LFS).

Sections: **A** models and tensors, **B** bidding, **C** conventions, opening lead and card play,
**D** download size, **E** test vectors.

## A. Models

All 14 networks are in `models/`, listed with byte sizes, sha256 and tensor names/shapes in
`models/manifest.json`. Every input and output is **float32**; batch and time dimensions are dynamic.
The graphs round the inputs to float16 first (BEN feeds float16), so pass exact values.
Weights are stored as float16 (cast to float32 when the session loads).

| file | BEN config key | Keras source (`models/TF2models/`) | inputs | outputs | used for |
|---|---|---|---|---|---|
| `bidder.onnx` | `[bidding] bidder` | `BEN-21GF-8744_2026-11-11-E30.keras` | `x [N,T,193]` | `bid [N,T,40]` softmax | own call; scoring sampled hands; rollouts. Also BEN's `opponent_model` (same file) |
| `binfo.onnx` | `[bidding] info` | `BEN-21GF-8744-Info_2026-11-11-E30.keras` | `x [N,T,193]` | `hcp [N,T,3]`, `shape [N,T,12]` (normalised, linear) | HCP/shape of the other three hands, for sampling; B input of the lead net |
| `lead_nt.onnx` | `[lead] lead_nt` | `LeadV3-NT-Both_2026-10-16.keras` | `x [N,42]`, `b [N,15]` | `lead [N,32]` softmax | opening lead against NT |
| `lead_suit.onnx` | `[lead] lead_suit` | `LeadV3-Suit-Both_2026-10-16.keras` | `x [N,42]`, `b [N,15]` | `lead [N,32]` softmax | opening lead against a suit; also checking samples during play |
| `lefty_nt.onnx`, `lefty_suit.onnx` | `[cardplay] lefty_*` | `lefty_*_hybrid_2026-10-16.keras` | `x [N,T,298]` | `card [N,T,32]` softmax | opening leader (declarer's LHO) |
| `dummy_nt.onnx`, `dummy_suit.onnx` | `[cardplay] dummy_*` | `dummy_*_hybrid_2026-10-16.keras` | same | same | dummy's cards (played by declarer) |
| `righty_nt.onnx`, `righty_suit.onnx` | `[cardplay] righty_*` | `righty_*_hybrid_2026-10-16.keras` | same | same | declarer's RHO |
| `decl_nt.onnx`, `decl_suit.onnx` | `[cardplay] decl_*` | `decl_*_hybrid_2026-10-16.keras` | same | same | declarer's own cards |
| `contract.onnx` | `[contract] contract` | `Contract_2024-12-09-E50.keras` | `x [N,50]` | `contract [N,40]` softmax | rescue bids only (`check_final_contract`) |
| `trick.onnx` | `[contract] trick` | `Tricks_2024-12-09-E50.keras` | `x [N,55]` | `tricks [N,14]` | rescue bids only |

Not converted, because this configuration does not use them: `SD_2024-07-08-E20.keras` and
`RPDD_2024-07-08-E02.keras` (`[eval] estimator = none`, `[lead] double_dummy = True`: candidates are
scored by double-dummy solving, not by the single-dummy estimators).

The sequence models (bidder, binfo, the eight play models) are causal LSTMs: the output at step `t`
depends only on steps `0..t`. Read the **last** step for the decision, as BEN does. You can batch
sequences of the same length together; don't zero-pad shorter ones to a common length unless you read
each one at its own last real step.

Conversion accuracy (`tools/verify.py`, onnxruntime vs BEN's TensorFlow models on up to 400 real input
rows per model recorded from BEN's games): see `check` on each model in `models/manifest.json` (sequence rows are zero-padded to a common length; every step is compared). The conversion
itself is exact (fp32 ONNX: max abs difference about 2e-6); the float16 weights add at most about 4e-3
to a probability, and the top class agrees on 99 to 100% of rows.

Running in the browser: `ort/ort.wasm.min.mjs` (ES module) or `ort/ort.wasm.min.js` (classic worker,
`importScripts`), with `ort.env.wasm.wasmPaths` pointing at `ort/` and `ort.env.wasm.numThreads = 1`
(GitHub Pages can't send COOP/COEP headers, so there is no SharedArrayBuffer). onnxruntime-web 1.31
ships only the SIMD "threaded" wasm build; it runs single-threaded without cross-origin isolation.
`tools/ort-smoke.mjs` runs all 14 models in Node with exactly these files.


## B. Bidding

Source: BEN commit `5098782eaac4df07482a1178ce3f6000319fe95e`, config `src/config/BEN-21GF.conf`
(`model_version = 3`, `n_cards_bidding = 24`, `NS = 1`, `EW = 1`, `alert_supported = False`).
File references are to `src/` in BEN. Config parsing: `nn/models_tf2.py: Models.from_conf` and
`sample.py: Sample.from_conf`.

Models used for bidding:

| role | config key | file | input | output |
|---|---|---|---|---|
| bidder (also used as `opponent_model`: no `[bidding] opponent` key, so the same file) | `[bidding] bidder` | `BEN-21GF-8744_2026-11-11-E30.keras` | `[N, T, 193]` | `[N, T, 40]` softmax |
| bidding info (binfo) | `[bidding] info` | `BEN-21GF-8744-Info_2026-11-11-E30.keras` | `[N, T, 193]` | hcp `[N, T, 3]` linear, shape `[N, T, 12]` linear |
| contract (rescue bids only) | `[contract] contract` | `Contract_2024-12-09-E50.keras` | `[N, 50]` | `[N, 40]` softmax |
| trick (rescue bids only) | `[contract] trick` | `Tricks_2024-12-09-E50.keras` | `[N, 55]` | `[N, 14]` sigmoid |

`[eval] estimator = none`, so the single-dummy models (`SD_…`, `RPDD_…`) are NOT used in bidding;
`double_dummy_calculator = True` means every candidate is scored by double-dummy solving the samples.
No `opponent_info` key, so `opponent_binfo_model = None` and `Sample.predict_bidding_info` uses binfo for all
three other hands.

### BEN conventions used throughout

- Seats: `0 = N, 1 = E, 2 = S, 3 = W` (`'NESW'`). Suits in a hand: `S, H, D, C` (PBN order `"S.H.D.C"`).
- `vuln = [vuln_ns, vuln_ew]` (booleans), `game.py` line ~979.
- The auction is a list of strings, padded at the start with one `'PAD_START'` per seat before the dealer:
  `auction = ['PAD_START'] * dealer_i + calls` (`game.py` ~999). So `auction[i]` was made by seat `i % 4`,
  and it is seat `len(auction) % 4`'s turn. Calls: `'PASS'`, `'X'`, `'XX'`, `'1C'…'7N'` (strain letters
  `C D H S N`).
- Call ids (`bidding/bidding.py: BID2ID`), used for the 40-wide one-hots and the bidder's output:
  `0 PAD_START, 1 PAD_END, 2 PASS, 3 X, 4 XX, 5 1C, 6 1D, 7 1H, 8 1S, 9 1N, 10 2C, … , 39 7N`
  i.e. for a bid `L S`: `id = 5 + (L-1)*5 + 'CDHSN'.index(S)`.
- Hand encoding for bidding, 24 cards (`binary.py: parse_hand_f(24)`, `get_card_index`): per suit 6 slots
  `A K Q J T x`; slot index `suit*6 + rank_slot`; `A=0 K=1 Q=2 J=3 T=4`, and **every card 9..2 adds 1 to
  slot 5** (so slot 5 is a count 0..8, the others 0/1). Suit order S,H,D,C. Vector length 24.
- `hcp(hand)` = 4A+3K+2Q+1J (from slots 0..3 of each suit; `binary.get_hcp`). `adjust_hcp = False`, so
  the plain count is used. `shape(hand)` = sum of the 6 slots per suit (S,H,D,C).
- RNG: `BotBid.get_random_generator()` = `np.random.default_rng(calculate_seed(hand_str))`, where
  `util.calculate_seed` = first 4 bytes (big-endian) of SHA-256(hand_str) mod (2^32-1). It is re-created at
  the start of every `bid()` and every `sample_hands_for_auction()`. A JS port cannot reproduce numpy's PCG64
  streams cheaply; use the app's `seededRand` with the same kind of seed and accept that sampled results
  differ from BEN (the vectors flag which outputs are seed-dependent).

### 1. Input tensor for bidder and binfo (193 features per time step)

Built by `binary.py: get_auction_binary` (bidder, own hand; called via `BotBid.get_binary`) and
`binary.py: get_auction_binary_sampling` (binfo, rollouts and sample scoring). Both give the same layout:

| slots | content |
|---|---|
| 0 | bidding system of **our** side (`ns` if hand_ix is N/S, else `ew`) — here always 1 |
| 1 | bidding system of **their** side — here always 1 |
| 2 | we are vulnerable: `vuln[hand_ix % 2]` |
| 3 | they are vulnerable: `vuln[(hand_ix + 1) % 2]` |
| 4 | `(hcp - 10) / 4` |
| 5..8 | `(suit_length - 3.25) / 1.75` for S, H, D, C |
| 9..32 | the 24-card hand vector (A K Q J T x per suit, S H D C) |
| 33..72 | one-hot (40) of **my own previous call** (the call 4 positions back) |
| 73..112 | one-hot of **LHO's** call (3 back) |
| 113..152 | one-hot of **partner's** call (2 back) |
| 153..192 | one-hot of **RHO's** call (1 back) |

(The code builds 191 features `[vuln(2), hcp, shape(4), hand(24), 4×40]` and then *prepends* the two
system values with `np.pad`, which is why vuln starts at 2. In the training-time encoder
`bidding/binary.py: DealData.get_binary` the order is the same: `[ns_ew(2), vuln(2), hcp, shape(4),
hand(24), my, lho, partner, rho]`.)

Slots 0..8 and the hand are the same at every time step. Positions with index < 0 are `PAD_START`
(one-hot id 0); positions past the end of the auction are `PAD_END` (id 1); a `'PAD_START'` entry in the
padded auction encodes as id 0 too.

Sequence layout (one sequence per player, one step per turn of *that* player):

```
// auction: padded list, hand_ix: the seat whose sequence this is, n_steps: number of its turns
bid_i = hand_ix
while (auction[bid_i] == 'PAD_START') bid_i += 4      // skip turns before the dealer
for step in 0..n_steps-1:
    my  = auction[bid_i-4] (or PAD_START if bid_i-4 < 0)
    lho = auction[bid_i-3] ; pard = auction[bid_i-2] ; rho = auction[bid_i-1]   // same rule
    (beyond the end of auction -> PAD_END)
    X[step] = [sys_us, sys_them, vul_us, vul_them, hcp_n, shape_n(4), hand24, oh(my), oh(lho), oh(pard), oh(rho)]
    bid_i += 4
```

So step `t` holds the four calls made *before* the player's `t`-th turn (its own previous call and the
three since), and the network's output at step `t` is the prediction of the call at that turn.

Number of steps:
- **Bidder, own turn** (`BotBid.get_bid_number_for_player_to_bid`): with `i` = first index of our seat that
  isn't `PAD_START`, `n_steps = 1 + (len(auction) - i) // 4`. **Read the output at the last step**
  (`next_bid_np`, model_version 3: `bid_np[0][-1]`).
- **Binfo** (`binary.calculate_step_bidding_info`): `bids` = number of entries that are not
  PAD_START/PAD_END; `n_steps = 1 if bids == 0 else 1 + bids // 4`. It equals the bidder's count when it is
  that seat's turn. Read the last step.
- **Sample scoring** (`sample.py: sample_cards_auction`): `n_steps = binary.calculate_step_bidding(auction)
  = 1 + (len(auction) - 1) // 4` (len including PAD_START; 1 if empty). Extra steps beyond a player's
  calls read PAD_END and are ignored (see below).

Inputs are fed as float16 in BEN (`tf.TensorSpec(..., tf.float16)` in `nn/bidder_tf2.py`,
`nn/bid_info_tf2.py`); the converted ONNX models take float32 and round to fp16 internally (see the
manifest), so the port can pass exact float32 values.

### 2. Output decoding

- **Bidder**: 40 probabilities indexed by `BID2ID` (above). Ids 0 and 1 (PAD) should never be chosen; the
  candidate loop filters with `bidding.can_bid`, which rejects anything that isn't PASS/X/XX/a bid.
  `alert_supported = False`: the model has one output, no alert head.
- **Binfo**: `hcp[3]` = LHO, partner, RHO (relative to the encoded player: `(hand_ix+1)%4`,
  `(hand_ix+2)%4`, `(hand_ix+3)%4`); `shape[12]` = LHO S,H,D,C, partner S,H,D,C, RHO S,H,D,C
  (`bidding/binary.py: get_binary_hcp_shape` defines the training targets). De-normalise
  (`sample.py: Sample.get_bidding_info`): `hcp = 4*x + 10`, `len = 1.75*x + 3.25`.
- **Contract** (input 50 = `[vul_we, vul_them]` + our 24-card hand + partner's 24-card hand,
  `BotBid.get_binary_contract(seat, vuln, hand_str, partner_str, 24)`): 40 softmax over `BID2ID`; only ids of
  bids are meaningful.
- **Trick** (input 55 = the same 50 + strain one-hot in `N S H D C` order): 14 sigmoid outputs, index =
  tricks taken by our side (declarer).

### 3. `BotBid.bid(auction)` (botbidder.py)

Config values (BEN-21GF.conf):

| key | value | used in |
|---|---|---|
| `search_threshold` | `[0.10, 0.07, 0.06, 0.05, 0.04, 0.03, 0.03]` | `get_min_candidate_score(bid_no)` = `list[bid_no-1]` if `bid_no < 7` else `list[-1]` |
| `no_search_threshold` | 2 (scalar) | `do_rollout`: skip simulation if top NN score > 2 — never happens |
| `eval_after_bid_count` | -1 | disabled |
| `eval_opening_bid` | True | simulate the opening bid too |
| `eval_pass_after_bid_count` | -1 | disabled |
| `min_passout_candidates` | 2 | |
| `use_biddingquality` | True | |
| `no_biddingquality_after_bid_count` | 12 | (read into Sample; not used on the paths below) |
| `use_probability` | True | play only |
| `check_final_contract` | True | rescue bids |
| `max_samples_checked` | 20 | rescue |
| `min_rescue_reward` | 500 | rescue |
| `max_estimated_score` | 1430 | rescue |
| `min_bidding_trust_for_sample_when_rescue` | 0.55 | rescue |
| `min_samples_for_rescue` | 15 | rescue |
| `alert_supported` / `alert_threshold` | False / 0.8 | unused |
| `adjust_hcp` | False | |
| `use_adjustment` | True | |
| `adjust_NN` / `adjust_NN_undisturbed` / `adjust_NN_Few_Samples` | 60 / 200 / 100 | |
| `adjust_XX` / `adjust_X` / `adjust_X_remove` | 200 / 100 / 25 | |
| `adjust_passout` / `adjust_passout_negative` | -100 / 0.5 | |
| `adjust_min1`, `adjust_min2`, `adjust_min1_by`, `adjust_min2_by` | 0.002, 0.0002, 200, 200 | |
| `factor_to_translate_to_mp` / `factor_to_translate_to_imp` | 500 / 25 | |
| `matchpoint` | False (teams/IMPs) | |
| `[eval] double_dummy_calculator` | True | |
| `[eval] use_real_imp_or_mp_bidding` | True | |
| `[eval] estimator` | none | |
| `[sampling] use_distance` | True | |
| `[sampling] bidding_threshold_sampling` | 0.70 | |
| `[sampling] bid_accept_threshold_bidding` | 0.40 | rescue/quality gate, warnings |
| `[sampling] sample_hands_auction` | 50 | |
| `[sampling] min_sample_hands_auction` | 15 | |
| `[sampling] sample_boards_for_auction` | 20000 | |
| `[sampling] sample_boards_for_auction_step` | 2000 | |
| `[sampling] increase_for_bid_count` | 6 | |
| `[sampling] exclude_samples` | 0.01 | |
| `[sampling] no_samples_when_no_search` | True | |
| `[sampling] sample_previous_round_if_needed` | True | |
| `[sampling] hcp_reduction_factor` / `shp_reduction_factor` | 0.83 / 0.3 | |
| `[cardplay] use_biddinginfo` | True | sampler uses binfo |
| `[sampling] warn_to_few_samples` | 10 | log only |
| BBA: `use_bba`, `consult_bba`, `bba_trust`, `use_bba_rollout`, `use_bba_to_count_aces` | False, True, 0.2, True, True | **treat all as off in JS** (see §4) |

Pseudocode (BBA off; verbose/printing removed):

```
bid(auction):
  rng = default_rng(seed(hand_str))
  my_bid_no = get_bid_number_for_player_to_bid(auction)          // 1 on our first turn
  candidates, passout = get_bid_candidates(auction)
  quality = 1; samples = []
  generate = (bids(auction) > 4 and check_final_contract) or len(candidates) > 1
             // bids() = number of non-PAD entries (binary.get_number_of_bids)
  if generate:
     hands_np, scores, _, _, quality = sample_hands_for_auction(auction, seat)
     sample_count = hands_np.shape[0]
  else sample_count = 0

  if do_rollout(auction, candidates, 2, sample_count):
     hands_pbn = translate_hands(hands_np)          // fill the 'x' pips at random, rotate so our hand is first
     for c in candidates:
        auctions = bidding_rollout(auction, c.bid, hands_np)      // finish the auction on each sample
        contracts, tricks1hot = expected_tricks_dd(hands_pbn, auctions)   // DDS, declarer tricks
        ev = expected_score(seat, contracts, tricks1hot)          // per sample, our side's score
        ev_scores[c.bid] = ev
        expected_score = mean(ev); expected_tricks = mean(declarer tricks)
        adjust = adjustments(c, ev, expected_score)                // below
        c.expected_score = mean(ev after the X trim, see below); c.adjust = adjust
     // use_real_imp_or_mp_bidding and double_dummy_calculator: IMPs
     imp = calculate.calculate_imp_score(ev_scores)              // round robin, see below
     for c: c.expected_imp = imp[c.bid]; c.adjust = c.adjust / 25
     trust = !(quality < 0.70 or sample_count < 15)
     sort candidates by (expected_imp + adjust, round(insta, 2)) desc   if trust
                    else (insta, expected_imp + adjust) desc
  else:
     // no simulation: candidates stay in NN order (highest insta_score first)
     if evaluate_rescue_bid(...): compute candidates[0].expected_score from DD on the samples with the
        current auction + passes (auction_np padded with PAD_END) – same expected_tricks_dd/expected_score
  if evaluate_rescue_bid(auction, passout, samples, candidates[0], quality, my_bid_no): try_rescue()
  return candidates[0].bid
```

`do_rollout(auction, candidates, max_score, sample_count)`: false if `candidates[0].insta > 2` (never);
false if only one candidate; if no bid has been made yet (`get_contract(auction) is None`, i.e. opening
or passes only) return `eval_opening_bid` (True); false if `sample_count == 0`; else true.
(Edge: an opening with several candidates and 0 samples would assert in `bidding_rollout`; can't happen in
practice because with no bids `sample_cards_auction` accepts every random deal.)

#### get_bid_candidates (BBA off)

```
p = next_bid_np(auction)            // bidder output at the last step, 40 values
no_bids = bids(auction)
min_score = thr(my_bid_no)
if no_bids > 3 and auction[-1] == 'PASS':          // "passout" — note: true whenever RHO passed after
    min_candidates = 2                             //   at least 4 calls, not only in the pass-out seat
    min_score = thr(my_bid_no + 1)
    passout = True
else:
    min_candidates = 1                             // eval_after_bid_count = -1
// (preempted is only set from BBA explanations: false here)
candidates = []
loop:
    i = argmax(p)
    if p[i] < min_score:
        if len(candidates) >= min_candidates: break
        if p[i] <= 0.01: break
    if can_bid(ID2BID[i], auction): candidates.append((ID2BID[i], insta=p[i]))
    elif len(candidates) > 0: break               // an illegal call stops the search once we have one
    p[i] = 0
if candidates empty: take the highest-scoring legal call from the original p
return candidates, passout
```

`can_bid` (`bidding/bidding.py`): PASS always; X if the last entry is a bid or the last three are
`bid, PASS, PASS`; XX if the last is X or `X, PASS, PASS`; a bid if higher than the last bid. PAD_START
entries are never bids.

#### Sampling hands (`sample_hands_for_auction` → `Sample.generate_samples_iterative`)

```
max_boards = 20000; needed = 50
f = (number of calls that aren't PASS/PAD) // 6;  if f > 0: max_boards = round(1.5**f * max_boards)
step = 2000; done = 0; found = 0; quality_sum = 0; extend = false
while done < max_boards and found <= needed:
    S, scores, c_hcp, c_shp, q = sample_cards_auction(auction, seat, hand, vuln, step, extend)
    found += len(S); quality_sum += q * len(S); keep S, scores
    done += step
    extend = done + 3*step >= max_boards
    if found < needed and extend: step = 6000
quality = found == 0 ? -1 : quality_sum / found
(sample_previous_round_if_needed: if quality < 0.40 and >= 8 calls, retry with the opponents' last doubles
 turned into passes; if < 15 samples and >= 12 calls, retry without the last round; needed /= 4)
then: if found >= 50 pick 50 at random (rng.permutation); sort by score descending.
hands_np[n, seat] = our hand; hands_np[n, (seat+k)%4] = sample hand k-1 (k = 1 LHO, 2 partner, 3 RHO)
```

`sample_cards_auction(auction, nesw_i, …, n_samples)`:
1. `c_hcp, c_shp` = binfo for our seat at the last step, de-normalised (computed once per `bid`, reused for
   later blocks).
2. `sample_cards_vec(n, c_hcp, c_shp, my_hand24)` deals the 3 hidden hands in the 24-card encoding:
   - Deck: per suit A K Q J T (one each) + 8 "x". Missing honours (`A`,`K` of each suit not in our hand) are
     dealt first in random order; each goes to hand `r` with probability ∝
     `(max(r_shp[r][suit],0)+0.1)/Σ * (max(r_hcp[r],0)+0.1)/Σ` renormalised (`distr_ak_vec`), starting from
     `r_hcp = c_hcp`, `r_shp = c_shp`; after a card, `r_hcp[r] -= 3 * hf` with
     `hf = round(0.83 * sum(c_hcp) / missing_hcp, 2)` (`missing_hcp = 40 - our hcp`) and
     `r_shp[r][suit] -= 0.3`. A hand that already has 13 cards can't receive (the card is retried).
   - Then the remaining cards (Q, J, T and the x's, in random order) go by shape only (`distr_vec` on
     `r_shp`), with the same `-0.3` shape update.
   - Filter: for each hidden hand i, if `round(c_hcp[i]) >= 11` require `hcp >= round(c_hcp[i]) - 5`; for each
     suit, if `round(c_shp[i][j]) < 2` (note: the code rounds the boolean `c_shp<2`, effectively
     `c_shp < 2`) require `len <= round(c_shp)+1`; if `c_shp >= 6` require `len >= round(c_shp)-1`. Keep the
     filtered set only if at least half the deals pass, else keep all.
   - (`aceking` constraints come from BBA only: empty → no extra filter, `generate_samples = n_samples`.)
3. If nobody but us has called yet (`total_bid_count == 0`): accept everything, quality 1, scores 1.
4. Otherwise score each deal by how well the bidder explains the other three players' actual calls
   (`process_bidding`, in the order partner, RHO, LHO; partner is scored with `bidder_model`, the opponents
   with `opponent_model` — the same network here): build that player's sequence with
   `get_auction_binary_sampling(n_steps, auction, (nesw_i+pos)%4, our_hand, …)` and overwrite slots 4
   (hcp), 5..8 (shape) and 9..32 (hand) with the sampled hand; run the bidder; `min_score` = minimum over
   the player's real calls (`bidding.get_bid_ids`, skipping PAD) of the predicted probability of the call
   actually made. Drop deals with `min_score < exclude_samples (0.01)`.
5. `use_distance = True`:
   `distance = (1-m_lho)*n_lho + 2*(1-m_pard)*n_pard + (1-m_rho)*n_rho`,
   `max_distance = n_lho + 2*n_pard + n_rho` (n_* = number of calls each made, excluding PAD),
   `score = (max_distance - distance) / max_distance`. Sort by score descending; accept score >= 0.70.
   If fewer than 15 and `extend`, take the 15 best regardless. `quality = mean(score of accepted)`.

#### Rollout (`bidding_rollout`, BBA rollout off)

For each sample, append the candidate call and finish the auction greedily: at each turn build the
sequence for the seat to call (`get_auction_binary_sampling` with that seat's sampled 24-card hand; its
own step count, incremented each turn), run the bidder (`opponent_model` on even `bid_i` = the opponents
of the candidate's bidder, `bidder_model` on odd — same network), take the argmax over the last step;
if the argmax is an illegal call (id > 2 and `!can_bid`), zero it and retake the argmax (PASS is always
legal); once the sample's auction is over, emit PAD_END (id 1). Up to 64 entries.

#### Scoring a candidate

- `translate_hands`: rebuild 52-card PBN deals: our real hand first, then the sampled hands of seat+1,
  +2, +3 (`deck52.handxxto52str`), the `x` placeholders replaced with the actual missing pips 9..2 at
  random (`deck52.convert_cards`), PBN `"N:"` + hands. (So "N" in this PBN is *us*; leaders are rotated
  by `-seat`.)
- `expected_tricks_dd`: for each finished auction, `contract = bidding.get_contract` (e.g. `"4HXS"` = 4♥
  doubled by South); if passed out → `"PASS"`, score 0. Else DDS with trump = strain, leader =
  declarer's LHO, no cards played; declarer tricks = 13 − (leader side's max tricks).
- `expected_score(seat, contracts, tricks)` (per sample): `scoring.score(contract, declarer_vul, tricks)`
  (standard duplicate score, no part-score carry-over, doubled/redoubled from the contract string),
  negated if the declarer is on the other side.
- IMPs (`calculate.calculate_imp_score` → `_round_robin_score`): for each candidate i,
  `imp_i = Σ_{j≠i} Σ_k signed_imps(ev_i[k] − ev_j[k]) / (K * (n−1))` (K samples, equal weights, rounded to
  2 decimals); with one candidate the value is 0. `diff_to_imps` is the standard IMP table
  (≤10 → 0, ≤40 → 1, ≤80 → 2, ≤120 → 3, ≤160 → 4, ≤210 → 5, …).

Adjustments (in points, later divided by 25 for IMPs), in this order:

```
adjust = 0
if insta < 0.002: adjust -= 200
if insta < 0.0002: adjust -= 200
if bid level not 5/6/7:
    if sample_count <= 15:          adjust += 100 * insta
    elif undisturbed(auction):      adjust += 200 * insta    // opponents made no X/XX/bid (BID2ID > 3) in auction[::-2]
    else:                           adjust += 60  * insta
// (penalty-X control check needs BBA's explanation: skipped)
if passout and insta < 0.10:
    if call is a bid: adjust += expected_score < 0 ? 0.5 * expected_score : -100
    if call == X:
        ev = sorted(ev)[:-floor(len*25/100)]        // drop best 25% (only affects c.expected_score)
        if they are vulnerable: adjust -= expected_score < 200 ? 200 : 100
        else:                   adjust -= expected_score < 100 ? 200 : 100
    if call == XX: adjust -= we are vulnerable ? 400 : 200
else:
    if call == X and insta < 0.5 and bids(auction) > 4:
        adjust -= current_level > 5 ? 200 : 100
if call == X and insta < 0.1: adjust -= 200
```

(`expected_score` above is the untrimmed mean; "they vulnerable" is `vuln[(seat+1)%2]`.)

#### Rescue bid (`evaluate_rescue_bid` + the block after it; uses contract + trick models)

Only when all hold: `check_final_contract`; ≥ 15 samples; ≥ 4 calls in the auction; `candidates[0]` is
PASS; `quality > 0.40`; and either `passout`, or (`my_bid_no >= 2`, and if `my_bid_no < 3` RHO's call id
≥ 14 i.e. 2NT or higher) with `candidates[0].expected_score` None or < 1430.

Then: take the samples whose bidding score ≥ 0.55 (if fewer than 15, none); pick up to 20 at random. For
each: contract model on `[vul_we, vul_them, our24, partner24]`; for each contract id with p > 0.2, trick
model on the same input + strain one-hot (`NSHDC`), take the most likely trick count among outputs > 0.1;
keep the contract with the highest p that has a trick count. Raise its level by 5 ids until biddable.
Stop (no rescue) if it's 5 of our 4♥/4♠ game, 4N/5N/6N over 3N, 7N over 6N, the current contract, or
already a candidate. Score it `scoring.score(contract + ('X' if going down), our_vul, tricks)`.
If more than 75% of the checked samples produced an alternative, take the most frequent contract; if its
average score > `candidates[0].expected_score + 500` (or its average tricks − expected tricks > 4), DD-solve
up to 20 samples with the auction + that call, take min(expected score, expected score if doubled); if
that still beats `expected_score + 500` (or the tricks test), bid it ("Rescue").

### 4. Native libraries and what the JS port does instead

- **BBA (EPBot, Windows .NET DLL, closed source)**: `consult_bba = True`, `use_bba_to_count_aces = True`,
  `use_bba_rollout = True`, `bba_trust = 0.2` in the config. Not available in a browser: **set all to
  False / 0**. Effects with BBA off:
  - `get_bid_candidates` is pure NN (no BBA candidate added with +0.2 trust, no "BBA - Keycard" forced
    answers, no "Forcing"/"GF"/"5NT pick a slam" pass suppression, `preempted = False`).
  - `bidding_rollout` uses the NN greedy rollout (the `else` branch) instead of BBA's.
  - `aceking = {}` in sampling (no ace/king-count filter).
  - `explain()` returns None: no BBA explanations or alerts, and the penalty-double control adjustment is
    skipped. The app's own `describeCall()` can explain calls instead.
  - When sampling finds 0 samples, BEN would ask BBA; JS just keeps the NN's top candidate.
  - Expect BEN's slam bidding (keycard answers) to be weaker than BEN-with-BBA.
- **DDS** (`ddsolver/ddsolver.py`, dds3 native): use the app's DDS wasm (`js/dds-worker.js`) with
  `solutions = 1`: trump = strain, first = declarer's LHO, no current trick; take declarer tricks.
  BEN solves 50 deals × up to ~4 candidates per decision; budget accordingly (batch by (strain, leader),
  reduce `sample_hands_auction` on phones if needed and record that as a deviation).
- **TensorFlow**: replaced by onnxruntime-web on the ONNX files in `bridge/ben/models/`.

## C. Conventions, opening lead and card play

Source: BEN, github.com/lorserker/ben, commit `5098782eaac4df07482a1178ce3f6000319fe95e`,
config `src/config/BEN-21GF.conf`. All paths below are relative to `src/` in BEN.
File:function references are the place to read the exact code when this text is unclear.

### 0. Conventions (BEN vs this app)

#### Seats
- **Absolute seats**: `N=0, E=1, S=2, W=3` (`'NESW'`), same order as the app's `SEATS`.
  The dealer index `dealer_i` uses the same numbering.
- **Vulnerability**: a 2-list `vuln = [vuln_ns, vuln_ew]` of bools. For a seat `i`:
  `vuln_us = vuln[i % 2]`, `vuln_them = vuln[(i + 1) % 2]`.
  App: `'None'→[F,F]`, `'NS'→[T,F]`, `'EW'→[F,T]`, `'Both'→[T,T]`.
- **Card-play seats are relative to declarer** (`game.py:Game.play`, `botcardplayer.py:CardPlayer`):
  `player_i: 0 = lefty (LHO of declarer, the opening leader), 1 = dummy, 2 = righty, 3 = declarer`.
  `sample.py:player_to_nesw_i(player_i, contract) = (decl_i + player_i + 1) % 4`.
  `leader_i`, `trick_winner`, the one-hot "last trick leader" and DDS's `first` all use these
  declarer-relative indices.
- **Bidding-sampling seats are relative to the hand on turn**: `lho_pard_rho[:, 0/1/2, :]`
  = LHO, partner, RHO of the player (for the opening lead: 0 = dummy, 1 = leader's partner, 2 = declarer).

#### Suits and strains
- **Card suits**: `S=0, H=1, D=2, C=3` everywhere in card encodings (`'SHDC'`, `deck52.py`).
  Hand strings are `'S.H.D.C'` (spades first).
- **Strain index for play/lead** (`bidding/bidding.py:get_strain_i`): `'NSHDC'.index(strain)`,
  i.e. `N=0, S=1, H=2, D=3, C=4`. The trump suit index is `strain_i - 1`.
  DDS trump (`ddsolver/ddsolver.py:solve_helper`) is `(strain_i - 1) % 5` → `S=0,H=1,D=2,C=3,NT=4`.
- **Bidding order** (`bidding/bidding.py`): `SUITS = 'CDHSN'` (clubs lowest), used only in bid ids.

#### Cards and ranks
- **Rank index**: `'AKQJT98765432'.index(r)` → `A=0 … 2=12` (ace first). A *higher code is a lower card*.
- **52-card code**: `suit*13 + rank` (`deck52.encode_card('SA') = 0`, `'C2' = 51`).
- **32-card code (play, lead)**: 8 slots per suit `A K Q J T 9 8 x`; `x` = any of 7..2.
  `deck52.card52to32(c) = (c//13)*8 + min(7, c%13)`, `card32to52(c) = (c//8)*13 + c%8`
  (a 32-code `x` maps back to the 7, so never use `card32to52` on an `x` without choosing a pip).
  A 32-card *hand vector* holds counts: the `x` slot can be 0..6.
- **24-card code (bidding, bidding-info, sampling during auction/lead)**: 6 slots `A K Q J T x`,
  `x` = 9..2 (count 0..8). `card32to24(c) = (c//8)*6 + min(5, c%8)`.
  `binary.convert_hands(h, 32, 24)` converts hand vectors (9 and 8 fold into x).
- `binary.parse_hand_f(n)(hand_str)` builds a `(1, n)` count vector from `'AK32.T9.876.Q54'`;
  any character not in `AKQJT98765432` (e.g. `'x'`) counts as the last slot.
- `deck52.hand32to52str`, `handxxto52str(h, n)` produce strings like `'AKQx.Txx..Jxxx'`.

#### App mapping (bridge/js/engine.js)
- App card `'SA'` (suit letter + rank in `'23456789TJQKA'`) → BEN 52 code
  `'SHDC'.indexOf(card[0])*13 + 'AKQJT98765432'.indexOf(card[1])`.
- App hand (array of cards) → BEN hand string: per suit in S,H,D,C order, ranks sorted A..2, joined by `.`.
- App auction `[{call, by}]` with calls `'P','X','XX','1C'..'7N'` → BEN list:
  `['PAD_START']*dealer_i + [call == 'P' ? 'PASS' : call ...]`. The strain letters are the same
  (`N` = notrump). With this padding, `auction[i]` was made by absolute seat `i % 4`.
- BEN contract string (`bidding.get_contract`): `level + strain + ('X'|'XX'|'') + declarer`,
  e.g. `'4HXS'`. Note `'X' in contract` is true for both X and XX.
- App play: `play.tricks[k] = {leader, cards: [{seat, card}]}` with absolute seats. Convert seats to
  declarer-relative `player_i = (SEATS.indexOf(seat) - decl_i + 3) % 4`.

### 1. Opening lead network

Models (config `[lead]`): `lead_nt = LeadV3-NT-Both_2026-10-16.keras` when the contract strain is `N`,
otherwise `lead_suit = LeadV3-Suit-Both_2026-10-16.keras` (`botopeninglead.py:get_opening_lead_candidates`,
`contract[1] == 'N'`). Both: inputs `X_input [N,42]` and `B_input [N,15]` (Keras dtype float16:
BEN rounds inputs to fp16), output `lead_softmax [N,32]` (softmax). Called as `model([x, b])`
(`nn/leader_tf2.py`), list order X then B.

#### X (42), `binary.py:get_auction_binary_for_lead`
| slot | value |
|---|---|
| 0 | contract level (1..7, raw integer) |
| 1..5 | strain one-hot, `x[1 + strain_i]`, order N,S,H,D,C |
| 6 | doubled: 1 if the contract is X **or** XX |
| 7 | redoubled: 1 if XX |
| 8 | vuln of the leader's side (`vuln[lead_index % 2]`) |
| 9 | vuln of declarer's side (`vuln[decl_index % 2]`) |
| 10..41 | leader's hand, 32-card counts (S AKQJT98x, H …, D …, C …) |

`decl_index = 'NESW'.index(contract[-1])`, `lead_index = (decl_index + 1) % 4`.

#### B (15), `binary.py:get_shape_for_lead`
The bidding-info network (`[bidding] info = BEN-21GF-8744-Info_2026-11-11-E30.keras`) run for the leader:
1. `n_steps = binary.calculate_step_bidding_info(auction)`: `bids` = number of entries that are not
   `PAD_START`/`PAD_END` (passes count); `n_steps = 1 if bids == 0 else 1 + bids // 4`.
2. `A = binary.get_auction_binary_sampling(n_steps, auction, lead_index, hand24, vuln, models, 24)`,
   shape `[1, n_steps, 193]` (layout in the bidding section; summary: `[0]` our system (1), `[1]`
   their system (1), `[2:4]` vuln us/them, `[4]` (hcp-10)/4, `[5:9]` (suit length-3.25)/1.75 for S,H,D,C,
   `[9:33]` 24-card hand, `[33:193]` four 40-way one-hots: my previous call, LHO's, partner's, RHO's
   in that bidding round).
3. `p_hcp [1, n_steps, 3]`, `p_shp [1, n_steps, 12]` = binfo outputs. Take the **last step**, raw (still
   normalised; do **not** apply `4x+10` / `1.75x+3.25` here):
   `B[0:3] = p_hcp[0,-1,:]` (LHO=dummy, partner, RHO=declarer, relative to the leader),
   `B[3:15] = p_shp[0,-1,:]` (3 hands × S,H,D,C).

#### Output decoding
`lead_softmax[0, c]`, `c` = 32-card code. BEN masks it to the cards held and renormalises:
`util.follow_suit(softmax, hand32, [[0,0,0,0]])` = `softmax * (hand32 > 0)` then divide by the sum
(if the sum < 1e-9 divide by 1).

#### Which actual card (pip choice), `botopeninglead.py:find_opening_lead` + `carding.py:select_right_card`
After the candidate is chosen (section 2) as a 32-code `L`:
- if `L % 8 <= 5` (A,K,Q,J,T,9): play `card32to52(L)`.
- if `L % 8 in (6, 7)` (the 8 or an `x`): `carding.select_right_card(hand52, L, rng, contract, models)`:
  - NT, `lead_from_pips_nt = "24"`, suit length > 1 → `lead_pip_24`:
    `Tx` with no honour → T; length < 4: no honour and holds T → 2nd highest; doubleton → highest;
    3 cards → highest if the top two touch, else 2nd highest; length ≥ 4: no HCP → 2nd highest,
    else 4th highest. (Highest = 1st occurrence scanning A→2.)
  - suit contract, leading **trump** → the lowest card of the suit.
  - suit contract, `lead_from_pips_suit = "135"` → `lead_pip_135`: length < 3 → highest; 3–4 → 3rd highest;
    5+ → 5th highest.
  - fallback (e.g. NT singleton): if `L % 8 == 7` a random pip 7..2 from the suit (`rng.choice`), else the 8.
  Note the rule can return a card above the 8 (e.g. KQJ8, NN says 8, 135 → J). Port it literally.
- `rng` = `np.random.default_rng(calculate_seed(hand_str))`, `util.calculate_seed(s)` =
  first 4 bytes of `sha256(s)` big-endian, `% (2**32 - 1)`. NumPy PCG64 streams are not reproduced
  in JS; random steps only matter for singleton-x leads and pip filling, see section 6.

### 2. How BotLead picks the lead (`botopeninglead.py:BotLead.find_opening_lead`)

Parameters (BEN-21GF.conf):

| param | value | role |
|---|---|---|
| `lead_threshold` | 0.20 | candidates: masked softmax ≥ this… |
| `min_opening_leads` | 4 | …but always at least 4 candidates |
| `lead_accept_nn` | 0.999 | lead the top NN card outright if above |
| `double_dummy` | True | evaluate candidates double dummy (not the SD network) |
| `use_real_imp_or_mp_opening_lead` | True | rank by round-robin IMPs |
| `matchpoint` | False | IMPs |
| `sample_boards_for_auction_opening_lead` | 10000 | max layouts generated |
| `sample_hands_opening_lead` | 100 | layouts used |
| `sample_boards_for_auction_step` | 2000 | generation block |
| `increase_for_bid_count` | 6 | max boards × 1.5^(non-pass bids // 6) |
| `bidding_threshold_sampling` | 0.70 | keep layouts with bidding score ≥ |
| `min_sample_hands_auction` | 15 | else take the best 15 |
| `exclude_samples` | 0.01 | drop if any seat's call prob < |
| `use_distance` | True | bidding score by weighted distance |
| `hcp_reduction_factor` / `shp_reduction_factor` | 0.83 / 0.3 | dealing bias |
| `use_biddinginfo` | True | deal from binfo HCP/shape |
| `use_biddingquality_in_eval` | True | NN only if quality < 0 (no samples) |
| `reward_lead_partner_suit` | 0.5 | IMP bonus |
| `trump_lead_penalty` | [0.2, 0.2, 0.5, 0.2] | IMP penalties |
| `lead_from_pips_nt` / `_suit` | 24 / 135 | spot card |
| `sample_previous_round_if_needed` | True | retry with partner's X→P etc. (long auctions only) |

Algorithm:
```
softmax = follow_suit(leadNN(X, B), hand32)                      # section 1
cands = []; s = copy(softmax)
loop: c = argmax(s); if s[c] < 0.20 and len(cands) >= 4: break; cands.push(c); s[c] = 0
samples, scores, quality = sampler.generate_samples_iterative(auction, lead_index, 10000, 100, rng, hand_str, vuln, models, [], aceking={})
if len(samples) > 100: pick 100 without replacement, p ∝ scores (rng = fresh default_rng(seed))
for each candidate c (32-code):
    lead52 = c%8==7 ? random pip of that suit (fresh rng) : card32to52(c)
    for each sample: PBN 'N:' + (leader hand minus lead52) + ' ' + dummy + ' ' + partner + ' ' + declarer
        (sample hands are 24-card; deck52.convert_cards replaces each 'x' by a random unused pip 2..9,
         a fresh rng per sample)
    DDS SolveBoard(trump=(strain_i-1)%5, first=0, currentTrick=[lead52], solutions=1, target=-1):
        declTricks[sample] = score[0]   # side to play next = dummy = declaring side
    defTricks = 13 - declTricks
    real[c][sample] = -score(contract, declVul, declTricks)       # calculate.calculate_score(.., 0, 0, ..)
imp[c] = calculate.calculate_imp_score(real)   # round robin, see below
suit_adjust[0..3] = 0
  + 0.5 to partner's suit: bidding.get_partner_suit = suit of partner's FIRST contract bid (NT → none)
  - in a suit contract, trump suit: -0.2; extra -0.2 if trumps == 'A' singleton, -0.5 if 'K', -0.2 if 'Q'
  - level ≥ 6: a suit headed by Q without J: -1; headed by J without T: -0.5
expected_score_imp[c] = round(imp[c], 2) + suit_adjust[c // 8]
sort cands by NN softmax desc
if top softmax > 0.999 → lead it                               ("NN - best")
elif quality < 0 (no samples) → lead the NN top                 ("NN - bad quality samples")
else sort by (expected_score_imp, round(softmax, 2)) desc → lead the first ("Simulation (IMP)")
then choose the actual card (section 1)
```
`calculate_imp_score(data)` (`calculate.py:_round_robin_score` with `_imp_value`): for every pair of
candidates i≠j and every sample k add `sign(d)·diff_to_imps(|d|)` with `d = data[i][k] - data[j][k]`
(sign + for d ≥ 0), divide by `n_samples·(n_cands-1)`, round to 2 decimals. One candidate → 0.
`scoring.diff_to_imps` is the standard IMP table (0–10 → 0, 20–40 → 1, …).
`scoring.contract_scores_by_trick(contract, vuln)` = `score(contract, declarer_vul, tricks)` for 0..13
(declarer's score; doubled/redoubled included).

#### Sampling layouts from the auction (`sample.py:generate_samples_iterative` → `sample_cards_auction`)
Shared with the bidder (see the bidding section for detail); summary for the lead:
1. binfo for the leader (`get_bidding_info`): `c_hcp = 4·p_hcp + 10` (LHO, partner, RHO),
   `c_shp = 1.75·p_shp + 3.25` (3×4).
2. `sample_cards_vec(2000, c_hcp, c_shp, hand24, rng, aceking, 24)`: deal the 24-card deck minus our hand
   (`x` slots hold 8 cards each). First the missing A and K (8 cards, shuffled order), each to hand
   `h` with probability ∝ `(max(shp[h][suit],0)+0.1)/Σ · (max(hcp[h],0)+0.1)/Σ` renormalised
   (`distr_ak_vec`), a full hand (13) can't receive; after each, `hcp[h] -= 3·f` with
   `f = round(0.83·Σc_hcp/missing_hcp, 2)` and `shp[h][suit] -= 0.3`. Then all other cards (Q, J, T and
   each x copy, shuffled) by shape only (`distr_vec`), `shp -= 0.3`. Then a loose filter: if
   `round(c_hcp[h]) ≥ 11` need `hcp ≥ round(c_hcp)-5`; if `round(c_shp) < 2` need length ≤ round+1;
   if ≥ 6 need length ≥ round-1; filter applied only if at least half pass.
3. For each other seat that has made calls (processed partner, RHO, LHO), the **bidder** network on
   the sampled hand (`process_bidding`): input = the 193-feature auction tensor from that seat's view
   with hand/hcp/shape overwritten by the sample; per sample `min_score` = minimum over that seat's
   bidding rounds of the softmax probability of the call actually made. Drop samples with
   `min_score < 0.01`.
4. `use_distance`: `d = (1-m_lho)·n_lho + 2·(1-m_pard)·n_pard + (1-m_rho)·n_rho` (n = number of calls
   incl. passes), `score = (max - d)/max`, `max = n_lho + 2·n_pard + n_rho`; sort desc, keep `score ≥ 0.70`;
   if fewer than 15 kept and this is a late block, take the best 15. `quality` = mean score.
   If nobody else has called yet: return the first layouts, scores 1.
5. Repeat blocks of 2000 until 10000 (×1.5 per 6 non-pass bids) generated or > 100 accepted; the
   last blocks are 6000 when still short.

### 3. Card-play network input (`binary.py:BinaryInput`, `botcardplayer.py`, `game.py:Game.play`)

Models (config `[cardplay]`), `models.player_models` index order
`[lefty_nt, dummy_nt, righty_nt, decl_nt, lefty_suit, dummy_suit, righty_suit, decl_suit]`
(`*_hybrid_2026-10-16.keras`). Seat `player_i` uses index `player_i` in NT, `player_i + 4` in a suit
(`CardPlayer.__init__`). Dummy's cards are chosen with the **dummy** model (`player_i = 1`, hand = dummy,
public = declarer's hand); declarer's own cards with the **decl** model.

Input `x_play [N, T, 298]` (Keras float16, BEN keeps int8), `T` = number of tricks so far + 1
(one time step per trick, up to 13); output `card [N, T, 32]` softmax at every step
(LSTM, causal: step t only depends on steps ≤ t). The next card uses the **last** step:
`next_cards_softmax(x_play[:, :trick_i+1, :])[:, -1, :]`.

Time step `t` (trick `t`, 0-based) for seat `p`:
| slots | content |
|---|---|
| 0:32 | p's own hand at the **start** of trick t (32-card counts). Not reduced by p's own card in trick t. |
| 32:64 | the public hand at the start of trick t, minus its card in trick t if it played **before** p. Public = dummy for p ∈ {0,2,3}; = declarer's hand for p = 1 (dummy). |
| 64:192 | previous trick (t-1): 4 one-hots of 32, in play order (64 = its leader's card, 96 = 2nd, 128 = 3rd, 160 = 4th). Zero at t=0. |
| 192:224 | this trick: LHO's card (if already played before p) |
| 224:256 | this trick: partner's card (if already played) |
| 256:288 | this trick: RHO's card (if already played) |
| 288:292 | one-hot of the previous trick's leader, declarer-relative 0..3 (`288 + leader_i`). Zero at t=0. |
| 292 | contract level (1..7) |
| 293:298 | strain one-hot `293 + strain_i`, order N,S,H,D,C |

Construction (exact code in `game.py:Game.play` and `CardPlayer.set_card_played`):
```
init (t=0): hand, public, [292]=level, [293+strain_i]=1           # CardPlayer.init_x_play
when seat i plays card c32 in trick t, for every seat p:
    if (i - leader) % 4 > (p - leader) % 4: skip                     # played after p: not seen
    if i == p: skip
    if (p in {0,2,3} and i == 1) or (p == 1 and i == 3): x[p][t][32 + c32] -= 1
    off = (p - i) % 4                                                # 1 = RHO, 2 = partner, 3 = LHO
    x[p][t][192 + (3 - off)*32 + c32] = 1
after trick t (cards trick[0..3] in play order, leader L):
    for k in 0..3: s = (L + k) % 4; x[s][t+1][0:32] = x[s][t][0:32]; x[s][t+1][trick[k]] -= 1
    x[0|2|3][t+1][32:64] = x[1][t+1][0:32];  x[1][t+1][32:64] = x[3][t+1][0:32]
    for all p: x[p][t+1][64 + k*32 + trick[k]] = 1 (k = 0..3); x[p][t+1][288 + L] = 1;
               x[p][t+1][292] = level; x[p][t+1][293 + strain_i] = 1
```
`opening_lead_included = True`: lefty's step 0 is the opening-lead decision, so lefty's sequence starts
at trick 0 like everyone else's (the lead itself is chosen by the lead network, not by `lefty_*`).
Trick 13 is played automatically (the last card).

Output decoding (`CardPlayer.next_card_softmax`): `util.follow_suit(softmax, x[t][0:32], lead_suit_onehot)`:
mask to cards held; if a suit was led this trick (first non-empty of slots 192/224/256 in LHO, partner,
RHO order → `BinaryInput.get_this_trick_lead_suit`) and we hold that suit, mask to it; renormalise.
A 52-card candidate `c` gets the NN score of `card52to32(c)` (all pips 7..2 of a suit share one score;
`CardPlayer.get_nn_score`, plus: when leading after trick 8 (`len(tricks52) > 8`), a card that is
currently the highest outstanding in its suit gets `max(score, 0.5)`). Scores are rounded to 3 decimals.

### 4. How CardPlayer picks a card

#### Shortcuts before any sampling (`game.py:Game.play`)
- `util.get_play_status(hand52, current_trick52, strain_i)`: `Lead` (no card in trick), `Follow`,
  `Forced` (exactly one card of the led suit), `Discard` (void and, in a suit contract, also no trumps,
  or NT), `Ruff` (void with trumps).
- `Forced` and `autoplaysingleton = True` → play it.
- `Follow` and all our cards in the led suit are adjacent in rank in **our own** hand
  (`util.get_possible_cards`/`check_sequence`, played cards not considered): declarer (3) plays the
  highest, the others (incl. dummy) the lowest.

#### Sampling the hidden hands (`sample.py:init_rollout_states_iterative`)
Hidden seats for each `player_i`: `[(3,2), (0,2), (0,3), (2,0)][player_i]`
(hidden_1, hidden_2). Hidden cards are 32-codes (x has multiplicity).
1. If hidden cards ≤ `max_unknown_cards_for_sampling` (14): enumerate every split
   (`shuffle_cards`, cards of suits a hidden player has shown out of go to the other one).
   Else deal `sample_boards_for_play` (5000) with `shuffle_cards_bidding_info`: binfo for the player's
   own seat (24-card hand), HCP/shape targets of the two hidden hands, reduced for every card they
   have already played (hcp `card_hcp·f`, shape 0.3) and for current-trick cards; void suits forced to
   the partner hand; if > 10 cards left, A/K first by `distr_ak_vec` then the rest by `distr_vec`
   (as in section 2); hand sizes fixed (`len//2` and the rest). If both hidden hands only passed,
   binfo isn't used (uniform weights).
2. Build per-sample `states[4]` of shape `[n, 13, 298]`: columns 32: copied from the four seats'
   real `x_play`; hidden hands' 0:32 = sampled hand + their current-trick card + the cards they played
   from trick k on (hand at start of trick k).
3. De-duplicate (`get_unique_samples`), keep the duplicate counts (weights later).
4. If binfo used: `validate_shape_and_hcp_for_sample` (round(c_hcp) ≥ 11 → hcp ≥ round-5;
   round(shp) < 1.5 → len ≤ round+2; ≥ 5 → len ≥ round-1; ≥ 6 → len ≥ round). Ignored if fewer
   than `sample_hands_play` (200) pass.
5. Bidding score per sample (`get_bid_scores`): for each hidden hand, the bidder network (it's the
   same model for partner and opponents in this config), min over its bidding rounds of the
   probability of its actual call (`n_steps = 1 + (len(auction)-1)//4`); `min` over the two hands,
   rounded to 5 decimals; sort desc. If more than 400 samples and > 10 above 0.70, drop ≤ 0.005.
6. Opening-lead check (`validate_opening_lead_for_sample`), only if lefty (0) is hidden and at least
   `min_sample_hands_play` (20) samples: `score = nat · nn`, `nat` = 1 if
   `openinglead/openinglead.py:validate_lead(suit holding as 'AKQJTxxx' string, led rank, 'NT'|'Suit')`
   accepts the lead from the sampled lefty hand, else 0.2 (0.1 if we are righty = partner);
   `nn` = lead network on the sampled lefty hand (X with that hand, B from binfo on that hand),
   with `lead_accept_threshold_honors = True`: 24-way reduction (A,K,Q,J,T kept, 9+8+x summed),
   the probability of the led card's 24-slot. Threshold `lead_accept_threshold` 0.10
   (+ `lead_accept_threshold_partner_trust` 0.10 when we are righty); halve it until ≥ 20 samples pass
   (stop and skip the check below 0.001); keep `score > threshold` if at least 2 pass.
7. Play check (`validate_play_until_now`, tricks 1..11): for each hidden seat that has played cards
   (skip lefty at trick 1, skip declarer at trick 1), run its own play model (NT/suit) on its sampled
   states for `T = trick_i + (1 if it played in this trick)` steps; reduce the 32 outputs to 24
   (keep A..T, sum 9,8,x); score of each card it played = output at that card's time step and its
   24-slot (lefty's step 0, the lead, scores 1); per sample the **min** over its cards, then min over
   the two hands. Threshold `play_accept_threshold_declarer` 0.1 when the hidden seat is declarer,
   else `play_accept_threshold_partner` 0.1 (`play_accept_threshold_opponents` 0.03 is assigned
   but always overwritten); lower by 0.01 until ≥ `min_play_accept_threshold_samples` (10) pass.
   Quirk: if the first hidden seat examined has no cards played yet the function returns at once
   with all scores 1 (the other seat is not checked). The filtered set is used only if it still has
   more than `min_sample_hands_play` (20) samples with bidding score > `bid_extend_play_threshold` (0.01).
8. From trick 6 on (`trick_i ≥ check_remaining_cards` 5), `validate_logical_play`: for every A,K,Q,J,T
   a hidden hand still holds, for each earlier trick where its model gave that card > 0.95 / 0.9 / 0.8,
   multiply the sample's weight by 0.2/0.3/0.4 (ace) or 0.4/0.6/0.8 (other honours).
9. `check_discard = True`, suit contracts: for each recorded discard of a hidden hand (not a ruff),
   if its model's top card at that trick was a trump (and not the card played), weight =
   `1 - p(top card)`.
10. Final selection (tricks 1..10): if ≥ 200 samples have bidding score > 0.70 → keep those, then a
    weighted random permutation (p ∝ normalised bid score + normalised lead score + normalised play
    score); else if fewer than 20 have > `bid_accept_play_threshold` (0.40): if fewer than
    `min_sample_hands_play_bad` (12) have > 0.01 take the first 12, else take up to 200 with > 0.01 and
    draw 12 by the same weighted choice; else keep those > 0.40. Then truncate to `sample_hands_play`
    (200). `quality` = mean bidding score.
11. Per-sample probability (`util.convert_to_probability_with_weight`):
    `w = count · logical · discard` (× bidding score when quality > 0.5), normalised to sum 1.

#### Double-dummy evaluation (`CardPlayer.get_cards_dd_evaluation`)
- For each sample build a PBN `'N:' + lefty + ' ' + dummy + ' ' + righty + ' ' + declarer`
  (so DDS's N/E/S/W = player_i 0/1/2/3). Our hand and the public hand are real; hidden hands from
  the state at this trick minus their current-trick card; each hidden `x` gets a random pip (7..2)
  not yet seen (per-suit shuffled list, fresh `rng` per call).
- `DDS SolveBoard(trump=(strain_i-1)%5, first=leader_i, currentTrick=current_trick52, target=-1,
  solutions=3, mode=1)`; per legal card (plus DDS "equals" expanded to each equal card) the number
  of tricks the **side to play** wins from now.
- `tricks_needed` = `level+6 - tricks_taken` for the declaring side, `13-(level+6)+1 - tricks_taken`
  for defenders; `use_probability = True` (`[bidding]`):
  `e_tricks[c] = round(Σ_k p_k · tricks[c][k], 2)`, `e_make[c] = mean(tricks[c][k] ≥ needed)` (unweighted, 3 dp).
- `use_real_imp_or_mp = True`, IMPs: `real[c][k]` = our side's score for `tricks_taken + tricks[c][k]`
  (`calculate.calculate_score`, sign +1 for declarer side) and
  `e_score[c] = calculate.calculate_imp_score_probability(real, p)`: Σ over j≠i, k of
  `±diff_to_imps(d)·p_k·n` (sign + for d ≥ 0), divided by `n·(n_cards-1)`, round 2.
- `claim_cards` = cards whose `e_tricks` equals `round(max e_tricks, 1)`.

#### Choosing (`CardPlayer.pick_card_after_dd_eval`, the path without PIMC)
```
if claim_cards and claim_max > 10 - trick_i:
    bad = Claimer.claimcheck(...)       # claim.py: up to 50 resampled layouts with finesse-free cards,
    claim_cards -= bad                  #   DDS solutions=3; cards not sure of the claim are 'bad'
    if claim_cards empty: bad = []
else claim_cards = []
trump_adjust (suit contract, declaring side, on lead, opponents had ≤ 5 trumps at the start):
    +draw_trump_reward 0.1 if trumps are out (×2 → +0.2 in IMP mode),
    -draw_trump_penalty 0.1 if none are out (÷2 → -0.05); 0 if their only trump is the top one
suit_adjust: suit contract → [trump] = trump_adjust; NT → 0 without SuitC
for card c in DD results order:
    adj = suit_adjust[c//13]; nn = nn_score(c)
    if no claim_cards: (pimc_trust_NN = 0 filter) ; if nn > 0.25: adj += round(nn·0.2, 2)
    else: if e_tricks == 13 - trick_i and c is not a trump: adj = 0; if c in bad: adj = -0.05
    candidate: expected_score_imp = round(e_score + adj, 2), expected_tricks_dd = round(e_tricks + adj, 3),
               p_make = e_make, insta = nn
    (insert at the front instead of appending when c is lower than the previous card, same suit, same nn)
sort desc by (expected_score_imp, expected_tricks_dd, insta_score, -insertion_index)
card = carding.select_right_card_for_play(candidates, ...)
```
`carding.select_right_card_for_play` (with `force_suitc = True`, SuitC absent):
- one candidate → it.
- `Discard` by dummy with a pip (rank index ≥ 7) on top → dummy's **lowest** card of that suit.
- (the "clearly better" early returns are skipped because `force_suitc = True`).
- declarer (3): the top candidate (this is the `not use_suitc` branch; see section 5).
- if we haven't played this suit yet (`original_count == current_count`, counting our cards seen in
  `tricks52`), we are on lead and the top is a pip (rank index ≥ 7): dummy leads its lowest; others use
  `select_right_card` (the opening-lead spot rules of section 1 for this contract).
- dummy following → `select_lowest_card_dynamic`: the lowest card of the top card's suit whose
  candidate fields all equal the top's.
- else the top candidate.

#### Config values used in play (BEN-21GF.conf)
`sample_hands_play 200, min_sample_hands_play 20, min_sample_hands_play_bad 12, sample_boards_for_play 5000,
max_unknown_cards_for_sampling 14, claim True, use_biddinginfo True, use_biddingquality_in_eval True,
use_suitc True, suitc_sidesuit_check True, force_suitc True, use_real_imp_or_mp True,
draw_trump_reward 0.1, draw_trump_penalty 0.1, play_reward_threshold_NN 0.25,
play_reward_threshold_NN_factor_IMP 0.2, play_reward_threshold_NN_factor_MP 2, check_remaining_cards 5,
check_discard True, opening_lead_included True, use_suit_adjust True (needs SuitC), autoplaysingleton True,
pimc_trust_NN 0.0, use_probability True ([bidding]), matchpoint False;
[sampling] lead_accept_threshold 0.10, lead_accept_threshold_suit False, lead_accept_threshold_honors True,
lead_accept_threshold_partner_trust 0.10, bidding_threshold_sampling 0.70, bid_accept_play_threshold 0.40,
bid_extend_play_threshold 0.01, play_accept_threshold_opponents 0.03, play_accept_threshold_partner 0.1,
play_accept_threshold_declarer 0.1, min_play_accept_threshold_samples 10, hcp_reduction_factor 0.83,
shp_reduction_factor 0.3; [pimc] pimc_use_declaring True (tricks 3–9), pimc_use_defending True (tricks 1–9),
pimc_use_discarding True, pimc_ben_dd_declaring/defending True, weights 0.25, pimc_after_preempt True (0.75),
pimc_bidding_quality 0.1; [alphamju] off; no [ace] section (off).`

### 5. Native dependencies and what the JS port does instead

| BEN part | what it is | in the browser |
|---|---|---|
| DDS (`bin/dds3-*`, `ddsolver/ddsolver.py`) | Haglund/Hein double-dummy solver | the app's DDS wasm (`js/wasm/`, `js/dds-worker.js`). Needs `SolveBoard` with `solutions=1` (lead) and `solutions=3` with a partial current trick (play), returning per-card scores and the `equals` masks. |
| PIMC (`pimc/PIMC.py`, `PIMCDef.py`, `bin/BGA/*/BGADLL`) | closed binary (.NET/native), BGA's PIMC | **unavailable**. Set `pimc_use_declaring = pimc_use_defending = False`: every card goes through `get_cards_dd_evaluation` + `pick_card_after_dd_eval` (BEN's own DD). The config blends PIMC 25% / BEN DD 75% between tricks 3–9 (declarer) and 1–9 (defence), so BEN with PIMC differs slightly from the port there. |
| SuitC (`suitc/SuitC.py`, `bin/libsuitc.*`) | single-suit combination analyser (binary) | **unavailable**. Behave as `use_suitc = False` (declarer takes the top DD candidate; NT `suit_adjust` = 0) but keep `force_suitc = True` semantics (skip the early returns in `select_right_card_for_play`). |
| BBA (`bba/`, `use_bba_to_count_aces`, `consult_bba`) | closed Windows DLL | unavailable; `aceking = {}` in lead/play sampling (no ace-count constraint). |
| AlphaMju, ACE | native | off in this config. |

For the reference vectors, run BEN with PIMC, SuitC and BBA switched off so its choices match what the
port can do.

### 6. Determinism and testing notes
- Everything up to the network outputs is deterministic: compare encoded tensors exactly and softmax
  outputs to ~1e-3 (fp16 inputs, fp16 weights).
- BEN rounds inputs to float16 (Keras input dtype). The encodings above are all small integers or
  `k/4`, `(n-3.25)/1.75` (not exact in fp16: e.g. 0.428571 → 0.4285). Round shape features to fp16 before
  inference to match (or let the ONNX graph cast).
- Sampling uses NumPy PCG64 (`default_rng(calculate_seed(...))`); a JS port won't reproduce the
  same layouts. Test the decision stages separately: given BEN's layouts, the DD results, IMP scores
  and the final ranking must match; given a candidate list, the spot-card rules must match.
- Exact ties fall back to DD result order (DDS's card order), so allow ties when comparing.

## D. Download size, phones and lazy loading

| part | bytes | needed for |
|---|---|---|
| `ort/ort-wasm-simd-threaded.wasm` + `ort-wasm-simd-threaded.mjs` + `ort.wasm.min.mjs` | 14.9 MB (about 3.8 MB gzipped) | everything |
| `bidder.onnx` + `binfo.onnx` | 3.9 MB | bidding, and sampling for the lead and play |
| `contract.onnx` + `trick.onnx` | 0.13 MB | rescue-bid check before the final pass |
| `lead_nt.onnx` + `lead_suit.onnx` | 2.3 MB | the opening lead; checking samples during play (the lead net of the contract's strain) |
| 4 play models of one strain kind (`*_nt` or `*_suit`) | 14.0 MB | card play in that contract |
| all 8 play models | 27.9 MB | |
| **total** | **about 49 MB** (34.3 MB of models) | |

The models are float16 weights and hardly compress (gzip saves about 8%), so count the full size on the
wire. The wasm compresses to about a quarter if the server gzips it.

**Phones.** About 49 MB once (then the Cache API keeps it) is acceptable on Wi-Fi and heavy on a mobile
data plan; say so in the option's warning. Memory is the bigger risk: each session holds float32 weights,
about twice the file size, so all 14 sessions take about 70 MB plus the wasm heap. Load lazily:
1. When the option is switched on: ort + bidder + binfo + contract + trick (about 19 MB). That is
   enough to bid.
2. During the auction, once the auction is past the opening (or when the final pass is near):
   `lead_nt` and `lead_suit` (2.3 MB).
3. When the auction ends: only the four play models of the contract's kind (NT or suit), 14 MB, while
   the opening lead is being chosen. Release the other kind's sessions (`session.release()`) on phones.
   Fetch the other kind in the background on desktops only.

**Speed.** BEN's sampling runs the bidder and binfo networks on big batches: in the reference games one
play decision scores up to about 4,900 sampled layouts (batch 4,900 × 6 time steps through the bidder),
and a bidding decision up to about 1,600. The settings that drive this are `sample_boards_for_auction`
(20000, in steps of `sample_boards_for_auction_step` = 2000), `sample_boards_for_play` (5000) and
`sample_hands_play` (200). See section B and C for where they are used. Single-threaded wasm on a phone
is slow for this: in Node on an Apple-silicon desktop, one onnxruntime-web thread takes 0.8 s for the bidder on 2,000 sequences of 4 steps, 0.24 s for binfo on the same, 0.16 s for a play model on 200 sequences of 6 steps and 0.09 s for a lead model on 2,000 rows; expect a phone to be 2 to 4 times slower, so the port needs a time budget: scale these
counts down (for example by 4 on phones) and stop sampling when the budget is spent, as the app's
`js/ddplay.js` already does for its own solver.

## E. Test vectors

`tests/vectors/deal-NN.json` (30 deals) were written by `tools/make_vectors.py`, which runs BEN's own
`game.py: Driver` with all four seats robots and the BEN-21GF config, with BBA, PIMC, SuitC and AlphaMju
switched off (the browser can't have them). Deal `k` (0-based) is `np.random.seed(1000+k)` then
`game.random_deal_board(k % 16 + 1)`, so the board number (dealer, vulnerability) is `k % 16 + 1`.
`Driver.set_deal` then seeds numpy with `util.calculate_seed(deal string)`, and each bot re-seeds its own
generator from its hand (sections B and C). Every result in the files is therefore reproducible with
BEN, but the sampled parts (which layouts, DD results, expected scores) can't be reproduced in JS, which
can't replay numpy's PCG64 streams.

Each file:
```
{ board, deal: "N E S W" hands as S.H.D.C strings, dealer_vul: "N None" etc.,
  auction: [... BEN's padded auction ...], contract: "4HXS", play: ["D9","D2",...] (52 cards in order),
  trick_winners, claimed,
  decisions: [
    { kind: "bid", seat, auction (before the call), hand, result, candidates: [{call, insta_score,
      expected_score, adjust}], samples, nn: [...] },
    { kind: "lead", seat, auction, hand, result, candidates: [...], samples, nn: [...] },
    { kind: "play", player_i (0 lefty,1 dummy,2 righty,3 declarer), trick_i, leader_i,
      current_trick52, result, candidates: [{card, insta_score, expected_tricks_dd, p_make_contract,
      expected_score_imp, msg}], samples, nn: [...] } ] }
```
`nn` lists the network calls BEN made for that decision, in order (at most 2 per model per decision):
`{model, batch, inputs: {x: [row0], b: [row0]}, outputs: {name: [row0]}}`. Inputs are sparse,
`{shape, nz: [[flat index, value], ...]}`, and are the float16-rounded values BEN fed to the network;
outputs are dense (6 decimals). A play network output called `card` is the whole sequence `[T,32]`
(BEN's `pred_fun`), and one called `card_last` is the last step only (`next_cards_softmax`). For a play
decision, `nn` also holds the calls BEN made between the previous card and this one (game.py updates
the play states between cards). Play decisions keep their big sampling-stage calls only for
`trick_i` 1, 6 and 11; at other tricks only the batch-1 calls (the decision's own network) are kept.

What to check against them:
- **Exact**: every encoded input (row 0 of each call) from the deal, auction and play so far; the
  network outputs to about 5e-3 (float16 weights); the decision's own NN candidate scores
  (`insta_score`); and BEN's choice wherever it didn't sample (`samples == 0`, e.g. a call with one
  candidate over `no_search_threshold`, a forced or singleton card).
- **Statistical**: decisions made with samples. Compare the candidate lists and how often the port picks
  BEN's card or call over the 30 deals, not card by card.

`node tools/ort-smoke.mjs` runs each model in the vendored onnxruntime-web on the recorded inputs and
prints the largest difference from BEN's outputs.
