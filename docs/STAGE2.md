# Stage 2 plan: seeing Mom's screen

Live screen view is built: Mom's app (`ScreenShareService.kt`) and the
helper's watch page (`web/src/watch.js`), on top of the tested rules in
`firestore.rules`. Voice is left to the phone call they're already on.

## How a session works

1. **Mom starts it.** She taps "Get help"; once her helper answers, she taps
   "Show <name> my screen" and says yes to Android's own prompt. Her phone
   creates `circles/{cid}/screenShares/{id}` with `status: "waiting"`.
   Only her own phone can do this, so nobody can start watching on their own.
2. **A helper joins** within 10 minutes (`status: "live"`, `helperId`). Only
   one helper can join, and an old request can't be picked up later.
3. **The phones connect directly.** They swap WebRTC setup messages in
   `screenShares/{id}/signals`, which only Mom and the joined helper can
   read or write, and only while the share is live. The picture and sound go
   phone to phone, end-to-end encrypted; when a direct path isn't possible a
   TURN relay passes along the encrypted stream without being able to see it.
4. **Either side ends it** (`status: "ended"`). An ended share can't restart;
   it stays as the family's history of who connected, when and for how long.

## Rules we keep (from SECURITY.md)

- Mom's phone shows a banner with the helper's name and a big **Stop** button
  the whole time.
- Apps that block screenshots (banking, passwords) stay black.
- Nothing is recorded or stored.

## Tapping for Mom (stage 3, beta)

Mom's Start on Android's share prompt is her yes to seeing and tapping (the
screen behind it says so). When the connection opens, her phone checks the
family's safety wait (`controlAllowedAt`) and whether her accessibility switch
is on, and turns tapping on by itself. If the switch is off, the helper's page
can ask to tap, which walks her through turning it on. Then the helper's taps arrive
over a data channel in the same WebRTC connection and `RemoteControlService`
performs them, with a Stop bar on top. The beta turns the safety wait off on the
real project (`functions/.env.my-tech-kid`).

If the helper's page reloads, it sends a `hello` signal with a new connection
id (`gen`); Mom's phone replaces the old connection with a fresh one and ignores
setup messages for the old one. Tapping always ends with the old connection and
needs Mom's Yes again. A newer window of the same helper takes over from an
older one, which shows a note instead of ending the share.

## Keeping it smooth on any network

The full plan is in the project's "Smooth remote help on any network" doc.
Built so far:

- **Ready before the helper joins.** Mom's phone sets up the connection while
  she waits and sends it the moment her helper joins (the rules only allow
  setup messages on a live share, so they wait in an outbox until then).
- **A late relay pass still counts.** If the pass comes after the 4-second
  wait, Mom's phone adds it and looks for a new path on the same connection
  (an ICE restart); the helper's page adds it too.
- **Smooth first.** Mom's screen is sent as live video, not a slide show:
  pictures that can't keep up are skipped instead of queued. On a slow
  connection it trades sharpness and pictures a second evenly; while the
  helper taps, it keeps the pictures a second up and lets words soften
  (Gray saw about 5 pictures a second and 5-second stalls opening apps with
  the older "sharp words first" setting). It starts at 1 Mbps instead of ramping up, and
  never goes below 0.15 Mbps.
- **H.264 when both phones have it** (hardware video chips on Samsung and
  iPhone). The helper's page asks for it; phones without it use the default.
- **A fast lane for pings and finger moves.** A second data channel
  ("fast": unordered, never resent) carries only pings and drag moves, so one
  lost packet can't hold up the rest the way it does on the reliable
  "control" channel. Moves are numbered; Mom's phone drops one that arrives
  after a newer one or after the finger lifted. Taps, downs, ups and
  everything else stay on "control". Mom's phone ignores anything else on
  "fast".
- **VP8, 60 pictures a second.** Gray's first numbers (Oct 23): about 110 ms
  delay on a direct path, but only 2 pictures a second while scrolling with
  H.264 on the Samsung. The helper's page now asks for VP8 first
  (`preferFormat` in `web/src/quality.js`); Mom's phone captures at half size
  in steps of 16 pixels and aims for 60 pictures a second (up to 4 Mbps, raised to 8 Mbps after Gray's timeline showed the
  picture shrinking to fit under 4 Mbps).
  The menu's numbers line says the format and the worst moment while the
  helper's finger was on the screen.
- **VP8 from Mom's side too, and her own numbers.** The second test still
  came through as H.264 (22 ms, 0-3 pictures a second), so Mom's offer now
  lists VP8 first as well (`preferVp8` in `ScreenShareService.kt`). Every 2
  seconds her phone tells the helper's page what it actually sends: pictures
  a second, size, format, encoder and what holds it back ("phone too busy" or
  "network too slow"). Numbers only, nothing from her screen.
- **Timeline of each share.** The helper's page notes those numbers every 2
  seconds (delay, pictures shown, pictures sent, size, what held it back,
  whether the helper's finger was moving) and saves the last 10 minutes with
  the share's numbers when it ends (`timelinePoint` in `web/src/quality.js`;
  the rules only accept digits in that format). To read them back, run
  **Actions > Share numbers > Run workflow** (`tools/share-numbers.mjs`),
  which prints the latest shares without names or ids.
- **Software VP8.** Gray's third test (Oct 23): VP8 at last, but on the
  Samsung's VP8 chip (`c2.exynos.vp8.encoder`) only about 10 pictures a second
  at 396×876, held back by "bandwidth" right next to a gigabit router. That is
  WebRTC's own speed guess collapsing, typical of a chip encoder overshooting
  its budget. Mom's phone now encodes VP8 in software (`ScreenEncoderFactory`)
  and reports WebRTC's guess ("kbps allowed") in the menu and the timeline.
  The first timeline save failed on the real database; the pattern check is
  now a plain `*` with a size cap, and if the timeline is still refused the
  basic numbers are saved without it.
- **Back to the VP8 chip, and the whole pipeline in the timeline.** The saved
  timelines (Oct 23) showed the Samsung's VP8 chip sending 50-60 pictures a
  second most of the time (dropping to 876 high while "network" held it back),
  and software VP8 only 30-45, so the chip is back. Both had short dips near
  0, which can be a still screen or a stall. Each timeline moment now also has
  the pictures Android captured, ms to encode, ms waiting in the helper's
  buffer and ms to decode, and the menu's "at worst" skips moments when Mom's
  screen was still. WebRTC's speed guess is read from the path in use.
- **What the timeline showed (Oct 23, VP8 chip, same Wi-Fi):** about 85
  pictures captured a second, 60 sent and 60 shown most of the time, 5-10 ms
  network, about 35 ms to encode, 40-100 ms waiting in the helper's buffer
  (one spike of 0.5 s), 3 ms to decode. The "network" limit was our own 4
  Mbps cap, now 8. A few 2-second stretches where the helper's phone showed
  far fewer pictures than arrived are still unexplained.
- **Finger moves 60 times a second.** Scrolling in Chrome (Oct 23 test): Mom's
  screen only changed about 20 times a second while the helper's finger moved,
  matching the helper sending a move every 50 ms (a web page moves only when
  the finger does; the home screen animates in between). Moves now go out
  every 16 ms.
- **Hunting the hiccups.** After the 60-a-second moves (Oct 23), the helper's
  buffer stayed at 20-90 ms, but in some 2-second stretches Mom's phone sent
  far fewer pictures than it captured, or the helper's phone showed far fewer
  than arrived. The timeline now also counts full pictures sent, the helper's
  requests for one, re-sent pieces, pictures the helper dropped and freezes,
  and keeps the last 8 minutes.
- **An even 60, and more room on a direct path.** The counts (Oct 23) showed
  no lost pieces, no requests for full pictures and no drops on the helper's
  side, so the network was fine. Instead Android handed the encoder 85-90
  pictures a second (the Samsung screen draws up to 120) and it skipped them
  in bursts, and the picture still hit the 8 Mbps cap and shrank while
  scrolling. Mom's phone now passes the encoder an even 60 a second, and on
  a direct path (no relay) the cap is 16 Mbps; through the relay it stays 8.
  (The first try used WebRTC's `adaptOutputFormat`, which crops the picture
  to the size it's given: the helper saw a square. Mom's phone now just skips
  pictures that come less than 14 ms after the last one.)
- **Picks up her next share by itself.** If the helper is still on the
  "share ended" screen and the same person taps Show my screen again, the
  helper's page opens the new share without going back first.
- **Relay pass fetched early.** While Mom's request is waiting, the helper's
  page already asks for its relay pass (the backend lets any helper in her
  circle ask while it waits), and tapping "I'm on it" wakes the backend, so
  joining no longer waits on a cold start.
- **Connection numbers in the menu.** While watching, the helper's menu shows
  delay, video format, relay or direct, and pictures a second
  (`liveLine` in `web/src/quality.js`), refreshed every 2 seconds.
- **How smooth was it?** When a share ends, the helper's page saves a few
  numbers on the share (`quality`: seconds, relay used, delay, pictures a
  second, height, data rate, loss, freezes, video format). The rules allow it
  once, from the joined helper, numbers only.

- **Riding out a dropped signal.** When the network path drops (walking
  out of Wi-Fi range), Mom's phone restarts ICE on the same connection for
  up to 30 seconds instead of ending the share; her notification says
  "Reconnecting to <helper>…". Taps that arrive while it's down, or within a
  second after, are dropped. The helper's banner says "Reconnecting to
  <name>…" and dims her picture.
- **No taps on a frozen picture.** The helper's page pings Mom's phone every
  second over the control channel; no answer for 1.5 seconds shows "Slow
  connection" and holds taps back until it answers again (`web/src/link.js`).
- **Live drags.** A moving finger goes to Mom's phone as down / move / up
  (moves at most every 50 ms, and every 300 ms while resting), and
  `RemoteControlService.drag` continues the same touch with each piece, so
  lists scroll as the helper's finger moves. No moves for a second lifts the
  finger. Mom's app says what it supports (`caps`) when the channel opens;
  older versions get the old one-swipe-at-the-end.

## Still to build

| Piece | Where | Needs from the owner |
|---|---|---|
| On-phone check | Samsung test phone | Mom's or a test Android phone |

## The relay (TURN)

Some networks (mobile carriers, offices, hotel Wi-Fi) block a direct
connection between the phones. Then the encrypted stream goes through
Cloudflare's relay, which passes it along without being able to see it.

- `shareIceServers` (`functions/index.js`, `functions/relay.js`) hands out a
  2-hour relay pass, only to the parent of an open share and to the helper
  who joined it. The Cloudflare key stays in the backend.
- Mom's phone asks for it as soon as she starts sharing, so it's ready when
  the helper joins; the helper's page asks right after joining. Neither waits
  more than 4 seconds: without an answer they use direct connections only.
- The key comes from the GitHub secrets `CLOUDFLARE_TURN_KEY_ID` and
  `CLOUDFLARE_TURN_API_TOKEN` (`docs/SETUP.md`, step 9), which the deploy adds
  to `functions/.env.my-tech-kid`. Without them, deploys still work and
  sharing uses direct connections only.
