// Load a baseline bidding fixture so that the test knobs (BID_OFF, BID_K) and the penalty log (BID_PENLOG) of
// the version under test don't reach it: the fixture is loaded, and every call into it runs, with them cleared.
module.exports = function baseFixture(file) {
  const keys = ['BID_OFF', 'BID_K', 'BID_PENLOG'];
  const clear = f => {
    const old = keys.map(k => globalThis[k]);
    globalThis.BID_OFF = []; globalThis.BID_K = {}; globalThis.BID_PENLOG = null;
    try { return f(); } finally { keys.forEach((k, i) => { globalThis[k] = old[i]; }); }
  };
  const mod = clear(() => require(file)), out = {};
  for (const [k, v] of Object.entries(mod)) out[k] = typeof v === 'function' ? (...a) => clear(() => v(...a)) : v;
  return out;
};
