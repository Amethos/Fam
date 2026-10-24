# My Tech Kid for iPhone

The iPhone app, built with [Expo](https://expo.dev). Expo builds it on its own
Macs in the cloud, so no Mac is needed. The Android app stays in `android/`.

Right now this is a placeholder screen. The plan and the order of work are in
the "Expo for the iPhone app" doc (https://claude.ai/artifact/8Vc1iRpg6Bxb1H4uxuFxfE).

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

The app can link to the family and show its screen to the helper's page,
like Mom's Android app. The iPhone can't be tapped for (Apple allows that
only in FaceTime). The screens are plain test screens for now.

1. On a computer, open the helper web app and send an invite ("Add Mom or
   Dad"). Open the invite link on the test iPhone and tap **Testing the iPhone
   app? Open the invite there**.
2. Tap Continue, check the three pictures with the helper page, and tap
   **They match** on both.
3. Tap **Share my screen**, then **Start Broadcast** in Apple's sheet.
4. On the computer, tap the share card to watch. Then leave the app on the
   iPhone and open others: does the picture keep coming?

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
