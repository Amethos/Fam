# My Tech Kid — project notes

My Tech Kid lets a family member (the **helper**, e.g. a grown-up kid) help a parent or
grandparent (the **parent**) with their phone from anywhere. The parent's phone
has one big "Get help" button that reaches the helper, plus an "Is this a scam?"
button. Only linked family can ever connect: that closed circle is the main
anti-scam selling point.

The owner is not a developer. Explain things in plain language, keep setup steps
click-by-click, and never paste secrets into chat or commits.

## Keep it simple (the owner's #1 rule)

The product succeeds by being simple. Check every change against these:

1. The parent never types, never logs in, never picks a setting.
2. One screen, one job. The parent's app stays at two buttons, maximum.
3. Faces and names, not words like "account", "permission" or "settings".
4. If something is confusing, remove it before explaining it.
5. A feature goes in the parent's app only if it saves the parent a step;
   extra power belongs on the helper's side.
6. Not doing: chat/messaging, feeds or tips, ads, a settings screen for the
   parent, "just in case" features.

## Security comes first

This app will be able to see and control a parent's phone. Read `SECURITY.md`
before changing pairing, rules, or anything in stages 2-3, and keep its rules
(never unattended, always visible, 24-hour wait, end-to-end encrypted). Every
rules or pairing change needs a test in `backend-tests/`.

## Decisions so far

- **One app, two roles** (helper / getting help). For the beta the roles are
  split by platform: the helper uses the **web app** (`web/`, added to the iPhone
  home screen, so no Apple developer fee yet) and the parent uses the **Android
  app** (`android/`, installed from a download link, not the Play Store).
  Test devices: helper on iPhone, parent (Mom) on a **Samsung** Android phone.
- **Closed family circle.** Only the backend (`functions/`) changes membership;
  `firestore.rules` keeps circles read-only for the apps.
- **Pairing from far away:** helper texts a single-use link (expires in 1 hour)
  → parent's phone shows "<helper> wants to help — only continue if this is
  family" → both phones show the same 3 pictures → on a phone call both tap
  "They match" → linked. A QR code option for in-person setup is planned.
- **A linked phone can't be moved** to another circle by a new invite
  (`requireUnlinked` in `functions/index.js`). Adding more helpers later must
  require approval from an existing helper, never the parent alone.
- **24-hour safety wait** before remote control works for a newly linked
  parent (`members.<uid>.controlAllowedAt`, `CONTROL_WAIT_HOURS`, default 24).
  The parent's app must enforce it once remote control exists.
- **iPhone parents** can't be remote-controlled by any third-party app (Apple
  restriction); they'll get guided help / FaceTime's built-in remote control
  later. Android parents get full control (MediaProjection + AccessibilityService).
- Sideloaded apps on newer Samsung/Android versions need "Allow restricted
  settings" before Accessibility can be turned on; setup docs must cover that.
- Brand name: **My Tech Kid** (chosen Oct 2026 for its Gen X / boomer appeal:
  parents already say "I'll ask my tech kid"). Earlier working names: "Fam"
  (the GitHub repo is still called Fam) and "Nearby" (mockups). "Quick Question"
  was rejected: too close to the funded video-chat startup Super Quick Question.
  Mockups: https://claude.ai/artifact/JJ2wsqWtCRZqqjaP9qxHpj

## Layout

- `functions/` — Firebase Cloud Functions (Node 22): `createCircle`,
  `createInvite`, `peekInvite`, `claimInvite`, `confirmInvite`, and push
  notification triggers. Unit tests: `npm test` (pure helpers in `pairing.js`).
- `backend-tests/` — `npm test` checks `firestore.rules`; `npm run e2e` runs the
  whole pairing flow against local emulators (in the Claude container, unset the
  `*_PROXY` variables for that command).
- `firestore.rules` — who can read/write what. Data model:
  `users/{uid}` (displayName, role, circleId, fcmTokens),
  `circles/{cid}` (name, helperIds, parentIds, members map),
  `circles/{cid}/invites`, `/helpRequests`, `/scamChecks`.
- `web/` — helper app, Vite + plain JS + Firebase JS SDK. `npm run build`.
  Config in `web/src/config.js`. All person-supplied text goes through `esc()`.
- `android/` — parent app, Kotlin + Jetpack Compose, package `com.amethos.mytechkid`.
  `app/google-services.json` is a placeholder until Firebase is set up.
  Cannot be built in the Claude cloud container (Android SDK host is blocked);
  GitHub Actions builds it. The beta signing key `app/beta.keystore` is
  committed on purpose so updates install over each other — replace it with a
  private key before any public release.
- `.github/workflows/build.yml` — tests backend, builds web + APK, and deploys
  everything to Firebase on pushes to `main` once the
  `FIREBASE_SERVICE_ACCOUNT` secret exists. The APK is served at
  `/download/mytechkid-beta.apk` and invite links at `/join`.
- `docs/SETUP.md` — owner's one-time Firebase setup. `docs/TESTING.md` — test script.

## Roadmap

1. **Stage 1 (built):** accounts, family circle, pairing, big help button with
   alerts, scam check with answers.
2. **Stage 2:** live screen view (WebRTC; parent shares via MediaProjection,
   helper watches in the web app) + voice, with a TURN relay (e.g. Cloudflare).
3. **Stage 3:** remote control (AccessibilityService gestures) and drawing
   arrows; enforce the 24-hour wait; Samsung restricted-settings walkthrough.
4. **Stage 4:** phone health (battery, storage, updates), multiple helpers with
   approval, how-to guides, help history, native iPhone helper app.

## Ideas for later (after testing with Mom; she decides what's next)

- **Screenshot scam checks** (owner's favorite): Mom screenshots a text/email/
  pop-up and shares it to My Tech Kid, or picks it in the app (newest first,
  large); no typing. Helper sees it full size. Needs Firebase Storage (owner
  clicks Build > Storage > Get started), storage rules limited to the circle,
  auto-delete after 30 days.
- Helper's photo on Mom's big button instead of an initial.
- Android home-screen widget: "Get help from Josh" without opening the app.
- If the helper doesn't respond in ~2 minutes, show Mom one big "Call Josh"
  button that dials normally.
- Helper quick replies: one-tap "Scam, delete it", "Not now, call you at 5".
- In-person setup: helper scans a code on Mom's phone; skips the link and
  picture check.
