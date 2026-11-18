# BEN's opening-lead model: notes for the opening-lead work

Source: github.com/lorserker/ben (checked 2026-11-18). Licence **GPL-3.0** (repo `LICENSE`, models included).
This site's repo has no licence file, so vendoring BEN's weights (or a conversion of them) would mean
publishing GPL-3.0 material next to all-rights-reserved code: only do it if the owner is happy to license
the page's code under GPL-3.0 (or keep the models in a separate GPL folder with a clear notice and
the source link, and accept that the combined page is arguably a GPL work). Attribution if used:
"BEN, the bridge engine, by Lorand Dali and Thorvald Aagaard, GPL-3.0, https://github.com/lorserker/ben".

## How BEN leads (src/botopeninglead.py, src/config/default.conf `[lead]`)
- A lead network (separate NT and suit models) reads our hand, the auction (bidding features) and
  vulnerability and gives a probability for each of 32 lead "cards" (AKQJT98 + x per suit).
- Candidates: every card with p >= `lead_threshold` (0.20), at least `min_opening_leads` (4).
  If one card has p >= `lead_accept_nn` (0.999) it is led without simulation.
- ~200 layouts (`sample_hands_opening_lead`) are sampled from the auction (bidding-info NN predicts
  each hidden hand's HCP and shape; samples are re-scored by the bidding NN and kept if the auction
  is likely enough, `bid_accept_threshold_bidding`).
- Each candidate is evaluated over the samples double dummy (or with a "single dummy" NN that
  predicts the trick distribution, `lead_single_dummy`), scored in real IMPs/MPs
  (`use_real_imp_or_mp_opening_lead`: round-robin IMPs of each candidate against the others,
  layout by layout), plus small adjustments (`reward_lead_partner_suit` 0.5, `trump_lead_penalty`).
  Ties go to the NN probability.
- The spot card follows agreements: `lead_from_pips_nt = 24` (2nd/4th best), `lead_from_pips_suit = 135`
  (3rd/5th) in src/carding.py.
- During later play BEN also checks the lead against the leader's sampled hand: layouts in which the
  lead network would not have led the actual card (score < `lead_accept_threshold` 0.10, +0.10 when it
  was partner's lead) are dropped (sample.py `validate_opening_lead_for_sample`): e.g. a Q lead denies the K.

## Model files (models/onnx in the repo; TF2 .keras versions in models/TF2models)
| file | size |
|---|---|
| lead_nt.onnx | 2.29 MB |
| lead_suit.onnx | 2.29 MB |
| single_dummy.onnx (lead evaluation without DD) | 3.52 MB |
| bidinfo.onnx (hand-shape/HCP inference from the auction) | 1.81 MB |
| LeadV3-NT-Both / LeadV3-Suit-Both .keras (current default) | 6.9 MB each |

Running them in the browser: onnxruntime-web 1.20.1 (jsdelivr; dist/ort-wasm-simd-threaded.wasm 11.2 MB,
the JSEP/WebGPU build 21.7 MB) or TF.js after a Keras->TF.js conversion
(@tensorflow/tfjs 4.22.0 dist/tf.min.js 1.47 MB; not checked that every Keras layer in the lead nets converts). Lead nets alone: ~4.6 MB + 11.2 MB ORT ~ 16 MB, or ~6 MB with TF.js, at the edge of a reasonable
budget; inference is a few ms. Big caveat besides the licence: the lead and bidding-info nets are
trained on BEN's own bidding (its 2/1 or SAYC models) and BEN's input encoding of the auction;
our robots' 2/1 is close but not identical, so the priors may be off for our auctions.
