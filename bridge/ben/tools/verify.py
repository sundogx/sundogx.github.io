#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks the ONNX models against BEN's original Keras models on real inputs recorded by
# make_vectors.py (npz_dir/<model>.npz, up to 400 rows each), and writes models/manifest.json.
# Usage: python -I verify.py <ben_checkout> <models_dir> <npz_dir>
import sys, os, json, hashlib
import numpy as np
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tensorflow as tf
import onnx, onnxruntime as ort
from convert import MODELS, load

BEN, MD, NPZ = sys.argv[1:4]
DTYPES = {1: 'float32', 10: 'float16', 7: 'int64'}


def io(vs):
  return [{'name': v.name, 'shape': [d.dim_value if d.dim_value else None for d in v.type.tensor_type.shape.dim],
           'dtype': DTYPES.get(v.type.tensor_type.elem_type, str(v.type.tensor_type.elem_type))} for v in vs]


entries, total = [], 0
for name, (fn, ins, outs) in MODELS.items():
  p = os.path.join(MD, name + '.onnx')
  blob = open(p, 'rb').read()
  m = onnx.load(p)
  e = {'name': name, 'file': name + '.onnx', 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
       'source': 'models/TF2models/' + fn, 'inputs': io(m.graph.input), 'outputs': io(m.graph.output)}
  npz = os.path.join(NPZ, name + '.npz')
  if os.path.exists(npz):
    data = dict(np.load(npz))
    km = load(os.path.join(BEN, 'models', 'TF2models', fn))
    feeds = {n: data[n].astype(np.float32) for n, _ in ins}
    rows = len(feeds[ins[0][0]])
    sess = ort.InferenceSession(p, providers=['CPUExecutionProvider'])
    got = sess.run(None, feeds)
    xs = [tf.constant(feeds[n].astype(np.float16)) for n, _ in ins]
    ref = km(xs if len(xs) > 1 else xs[0], training=False)
    ref = ref if isinstance(ref, (list, tuple)) else [ref]
    diffs = [float(np.max(np.abs(np.asarray(r, np.float32) - g))) for r, g in zip(ref, got)]
    # how often the top class changes (bidder/lead/play softmax outputs)
    agree = None
    if outs[0] in ('bid', 'lead', 'card', 'contract', 'tricks'):
      agree = float(np.mean(np.argmax(np.asarray(ref[0]), -1) == np.argmax(got[0], -1)))
    e['check'] = {'rows': rows, 'max_abs_diff': max(diffs), 'per_output': dict(zip(outs, diffs)), 'argmax_agreement': agree}
  else:
    e['check'] = None
  total += len(blob)
  entries.append(e)
  print(name, len(blob), e['check'], flush=True)

manifest = {
  'about': 'BEN (github.com/lorserker/ben, GPL-3.0) networks converted to ONNX; see ../README.md and ../PORTING.md',
  'ben_commit': '5098782eaac4df07482a1178ce3f6000319fe95e', 'ben_config': 'src/config/BEN-21GF.conf',
  'onnx_opset': 17, 'weights': 'float16 storage, Cast to float32 at load; inputs/outputs float32',
  'total_bytes': total, 'models': entries}
json.dump(manifest, open(os.path.join(MD, 'manifest.json'), 'w'), indent=1)
print('total', total)
