# One-time setup (about 20 minutes)

My Tech Kid runs on **Firebase**, Google's service for app logins, data and notifications.
You do these steps once, on a computer, then GitHub builds and publishes
everything automatically.

Things marked **send to Claude** are safe to paste into chat. The one marked
**never paste in chat** is a real password.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project**. Name it `mytechkid` (Firebase may add numbers, like `mytechkid-3f2a1`).
3. Google Analytics: you can turn it off. Click **Create project**.
4. **Send to Claude:** the project ID (shown under the project name, e.g. `mytechkid-3f2a1`).

## 2. Switch to the pay-as-you-go plan

My Tech Kid's backend needs this plan. Testing with your family should stay within the
free allowance, so expect $0, but Google asks for a card.

1. Bottom-left, click **Upgrade** and choose **Blaze**.
2. When asked, set a **budget alert** of $5 so you get an email if it ever costs anything.

## 3. Turn on the building blocks

1. Left menu → **Build → Authentication** → **Get started**.
   - Turn on **Email/Password** (for you, the helper).
   - Turn on **Anonymous** (Mom's phone signs in by itself, without a password).
2. Left menu → **Build → Firestore Database** → **Create database**.
   - Pick a location near you (for the US, `nam5` or `us-central1`). Start in **production mode**.

## 4. Add the web app (your side)

1. Go to **Project settings** (gear icon) → **General** → **Your apps** → click the **</>** (web) icon.
2. Nickname: `My Tech Kid helper`. Tick **Also set up Firebase Hosting**. Click **Register app**.
3. **Send to Claude:** the `firebaseConfig` block it shows (apiKey, authDomain, projectId and so on).
   Skip the "install the SDK" and "deploy" steps; GitHub handles those.

## 5. Add the Android app (Mom's side)

1. Still in **Your apps**, click **Add app** → the **Android** icon.
2. Package name: `com.amethos.mytechkid` (exactly). Nickname: `My Tech Kid for Mom`. Click **Register app**.
3. Download **google-services.json**. **Send to Claude:** open the file and paste its contents.
4. Skip the remaining steps.

## 6. Get the web push key (for alerts on your iPhone)

1. **Project settings → Cloud Messaging** → scroll to **Web Push certificates** → **Generate key pair**.
2. **Send to Claude:** the long key it shows.

## 7. Let GitHub publish My Tech Kid

1. **Project settings → Service accounts** → **Generate new private key** → **Generate key**. A file downloads.
2. **Never paste this file in chat.** It's the master key to your project.
3. Give that key permission to publish: click **Manage service account permissions** (or go to
   <https://console.cloud.google.com/iam-admin/iam> and pick your project). Find the account that
   starts with `firebase-adminsdk`, click the pencil, and add these roles:
   **Editor**, **Cloud Functions Admin**, **Service Account User**. Save.
4. On GitHub, open your **fam** repo → **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: open the downloaded file in Notepad, copy **everything**, paste it here. Click **Add secret**.
5. You can delete the downloaded file afterwards.

## 8. Tell Claude you're done

Claude puts your settings into the code and pushes. GitHub then builds and
publishes everything (watch it under the repo's **Actions** tab). The very
first publish can take 10+ minutes, and sometimes fails once while Google
switches services on; if it does, Claude can re-run it.

When it's green:

- **Your helper app:** `https://<project-id>.web.app`
- **Mom's app download:** `https://<project-id>.web.app/download/mytechkid-beta.apk`
  (you normally don't need this: the invite link offers it)

Next: [TESTING.md](TESTING.md).

## Keep the repo private

The repo contains the beta signing key for Mom's app. Keep the GitHub repo
**private** until we swap it for a private key before any public release.
