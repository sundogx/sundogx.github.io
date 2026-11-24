# Feature: "your turn" cues and table comfort (feat-notify)

## Done
New file **`bridge/js/notify.js`** (loaded just before `js/app.js`; **add `js/notify.js` to sw.js CORE**). Hooks are small and marked `/* feature: notify */`:
- `index.html`: one script tag.
- `app.js`: `updateTitle()` defers to `Notify.title()`; `render()` calls `Notify.onRender(T)`; Options shows `Notify.optionsHTML(opt)` and calls `Notify.optionChanged()`; `loadLobby()` runs `Notify.filterTables()`.
- `style.css`: two rules at the end (`.awayme`, `.lobbyf select`).

What it does:
1. **Tab title and favicon**: while the tab is hidden *or unfocused* and it's your turn, the title is "● Your turn – Bridge" and the favicon gets a gold dot (drawn on a canvas from icon-192.png). No flashing. Chat that comes in while you're in the background shows as "(n) Chat – Bridge" (your turn wins). Both clear when you come back.
2. **Notifications** (Options > Online play > Notifications, off by default): browser permission is asked only when you tick the box, and the box unticks if permission is refused. You get a notification for your turn (bid or play) and for chat lines from others, only while the tab is in the background. They're silent and close when you return.
3. **Sound**: "Turn sound" in Options is the existing More > Sound beep, now remembered (`Prefs.turnSound`) and kept in step with the More button. "Card sounds" (off by default) is a short, quiet filtered-noise tick made with WebAudio for each card played.
4. **Your own away state**: the server marks you away while none of your connections is open. If the connection has been down for more than 2.5 s, a thin-outlined bar under the top bar says "You are away: the connection was lost…" with an **I'm back** button (`Net.reconnect()`). It goes away once you're connected again. While connected, the server always clears your away mark, so this is the only time you can be away.
5. **Lobby**: a small "Show tables" select next to Refresh (All, With a free seat, Pairs, Team matches, Timed), remembered in `Prefs.lobbyFilter`, plus a **Join next free seat** button. It picks the busiest unlocked table in the filter with an empty seat (or else a robot seat), opens it and sits.

## Tested
- `cd bridge && npm test` passes.
- Playwright with system Chrome against `wrangler dev --port 8797`. The test replaced config.js so it used the local Worker, and service workers were blocked. Scripts are in the scratchpad (`feat-notify/t.mjs`, `t2.mjs`). They check: the options appear and are saved; the title stays plain while focused; the title and favicon dot appear in the background (hidden/hasFocus stubbed) and clear on focus; turn and chat notifications fire (Notification stubbed); turn beats chat in the title; the away bar appears after the socket is dropped, and I'm back reconnects and clears it; the turn sound survives a reload; the lobby filter works; Join next free seat sits a second user at a free seat.
- The only console error is Chrome blocking the existing `navigator.vibrate` in `beep()` before the user taps anything (a pre-existing harmless warning).

## Left / notes
- Card-sound audio wasn't checked by ear (headless). Like any WebAudio, it only plays after the user has tapped the page.
- Join next free seat doesn't look at seat preference or partner; it takes the first free seat (empty before robot).
- No new icons or audio files.
