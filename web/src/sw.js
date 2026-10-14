// Background push for the helper web app (iPhone: only after "Add to Home Screen").
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { firebaseConfig, isConfigured } from "./config.js";

if (isConfigured) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  // Messages with a `notification` payload are shown automatically; this only
  // covers data-only messages.
  onBackgroundMessage(messaging, (payload) => {
    if (payload.notification) return;
    self.registration.showNotification(payload.data?.title ?? "Fam", { body: payload.data?.body ?? "" });
  });
}

// Tapping a notification opens its link: the Firebase SDK handles that via
// webpush.fcmOptions.link set by the backend.
