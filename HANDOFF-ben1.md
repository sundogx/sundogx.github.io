# HANDOFF-ben1: BEN phase 1 (models, ort, spec, vectors)

Status: **done**. Everything is under `bridge/ben/`; no other app files were touched, sw.js CACHE is not
bumped, nothing is pushed. `cd bridge && npm test` passes.

## What's there
- `bridge/ben/LICENSE` (GPL-3.0, copied from BEN), `README.md` (attribution, source link, upstream commit
  `5098782eaac4df07482a1178ce3f6000319fe95e`, says this folder is GPL-3.0 and `ort/` is MIT).
- `models/`: 14 ONNX networks from `src/config/BEN-21GF.conf` (BEN's 2/1 GF config), 34.3 MB in total,
  biggest file 3.5 MB. `manifest.json` has bytes, sha256, IO names/shapes/dtypes, and the accuracy check.
  Weights are stored as fp16 and cast to fp32 when loading; inputs and outputs are float32, and the inputs
  are rounded to fp16 inside the graph, as BEN does.
  - bidder 3.06 MB, binfo 0.88, lead_nt 1.15, lead_suit 1.15, contract 0.07, trick 0.07;
  - {lefty, dummy, righty, decl} x {nt, suit}: 3.49 MB each.
  - SD/RPDD (single-dummy estimators) are not converted: unused with `estimator = none` and lead `double_dummy = True`.
- Accuracy against BEN's TF models, up to 400 real rows each: the max abs diff is 2e-4 to 4.2e-3, and the
  top class agrees on 99.5 to 100% of rows. All of this comes from the fp16 weights; an fp32 ONNX matches
  to 2e-6. In Node, onnxruntime-web against the JSON vectors differs by at most 1.7e-3.
- `ort/`: onnxruntime-web 1.31.1. Files: `ort.wasm.min.mjs`, `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`,
  and `ort-wasm-simd-threaded.wasm` (14.8 MB, 3.8 MB gzipped). Its MIT licence is in `ort/LICENSE`.
  - 1.31 ships only the "threaded" SIMD build. With `numThreads = 1` it runs without COOP/COEP.
  - The licence text was written from the standard MIT text with "Copyright (c) Microsoft Corporation",
    because GitHub raw returned 500 at the time. Re-check it against onnxruntime's LICENSE if you want.
- `PORTING.md`, the spec, in five parts:
  - A: models;
  - B: bidding (encoding, decoding, the BotBid algorithm, every config value);
  - C: seats and suits and the app mapping, then the lead and play encodings and algorithms;
  - D: download size and lazy loading;
  - E: the vector format.
- `tools/`: `convert.py`, `verify.py` (writes the manifest), `make_vectors.py` (drives BEN's `game.py`
  Driver) and `ort-smoke.mjs` (`node bridge/ben/tools/ort-smoke.mjs`).
- `tests/vectors/deal-01..30.json`, 4.6 MB in total:
  - 324 calls (130 of them deterministic, made without samples), 30 leads and 1,130 cards;
  - the encoded inputs and raw outputs of each NN call, row 0.

## Things the porting agents must know
- The vectors come from BEN with **BBA, PIMC, SuitC and AlphaMju off**. They are native or Windows-only
  libraries, and the browser can't have them.
  - BEN-21GF normally consults BBA, for example for keycard bidding. So BEN's bidding here is BEN without
    BBA.
- Sampled decisions can't be reproduced bit for bit in JS (numpy PCG64). Check those statistically.
  Encodings, NN outputs and decisions made without samples can be checked exactly.
- **Speed is the real risk.** BEN scores up to about 5,000 sampled layouts per decision with the bidder.
  - In single-thread ort-web on a desktop, the bidder takes 0.8 s for 2,000 sequences of 4 steps.
  - The port must cut the sample counts and keep a time budget, especially on phones.
- Download: about 49 MB in all. The lazy plan is in PORTING.md D:
  - about 19 MB to bid;
  - +2.3 MB for the lead;
  - +14 MB for the four play models of the contract's kind.

## Local scratch (may be cleared)
`/private/tmp/claude-501/-Users-admin-Documents/95ab9733-087d-4851-ab93-f3d4557a6771/scratchpad/ben/` holds:
- `src/ben`: the BEN clone;
- `venv312`: Python 3.12, needed because BEN's vendored `bin/dds3-darwin` is built for 3.12;
- `work/npz`: the full verification inputs.
