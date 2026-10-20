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

## Still to build

| Piece | Where | Needs from the owner |
|---|---|---|
| Short-lived relay passes, only for the two people on a live share | `functions/` | A free Cloudflare account and a TURN key, saved as Firebase secrets (steps to be added to `docs/SETUP.md`) |
| On-phone check | Samsung test phone | Mom's or a test Android phone |

Until the relay exists, the phones connect directly (STUN). That works on
most home Wi-Fi and phone networks; some strict networks will fail to
connect, and the watch page then says so.

The relay passes are left out for now on purpose: a function that needs a
secret would stop every deploy until that secret exists.
