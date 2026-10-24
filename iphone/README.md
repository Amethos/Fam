# My Tech Kid for iPhone

The iPhone app, built with [Expo](https://expo.dev). Expo builds it on its own
Macs in the cloud, so no Mac is needed. The Android app stays in `android/`.

It's the app for someone getting help on an iPhone: the same screens as Mom's
Android app in the Warm Home look (approved mockups:
https://claude.ai/artifact/KqMNhJSYhXtNo7pSZ4T7Qi): linking by invite with the
picture check, a practice run, the big "Tap for help" button (with a voice
message first), "Is this a scam?", and showing the screen with Apple's Start
Broadcast. Code: screens in `src/app/index.tsx`, the look in
`src/components/ui.tsx`, what the phone knows and does in `src/lib/family.ts`.

## One-time setup (Gray)

1. **Apple Developer Program** ($99 a year): sign up at
   https://developer.apple.com/programs/enroll with your Apple ID.
2. **Expo access token:** on expo.dev, click your picture > Account settings >
   Access tokens > Create token. Name it `GitHub`, then copy it.
3. **Give it to GitHub:** in the Fam repo, Settings > Secrets and variables >
   Actions > New repository secret. Name `EXPO_TOKEN`, paste the token, Save.
4. **Apple sign-in for Expo (once):** Expo needs to make the app's Apple
   certificates the first time, and Apple wants you to sign in for that. Claude
   will walk you through it when we get there (one command on any computer,
   Windows works too).

## Building

GitHub > Actions > **Build iPhone app** > Run workflow. Pick `production` to
send it to TestFlight. The build takes 15 to 30 minutes on Expo's free plan;
follow it on expo.dev. Install TestFlight on your iPhone to get it.

## Development build (live changes on your iPhone)

A development build is the app plus `expo-dev-client`, so code changes show up
on the phone in seconds instead of after a new build. iPhone builds need a Mac,
so `npx expo run:ios` can't run on a Windows PC; Expo's cloud makes the same
build instead.

1. Register your iPhone once: `npx eas-cli@latest device:create` (any
   computer), then open the link it shows on the iPhone and install the profile.
2. Turn on Developer Mode on the iPhone: Settings > Privacy & Security >
   Developer Mode.
3. Run **Build iPhone app** with `development`, then open the install link from
   expo.dev on the iPhone.
4. On a computer on the same Wi-Fi: `cd iphone`, `npm ci`, `npx expo start`,
   and scan the QR code with the iPhone camera.

## Screen sharing test

1. On a computer, open the helper web app and send an invite ("Add Mom or
   Dad"). Open the invite link on the test iPhone and tap **Testing the iPhone
   app? Open the invite there**.
2. Tap Continue, check the three pictures with the helper page, and tap
   **They match** on both.
3. Tap **Tap for help**. On the computer, tap **I'm on it**. On the iPhone,
   tap **Show … my screen**, then **Start Broadcast** in Apple's sheet.
4. Leave the app on the iPhone and open others: does the picture keep coming?

Hold "Test version" at the top for the share diary (test builds only).

## Alerts

Alerts reach iPhones through Expo's push service (`src/lib/alerts.ts`,
`notifyExpo` in `functions/index.js`). Apple needs a push key and the Push
Notifications switch on the app, which only an interactive build can set up
(once): on the PC, `git pull`, `cd iphone`, `npm ci`, then
`npx eas-cli@latest build --platform ios --profile preview`, sign in to Apple
when asked, and answer **Yes** to setting up push notifications. GitHub builds
work again after that.

How it works: Apple runs a small add-on (`targets/broadcast/`, Swift) for as
long as the red bar shows. The app makes the share (`src/lib/share.ts`) and
hands it to the add-on through the shared app group, and the add-on sends
the screen to the helper over WebRTC itself (`ShareSession.swift`), speaking
the same language as `ScreenShareService.kt`. It has to: iOS pauses the app
a few seconds after Mom leaves it.

## Builds and updates

- **Build iPhone app** (GitHub Actions, run by hand): `preview` gives an
  install link that works on its own (the link is in the job summary);
  `development` needs `npx expo start` on a computer; `production` goes to
  TestFlight. A new build is only needed when native parts change.
- **Update iPhone app**: sends JavaScript changes to installed `preview` or
  `production` apps, which pick them up the next time they open. An update
  only reaches builds with the same native parts (runtime "fingerprint").

## For developers

```bash
npm ci
npm run typecheck
npx expo prebuild --platform ios --no-install   # checks app.json and plugins
```

Native folders (`ios/`) are generated; never edit or commit them. See `CLAUDE.md`.
