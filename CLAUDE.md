# My Tech Kid — project notes

My Tech Kid lets a family member (the **helper**, e.g. a grown-up kid) help a parent or
grandparent (the **parent**) with their phone from anywhere. The parent's phone
has one big "Tap for help" button that reaches the helper, plus an "Is this a scam?"
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
  "They match" → linked. For in-person setup the helper can show the link as a QR code (`web/src/qr.js`) that the parent scans with the camera; the picture check still applies.
- **Onboarding** (Oct 23 2026): the website opens with "Who are you?" (helper /
  "I want help with my phone", which points to the Android download). Helper
  setup: home screen (iPhone), alerts, family name, photo, add someone ("Who are
  they to you?" relationship, shown on the other phone's trust screen). The
  Android app with no link offers "Text someone who can help". The invite page
  copies the invite on Download so the first launch opens it; the practice run
  offers to turn on tapping while the helper is still on the call.
- **A linked phone can't be moved** to another circle by a new invite
  (`requireUnlinked` in `functions/index.js`). Adding more helpers later must
  require approval from an existing helper, never the parent alone.
- **24-hour safety wait** before remote control works for a newly linked
  parent (`members.<uid>.controlAllowedAt`, `CONTROL_WAIT_HOURS`, default 24).
  Enforced on the parent's phone (`ScreenShareService.askForControl`). The beta
  sets it to 0 on the real project in `functions/.env.my-tech-kid` (delete
  before release); emulators and tests still use 24.
- **iPhone parents** can't be remote-controlled by any third-party app (Apple
  restriction); they'll get guided help / FaceTime's built-in remote control
  later. Android parents get full control (MediaProjection + AccessibilityService).
- Sideloaded apps on newer Samsung/Android versions need "Allow restricted
  settings" before Accessibility can be turned on; setup docs must cover that.
- Brand name: **My Tech Kid** (chosen Oct 2026 for its Gen X / boomer appeal:
  parents already say "I'll ask my tech kid"). Earlier working names: "Fam"
  (the GitHub repo is still called Fam) and "Nearby" (mockups). "Quick Question"
  was rejected: too close to the funded video-chat startup Super Quick Question.
  Mockups: https://claude.ai/artifact/JJ2wsqWtCRZqqjaP9qxHpj (copies in `docs/design/`).
- **Look: Liquid Glass** (frosted glass, Geist, orange accent), light and dark, for the
  helper app and website; see `docs/design/DESIGN.md`. Mom's app uses
  **Warm Home** (terracotta, cream and olive; Varela Round + Nunito Sans, bundled).
- **App icon** (chosen Oct 2026): a terracotta heart on a cream phone screen
  on terracotta (so it reads "phone help", not health). Source `docs/design/app-icon.svg`; also the social media
  profile picture. Android uses a vector adaptive icon (+ monochrome for themed icons).

## Layout

- `functions/` — Firebase Cloud Functions (Node 22): `createCircle`,
  `createInvite`, `peekInvite`, `claimInvite`, `confirmInvite`, `removeMember`,
  `renameCircle`, `setMyPhoto` (helper's photo for Mom's big button), `deleteMyAccount` (helper deletes their account from Settings; needs a password typed in the last 5 minutes; the last helper's deletion unlinks the parents and erases the circle), `shareIceServers` (relay passes for screen sharing), and push
  notification triggers. Unit tests: `npm test` (pure helpers in `pairing.js`).
- `backend-tests/` — `npm test` checks `firestore.rules`; `npm run e2e` runs the
  whole pairing flow against local emulators (in the Claude container, unset the
  `*_PROXY` variables for that command).
- `firestore.rules` — who can read/write what. Data model:
  `users/{uid}` (displayName, role, circleId, fcmTokens, device),
  `circles/{cid}` (name, shown as typed when `nameAsTyped`; helperIds, parentIds, members map; `members.<uid>.photo` is a helper's 256 px JPEG data URL, checked by `functions/profile.js`; `members.<uid>.device` is copied from the user doc by `onUserDevice` so helpers know whether to use in-app sharing or FaceTime),
  `circles/{cid}/invites`, `/helpRequests` (+ `/voice/clip`: Mom's voice message, kept 30 days), `/scamChecks`, `/rings` (helper rings a parent's phone), `/screenShares` (+ `/signals`;
  stage 2, see `docs/STAGE2.md`).
- `web/` — helper app, Vite + plain JS + Firebase JS SDK. `npm run build`. Home shows only what needs action; everything set up once (photo, family name, linked people and "Phone lost or replaced?", alerts, look, sign out, delete account) is in Settings (gear, `#/settings`).
  Config in `web/src/config.js`. All person-supplied text goes through `esc()`.
- `android/` — parent app, Kotlin + Jetpack Compose, package `com.amethos.mytechkid`.
  `app/google-services.json` is a placeholder until Firebase is set up.
  Cannot be built in the Claude cloud container (Android SDK host is blocked);
  GitHub Actions builds it. The beta signing key `app/beta.keystore` is
  committed on purpose so updates install over each other — replace it with a
  private key before any public release.
- `iphone/` — iPhone app, Expo (React Native, TypeScript), bundle id
  `com.amethos.mytechkid`, linked to an Expo (EAS) project. Built in Expo's
  cloud (no Mac) by the hand-run `.github/workflows/iphone.yml` (needs the
  `EXPO_TOKEN` secret). In the Claude container `npx expo install` can't reach
  Expo's servers: install with npm at the version in
  `node_modules/expo/bundledNativeModules.json`. Native `ios/` is generated.
  Screen sharing trial: plain test screens link to the family by invite
  (`mytechkid://join`) and share the screen with the helper's watch page;
  Apple's broadcast add-on is Swift in `iphone/targets/broadcast/` (made by
  `@bacons/apple-targets`) and sends the screen over WebRTC itself (the app
  is paused in the background), using Firestore's REST API with the app's
  sign-in. JS changes ship with the "Update iPhone app" workflow (EAS Update).
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
3. **Stage 3 (tapping built in beta, `RemoteControlService.kt`):** remote control (AccessibilityService gestures) and drawing
   arrows; enforce the 24-hour wait; Samsung restricted-settings walkthrough.
4. **Stage 4:** phone health (battery, storage, updates), multiple helpers with
   approval, how-to guides, help history, native iPhone helper app.

## Ideas for later (after testing with Mom; she decides what's next)

- **Screenshot scam checks** (owner's favorite): Mom screenshots a text/email/
  pop-up and shares it to My Tech Kid, or picks it in the app (newest first,
  large); no typing. Helper sees it full size. Needs Firebase Storage (owner
  clicks Build > Storage > Get started), storage rules limited to the circle,
  auto-delete after 30 days.
- Android home-screen widget: "Get help from Josh" without opening the app.
- If the helper doesn't respond in ~2 minutes, show Mom one big "Call Josh"
  button that dials normally.
- Helper quick replies: one-tap "Scam, delete it", "Not now, call you at 5".
- In-person setup: helper scans a code on Mom's phone; skips the link and
  picture check.
