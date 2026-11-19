#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Reference test vectors for the JS port of BEN (github.com/lorserker/ben, GPL-3.0).
# Drives BEN's own game loop (src/game.py Driver, all four seats robots) with the BEN-21GF config,
# with the native-only parts switched off (BBA, PIMC, SuitC, AlphaMju: the JS port can't use them),
# and records every neural-network call (inputs and outputs) plus BEN's final calls, lead and cards.
#
# Usage: python -I make_vectors.py <ben_checkout> <out_dir> <n_deals> [npz_dir]
#   out_dir/deal-NN.json  one file per deal (compact: first rows of each batch, sparse inputs)
#   npz_dir/<model>.npz   up to 400 full input rows per model, for checking the ONNX conversion
import sys, os, json, time, asyncio, contextlib, io
BEN, OUT, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
NPZ = sys.argv[4] if len(sys.argv) > 4 else None
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
sys.path.insert(0, os.path.join(BEN, 'src'))
os.chdir(os.path.join(BEN, 'src'))
sys.argv = [sys.argv[0]]
import numpy as np

import conf, human, game
from sample import Sample
from nn.models_tf2 import Models
from ddsolver.ddsolver import DDSolver
import botbidder, botopeninglead, botcardplayer

CONFIG = 'config/BEN-21GF.conf'
OVERRIDES = {  # native libraries the browser port cannot use
  ('models', 'use_bba'): 'False', ('models', 'consult_bba'): 'False',
  ('models', 'use_bba_rollout'): 'False', ('models', 'use_bba_to_count_aces'): 'False',
  ('cardplay', 'use_suitc'): 'False',
  ('pimc', 'pimc_use_declaring'): 'False', ('pimc', 'pimc_use_defending'): 'False',
  ('alphamju', 'alphamju_declaring'): 'False', ('alphamju', 'alphamju_defending'): 'False',
}
ROWS_JSON = 1        # rows kept per call in the JSON (row 0 of the batch)
CALLS_JSON = 2       # calls kept per model per decision in the JSON
FULL_TRICKS = (1, 6, 11)  # play decisions that keep the sampling-stage calls; others keep only batch-1 calls
ROWS_NPZ = 400       # rows kept per model for the conversion check

state = {'decision': None, 'calls': [], 'npz': {}}


def r6(a):
  return np.round(np.asarray(a, dtype=np.float64), 6).tolist()


def sparse(a):
  a = np.asarray(a, dtype=np.float32)
  flat = a.reshape(-1)
  nz = np.nonzero(flat)[0]
  return {'shape': list(a.shape), 'nz': [[int(i), round(float(flat[i]), 6)] for i in nz]}


def record(model, inputs, outputs):
  d = state['decision']
  if NPZ:
    bucket = state['npz'].setdefault(model, {})
    for k, v in inputs.items():
      v = np.asarray(v, dtype=np.float32)
      have = bucket.get(k)
      n = 0 if have is None else sum(len(x) for x in have)
      if n < ROWS_NPZ and (v.ndim < 3 or k != 'x' or True):
        bucket.setdefault(k, []).append(v[:ROWS_NPZ - n])
  if d is None:
    return
  same = [c for c in d['nn'] if c['model'] == model]
  if len(same) >= CALLS_JSON:
    return
  rows = len(next(iter(inputs.values())))
  d['nn'].append({
    'model': model, 'batch': rows,
    'inputs': {k: [sparse(v[i]) for i in range(min(ROWS_JSON, rows))] for k, v in inputs.items()},
    'outputs': {k: [r6(v[i]) for i in range(min(ROWS_JSON, rows))] for k, v in outputs.items()},
  })


def wrap_models(models):
  def bidder(m):
    f = m.pred_fun_seq
    def g(x):
      bids, alerts = f(x)
      record('bidder', {'x': x}, {'bid': bids})
      return bids, alerts
    m.pred_fun_seq = g
  def binfo(m):
    f = m.pred_fun
    def g(x):
      h, s = f(x)
      record('binfo', {'x': x}, {'hcp': h, 'shape': s})
      return h, s
    m.pred_fun = g
  def leader(m, name):
    f = m.pred_fun
    def g(x, b):
      y = f(x, b)
      record(name, {'x': x, 'b': b}, {'lead': y})
      return y
    m.pred_fun = g
  def simple(m, name, out):
    f = m.pred_fun
    def g(x):
      y = f(x)
      record(name, {'x': x}, {out: y})
      return y
    m.pred_fun = g
  def player(m, name):
    f, h = m.pred_fun, m.next_cards_softmax
    def g(x):
      y = f(x)
      record(name, {'x': x}, {'card': y})
      return y
    def k(x):
      y = h(x)  # last time step only
      record(name, {'x': x}, {'card_last': y})
      return y
    m.pred_fun, m.next_cards_softmax = g, k
  bidder(models.bidder_model)
  if models.opponent_model is not models.bidder_model:
    bidder(models.opponent_model)
  binfo(models.binfo_model)
  ob = getattr(models, 'opponent_binfo_model', None)
  if ob is not None and ob is not models.binfo_model:
    binfo(ob)
  leader(models.lead_nt_model, 'lead_nt')
  leader(models.lead_suit_model, 'lead_suit')
  simple(models.contract_model, 'contract', 'contract')
  simple(models.trick_model, 'trick', 'tricks')
  for m in models.player_models:
    player(m, m.name)


def wrap_bots(deal_rec):
  ob, ol, op = botbidder.BotBid.bid, botopeninglead.BotLead.find_opening_lead, botcardplayer.CardPlayer.play_card

  def bid(self, auction, *a, **k):
    d = {'kind': 'bid', 'seat': self.seat, 'auction': list(auction), 'hand': self.hand_str, 'nn': []}
    state['decision'] = d
    r = ob(self, auction, *a, **k)
    d['result'] = r.bid
    d['candidates'] = [{'call': c.bid, 'insta_score': _f(c.insta_score), 'expected_score': _f(c.expected_score),
                        'adjust': _f(getattr(c, 'adjust', None))} for c in (r.candidates or [])]
    d['samples'] = len(r.samples or [])
    deal_rec['decisions'].append(d)
    state['decision'] = None
    return r

  def lead(self, auction, *a, **k):
    d = {'kind': 'lead', 'seat': self.seat, 'auction': list(auction), 'hand': self.hand_str, 'nn': []}
    state['decision'] = d
    r = ol(self, auction, *a, **k)
    d['result'] = str(r.card)
    d['candidates'] = [_cand(c) for c in (r.candidates or [])]
    d['samples'] = len(r.samples or [])
    deal_rec['decisions'].append(d)
    state['decision'] = None
    return r

  def play(self, trick_i, leader_i, current_trick52, tricks52, *a, **k):
    d = {'kind': 'play', 'player_i': self.player_i, 'trick_i': trick_i, 'leader_i': leader_i,
         'current_trick52': [int(c) for c in current_trick52], 'nn': []}
    # the play network calls for this card happen in game.py just before play_card: keep them
    prev = state.get('pending_play')
    if prev:
      d['nn'] = prev
    state['decision'] = d
    r = op(self, trick_i, leader_i, current_trick52, tricks52, *a, **k)
    d['result'] = str(r.card)
    d['candidates'] = [_cand(c) for c in (r.candidates or [])]
    d['samples'] = len(r.samples or [])
    if trick_i not in FULL_TRICKS:
      d['nn'] = [c for c in d['nn'] if c['batch'] == 1]
    deal_rec['decisions'].append(d)
    state['decision'] = {'kind': 'between', 'nn': []}
    state['pending_play'] = state['decision']['nn']
    return r

  botbidder.BotBid.bid, botopeninglead.BotLead.find_opening_lead, botcardplayer.CardPlayer.play_card = bid, lead, play


def _f(x):
  try:
    return None if x is None else round(float(x), 6)
  except (TypeError, ValueError):
    return str(x)


def _cand(c):
  d = c.to_dict() if hasattr(c, 'to_dict') else {}
  return {k: (_f(v) if isinstance(v, (int, float, np.floating)) else str(v)) for k, v in d.items()}


async def main():
  configuration = conf.load(CONFIG)
  for (sec, key), v in OVERRIDES.items():
    if configuration.has_section(sec):
      configuration.set(sec, key, v)
  models = Models.from_conf(configuration, BEN)
  models.pimc_use_declaring = models.pimc_use_defending = False
  wrap_models(models)
  dds = DDSolver(max_threads=0)
  os.makedirs(OUT, exist_ok=True)
  driver = game.Driver(models, human.ConsoleFactory(), Sample.from_conf(configuration, False), 42, dds, False)
  driver.facit, driver.facit_score = False, None
  for k in range(N):
    np.random.seed(1000 + k)
    deal_str, auction_str = game.random_deal_board(k % 16 + 1)
    rec = {'board': k + 1, 'deal': deal_str, 'dealer_vul': auction_str, 'decisions': [],
           'seed': f'np.random.seed(1000+{k}) for the deal; then Driver.set_deal seeds numpy with util.calculate_seed(deal)'}
    wrap_bots(rec)
    driver.set_deal(k + 1, deal_str, auction_str, False, bidding_only='False')
    driver.human = [False] * 4
    state['decision'], state['pending_play'] = None, None
    t = time.time()
    with contextlib.redirect_stdout(io.StringIO()):
      await driver.run(t)
    dd = driver.to_dict()
    rec['auction'] = list(driver.auction)
    rec['contract'] = dd.get('contract')
    rec['play'] = [p.get('card') for p in dd.get('play', [])]
    rec['claimed'] = dd.get('claimed')
    rec['trick_winners'] = dd.get('trick_winners')
    with open(os.path.join(OUT, f'deal-{k + 1:02d}.json'), 'w') as f:
      json.dump(rec, f, separators=(',', ':'))
    print(f'deal {k + 1}: {deal_str} | {" ".join(rec["auction"])} | {rec["contract"]} | {len(rec["play"])} cards | {time.time() - t:.0f}s', flush=True)
    if NPZ:
      os.makedirs(NPZ, exist_ok=True)
      for m, b in state['npz'].items():
        np.savez_compressed(os.path.join(NPZ, m + '.npz'), **{k2: np.concatenate(v) if v[0].ndim < 3 else _pad(v) for k2, v in b.items()})


def _pad(chunks):  # sequence inputs of different lengths: pad on the time axis with zeros, keep the lengths
  T = max(c.shape[1] for c in chunks)
  out = []
  for c in chunks:
    p = np.zeros((c.shape[0], T, c.shape[2]), np.float32)
    p[:, :c.shape[1]] = c
    out.append(p)
  return np.concatenate(out)


asyncio.run(main())
