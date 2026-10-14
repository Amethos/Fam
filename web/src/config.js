// Fill these in from the Firebase console (see docs/SETUP.md, step 3).
// None of these values are secret: access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyC5erd38-FD8DpJG3eHPyPQv9OWLuvAAbo",
  authDomain: "my-tech-kid.firebaseapp.com",
  projectId: "my-tech-kid",
  storageBucket: "my-tech-kid.firebasestorage.app",
  messagingSenderId: "491750036445",
  appId: "1:491750036445:web:8e9b29050980b77b589c34",
};

// Project settings > Cloud Messaging > Web Push certificates > Key pair.
export const vapidKey = "YOUR-WEB-PUSH-KEY";

// Must match applicationId in android/app/build.gradle.kts.
export const androidPackage = "com.amethos.mytechkid";
export const apkPath = "/download/mytechkid-beta.apk";

export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR-");
