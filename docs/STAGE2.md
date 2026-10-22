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

While a share is live, the helper's page can ask to tap. Mom's phone checks the
family's safety wait (`controlAllowedAt`), whether her accessibility switch is
on, then asks her on her own screen. If she taps Yes, the helper's taps arrive
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
- **Sharp words first.** On a slow connection Mom's phone keeps the picture
  sharp and sends fewer pictures a second; while the helper taps, it leans
  back toward smoothness. It starts at 1 Mbps instead of ramping up, and
  never goes below 0.15 Mbps.
- **H.264 when both phones have it** (hardware video chips on Samsung and
  iPhone). The helper's page asks for it; phones without it use the default.
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
