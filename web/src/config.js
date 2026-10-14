// Fill these in from the Firebase console (see docs/SETUP.md, step 3).
// None of these values are secret: access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: "YOUR-API-KEY",
  authDomain: "YOUR-PROJECT-ID.firebaseapp.com",
  projectId: "YOUR-PROJECT-ID",
  storageBucket: "YOUR-PROJECT-ID.firebasestorage.app",
  messagingSenderId: "YOUR-SENDER-ID",
  appId: "YOUR-APP-ID",
};

// Project settings > Cloud Messaging > Web Push certificates > Key pair.
export const vapidKey = "YOUR-WEB-PUSH-KEY";

// Must match applicationId in android/app/build.gradle.kts.
export const androidPackage = "com.amethos.fam";
export const apkPath = "/download/fam-beta.apk";

export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR-");
