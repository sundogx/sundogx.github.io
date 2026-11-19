# BEN in the browser (GPL-3.0 folder)

**This folder (`bridge/ben/`) and everything in it is licensed under the GNU General Public License,
version 3 (see `LICENSE`), except `ort/`, which is onnxruntime-web under the MIT License
(see `ort/LICENSE`).** The GPL-3.0 applies to this folder only; it does not change the terms of the
rest of the site.

## What this is

The optional "Use BEN" robots: bidding, opening leads and card play by BEN, the bridge engine,
running entirely in the browser through onnxruntime-web (wasm, one thread).

- **BEN** by Lorand Dali and Thorvald Aagaard, GPL-3.0: https://github.com/lorserker/ben
- Upstream commit used: `5098782eaac4df07482a1178ce3f6000319fe95e` (2026-11-17), configuration
  `src/config/BEN-21GF.conf` (2/1 Game Forcing).
- The networks in `models/` are BEN's Keras models (from `models/TF2models/` at that commit) converted
  to ONNX by `tools/convert.py`, with the weights stored as float16. They are a modified form of BEN's
  models and remain GPL-3.0. The source form is BEN's repository at the commit above plus
  `tools/convert.py`.
- The JavaScript port of BEN's bot logic (`ben-core.js`, driven by `ben-worker.js`) is derived from BEN's Python
  source and is GPL-3.0 as well. It follows `PORTING.md`; BEN's native parts (PIMC, BBA, SuitC, its DDS build) are
  left out, and double-dummy work uses the site's own DDS wasm (`js/wasm/`, `js/ddplay.js`).

## Contents

| path | what |
|---|---|
| `LICENSE` | GPL-3.0 full text (applies to this folder) |
| `models/*.onnx`, `models/manifest.json` | the 14 networks, with sizes, sha256 and tensor names/shapes |
| `ort/` | onnxruntime-web 1.31.1 wasm build (MIT, unmodified) |
| `PORTING.md` | the spec for porting BEN's bidding, lead and play logic to JS |
| `ben-core.js` | the port: encodings, candidate calls, sampling hands that fit the auction, rollouts scored by DDS and IMPs, opening leads, card play |
| `ben-worker.js` | the Web Worker (`INTERFACE.md`): loads onnxruntime-web and the models, answers bid / lead / play |
| `tools/benenv.mjs` | Node setup shared by the tools below (onnxruntime-web, the models, the site's DDS) |
| `tools/bencheck.mjs` | checks the port against `tests/vectors/`: `node ben/tools/bencheck.mjs bid\|lead\|play` (env `DEAL=1,2`) |
| `tools/benvs.mjs` | BEN against the site's robots on the same deals, as a team match (IMPs per board) |
| `tools/convert.py` | Keras -> ONNX conversion |
| `tools/verify.py` | checks ONNX against the original Keras models, writes the manifest |
| `tools/make_vectors.py` | drives BEN's own code to write `tests/vectors/*.json` |
| `tools/ort-smoke.mjs` | runs every model in the vendored onnxruntime-web (Node) against the vectors |
| `tests/vectors/` | reference inputs/outputs and BEN's decisions on 30 deals |

## Rebuilding

```
git clone https://github.com/lorserker/ben && git -C ben checkout 5098782eaac4df07482a1178ce3f6000319fe95e
python3.12 -m venv venv && venv/bin/pip install tensorflow==2.21.0 keras==3.15.1 "numpy>=2.0,<2.1" \
    tf2onnx onnx onnxruntime scipy websockets colorama tqdm psutil scikit-learn pandas
venv/bin/python -I tools/convert.py ben models
venv/bin/python -I tools/make_vectors.py ben tests/vectors 30 /tmp/npz   # needs BEN's bin/dds3-darwin (Python 3.12)
venv/bin/python -I tools/verify.py ben models /tmp/npz
node tools/ort-smoke.mjs
```

## Status (measured on the 30 vector deals and on robot matches)

Agreement of the port's final choice with BEN's recorded one (`tools/bencheck.mjs`):

| phase | decisions | same choice | notes |
|---|---|---|---|
| bid | 324 | 314 | all candidate lists and encodings match; differences come from sampling and rollouts |
| lead | 30 | 21 | encodings match; differences come from the sampled layouts (BEN deals far more boards) |
| play | 1130 | 1010 | 1013 with `o.maxPool` (more layouts when few fit the play), which is off: see below |

Team matches on the same deals (`tools/benvs.mjs`, 300 boards each, IMPs per board for the first-named side):

- BEN bidding against the site's robots, contracts scored double dummy (`DET=1 DDSCORE=1 BENPLAY=0`): −0.18 ± 0.15.
- BEN lead and card play against the site's robots, both sides bidding with the robots (`BENBID=0`): +0.28 ± 0.26.
- BEN play with `maxPool: 0` against `maxPool: 1000` (`OPP=ben BENBID=0 NEW='{"maxPool":0}'`): +0.22 ± 0.11, so
  extending the pool is off at the browser's time budget.
- BEN play with 4000 ms, k 60, pool 200 against the defaults: +0.18 ± 0.15 (not enough to justify the slower play).
- BEN bidding with and without rescue bids (`o.rescue`, BEN's `evaluate_rescue_bid`; `OPP=ben DET=1 DDSCORE=1 BENPLAY=0
  NEW='{"rescue":false}'`): no rescue bid made and no board changed, so it is off (it costs a sampling pass on lone passes).

Knobs for the tools: `bencheck` `POOL`, `K`, `MAXPOOL`, `PLIM=none|min`, `DEAL=n`, `V=1` (mismatch details);
`benvs` `DET=1` (no time limits, reproducible), `DDSCORE=1`, `BENBID=0`, `BENPLAY=0`, `OPP=ben`, `NEW='{...}'`,
`BOARDS=a,b`, `BIDMS`, `LEADMS`, `PLAYMS`.
