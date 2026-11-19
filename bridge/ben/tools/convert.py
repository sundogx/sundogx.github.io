#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Converts BEN's Keras models (github.com/lorserker/ben, GPL-3.0) to ONNX for onnxruntime-web.
# Usage: python -I convert.py <ben_checkout> <out_dir> [model names...]
#
# - Inputs are float32 in the ONNX graph; the graph first rounds them to float16 and back, exactly
#   as BEN does (BEN feeds float16 tensors to models whose InputLayer is float16).
# - Weights are stored as float16 and cast back to float32 when the session loads (Cast nodes on the
#   initializers, constant-folded by onnxruntime), so the download is halved and the arithmetic
#   stays float32 (onnxruntime-web's wasm CPU kernels have no fp16 LSTM).
# - TimeDistributed(Dense) layers are applied to the whole sequence (BEN's nn/keras_compat.py fix).
import sys, os
import numpy as np
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
import tensorflow as tf, keras, tf2onnx, onnx
from onnx import helper, numpy_helper, TensorProto

# name -> (keras file in models/TF2models, [(input name, shape)], [output names]); from src/config/BEN-21GF.conf
MODELS = {
  'bidder':    ('BEN-21GF-8744_2026-11-11-E30.keras',      [('x', [None, None, 193])], ['bid']),
  'binfo':     ('BEN-21GF-8744-Info_2026-11-11-E30.keras', [('x', [None, None, 193])], ['hcp', 'shape']),
  'lead_nt':   ('LeadV3-NT-Both_2026-10-16.keras',         [('x', [None, 42]), ('b', [None, 15])], ['lead']),
  'lead_suit': ('LeadV3-Suit-Both_2026-10-16.keras',       [('x', [None, 42]), ('b', [None, 15])], ['lead']),
  'contract':  ('Contract_2024-12-09-E50.keras',           [('x', [None, 50])], ['contract']),
  'trick':     ('Tricks_2024-12-09-E50.keras',             [('x', [None, 55])], ['tricks']),
}
for side in ('lefty', 'dummy', 'righty', 'decl'):
  for k in ('nt', 'suit'):
    MODELS[f'{side}_{k}'] = (f'{side}_{k}_hybrid_2026-10-16.keras', [('x', [None, None, 298])], ['card'])


def load(path):
  m = keras.models.load_model(path, compile=False)  # safe_mode (default): no lambda layers
  for layer in m.layers:
    if isinstance(layer, keras.layers.TimeDistributed) and isinstance(layer.layer, keras.layers.Dense):
      d = layer.layer
      layer.call = (lambda d: (lambda inputs, training=None, mask=None: d(inputs)))(d)
  return m


def fp16_weights(model):
  g = model.graph
  inits, casts = [], []
  for init in g.initializer:
    if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= 16:
      a = numpy_helper.to_array(init).astype(np.float16)
      inits.append(numpy_helper.from_array(a, init.name + '__fp16'))
      casts.append(helper.make_node('Cast', [init.name + '__fp16'], [init.name], to=TensorProto.FLOAT,
                                    name=init.name + '__cast'))
    else:
      inits.append(init)
  del g.initializer[:]
  g.initializer.extend(inits)
  nodes = list(g.node)
  del g.node[:]
  g.node.extend(casts + nodes)
  return model


def convert(ben, out, name, fp16=True):
  fn, ins, outs = MODELS[name]
  m = load(os.path.join(ben, 'models', 'TF2models', fn))
  sig = [tf.TensorSpec(s, tf.float32, name=n) for n, s in ins]
  multi = len(ins) > 1

  @tf.function(input_signature=sig)
  def f(*xs):
    xs = [tf.cast(tf.cast(x, tf.float16), tf.float32) for x in xs]
    y = m(list(xs) if multi else xs[0], training=False)
    ys = y if isinstance(y, (list, tuple)) else [y]
    return {n: tf.identity(tf.cast(t, tf.float32), name=n) for n, t in zip(outs, ys)}

  onx, _ = tf2onnx.convert.from_function(f, input_signature=sig, opset=17)
  if fp16:
    onx = fp16_weights(onx)
  onnx.checker.check_model(onx)
  p = os.path.join(out, name + '.onnx')
  onnx.save(onx, p)
  return m, p


if __name__ == '__main__':
  ben, out = sys.argv[1], sys.argv[2]
  os.makedirs(out, exist_ok=True)
  for name in sys.argv[3:] or list(MODELS):
    _, p = convert(ben, out, name)
    print(name, os.path.getsize(p), flush=True)
