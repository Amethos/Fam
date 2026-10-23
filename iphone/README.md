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

## For developers

```bash
npm ci
npm run typecheck
npx expo prebuild --platform ios --no-install   # checks app.json and plugins
```

Native folders (`ios/`) are generated; never edit or commit them. See `CLAUDE.md`.
