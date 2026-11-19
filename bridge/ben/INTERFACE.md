# BEN worker interface

The bridge page talks to BEN through one dedicated Web Worker, `bridge/ben/ben-worker.js`, with `postMessage`. The page side is `bridge/js/benbridge.js`. It is the app's own code and has no BEN code in it. Everything in `bridge/ben/` is meant for BEN-derived code and models under GPL-3.0 (github.com/lorserker/ben, by Lorand Dali and Thorvald Aagaard).

The worker in this folder is a **stub**. It answers with the app's own robots, so the option works end to end now. A port replaces its `loadModels`, `bid`, `lead` and `play` functions and keeps the message loop and the reply shapes.

## The worker

- It is a classic worker (`importScripts`) by default. To use a module worker, put `"worker": "module"` in `models/manifest.json`. The page reads that file before it starts the worker.
- The page starts it only when a practice robot needs it, or when the player turns the option on. There is one worker per page.
- The page never sends a hidden hand. Every request holds only what that robot may see.

## Messages

Page to worker, and the worker's replies:

| Request | Reply |
|---|---|
| `{type:'init', base}` | Any number of `{type:'progress', loaded, total}`, then `{type:'ready'}` or `{type:'error', message}` |
| `{type:'bid', id, hand, seat, dealer, auction, vul}` | `{type:'bid', id, call, alert?, explain?}` |
| `{type:'lead', id, hand, seat, dealer, auction, vul, contract}` | `{type:'lead', id, card}` |
| `{type:'play', id, view}` | `{type:'play', id, card}` |

- `base` is the absolute URL of this folder, ending in `/` (for example `https://sundogx.github.io/bridge/ben/`). The models are under `base + 'models/'`.
- `progress`: `loaded` and `total` are best given in bytes. The page shows a bar and, when `total` is over 100 kB, "N MB of M MB".
- `id` is a number. Echo it in the reply. A request may also be answered with `{type:'error', id, message}`; the robot then plays as usual. An `error` **without** an `id` means loading failed.
- Requests come one at a time, but the page doesn't wait forever. It waits about 4 s for a call or a card and 5 s for a lead, then lets the usual robot decide. A late answer is ignored. Two late answers in a row, any uncaught exception (`onerror`) or a loading error turn BEN off for the rest of the visit, with one toast.
- The page checks every answer. An illegal call or card, or one in the wrong format, means the usual robot plays that turn.

## The app's representation (`js/engine.js`)

- **Seats:** `'N'`, `'E'`, `'S'`, `'W'`. Clockwise order is `N E S W`.
- **Cards:** two characters, suit then rank. Suits are `S H D C`; ranks are `2 3 4 5 6 7 8 9 T J Q K A` (ten is `T`). For example `'SA'`, `'HT'`, `'C2'`.
- **Hands:** arrays of cards, in any order. In `bid` and `lead` requests, `hand` has all 13 cards.
- **Calls:** `'P'` (pass), `'X'` (double), `'XX'` (redouble), and bids as level then strain: `'1C'`, `'1D'`, `'1H'`, `'1S'`, `'1N'` (notrump) … `'7N'`.
- **Auction:** an array of `{call, by}` in the order made, starting with the dealer's call. `by` is a seat. It is the auction so far, before this robot's call.
- **Dealer:** a seat.
- **Vulnerability (`vul`):** `'None'`, `'NS'`, `'EW'` or `'Both'`.
- **Contract:** `{level, strain, doubled, declarer}`. `level` is 1–7; `strain` is `'C' 'D' 'H' 'S'` or `'N'`; `doubled` is 0, 1 (doubled) or 2 (redoubled); `declarer` is a seat. The opening leader is the seat after the declarer.

### `bid` replies

- `call`: one of the calls above. It must be legal.
- `alert` (optional): `true`, or a short text that explains the call. The call is then shown with the red alert outline.
- `explain` (optional): what the call shows, in plain words, at most 200 characters. It is shown when the call is tapped.
- Without either, BEN's call has **no** explanation. The page never shows the app's 2/1 explanation (`describeCall`) for a BEN call, since BEN plays another system. The auction entry is stored as `{call, by, alert?, ben: true, explain?}`.

### `play` requests: `view`

`view` is `ddView(t, seat)` from `js/ddplay.js`, the same object the app's solver robots get. It has only what that robot may see:

```js
{
  seat: 'N',             // the hand to play from. When declarer plays dummy's card, this is dummy's seat.
  vul: 'NS',
  contract: { level: 4, strain: 'H', doubled: 0, declarer: 'S' },
  tricks: [              // the play so far, oldest first; the last trick may be incomplete (the one being played)
    { leader: 'W', cards: [ { seat: 'W', card: 'SK' }, { seat: 'N', card: 'S4' }, ... ] },
  ],
  auction: [ { call: '1H', by: 'S' }, ... ],   // the whole auction; dealer = auction[0].by
  known: {               // the cards still held by the hands this robot can see
    N: ['HA', ...],      // its own hand, and dummy's once the opening lead is made
    S: [...],            // (declarer sees dummy; dummy's seat sees declarer's hand when declarer plays it)
  },
  limits: { E: {...}, W: {...} },  // the app's reading of the auction for the hidden hands (2/1 system); BEN may ignore it
}
```

- The legal cards are the `known[seat]` cards of the suit led in the last trick, if it is incomplete and the robot has any, else all of `known[seat]`.
- `play` requests come only after the opening lead. The opening lead itself is a `lead` request.
- When there is only one legal card, the page plays it without asking.

## Models and caching

- `models/manifest.json` (written by the conversion) lists the files: `{ "files": [{ "name": "bidder.onnx", "bytes": 12345678 }, ...], "totalBytes": 80000000, "worker": "classic" }`. The page shows `totalBytes` (or the sum of `files[].bytes`) before the player confirms the download. Without the file it says "about 60–100 MB".
- Fetch the models with `cachedFetch` in the stub. It keeps them with the Cache API under `ben-models-v1`, so they download once. Change the name in `MODEL_CACHE` to replace the models.
- `sw.js` doesn't precache or handle anything under `ben/models/` and doesn't delete caches that don't start with `bridge-`. Put large files (models, onnxruntime-web's `.wasm`) under `ben/models/` and load them through `cachedFetch`. Other files in `ben/` (the worker and its scripts) go through the app's service worker like the rest of the app.
