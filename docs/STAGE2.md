# Stage 2 plan: seeing Mom's screen

This is the plan for live screen view and voice. The data model and its
safety rules are already built and tested (`firestore.rules`,
`backend-tests/rules.test.js`); the app screens come next.

## How a session works

1. **Mom starts it.** She taps "Get help", then "Show my screen". Her phone
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

## Still to build

| Piece | Where | Needs from the owner |
|---|---|---|
| Short-lived relay passes, only for the two people on a live share | `functions/` | A free Cloudflare account and a TURN key, saved as Firebase secrets (steps to be added to `docs/SETUP.md`) |
| "Show my screen", the banner and Stop | `android/` (MediaProjection, a foreground service) | Nothing |
| Watching page with voice | `web/` | Nothing |
| Allow the microphone on our own page only | `firebase.json` `Permissions-Policy` | Nothing |
| On-phone check | Samsung test phone | Mom's or a test Android phone |

The relay passes are left out for now on purpose: a function that needs a
secret would stop every deploy until that secret exists.
