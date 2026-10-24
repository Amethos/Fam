// Pure helpers for push alerts, kept separate so they can be unit tested.

// Only these errors mean the phone or browser itself is gone for good
// (app uninstalled, alerts turned off, token from another project).
// Anything else, such as "invalid-argument", can be caused by the message,
// and would otherwise make us forget every device at once.
const DEAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

// pairs: [{ uid, token }] in the order they were sent; responses: the
// matching sendEachForMulticast results. Returns the pairs to forget.
function deadTokens(pairs, responses) {
  return pairs.filter((_, i) => DEAD_TOKEN_CODES.includes(responses[i]?.error?.code));
}

// iPhones get alerts through Expo's push service (the iPhone app is built
// with Expo), which passes them to Apple. Only real Expo tokens are sent to.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[\w-]{10,200}\]$/;

function isExpoToken(token) {
  return typeof token === "string" && EXPO_TOKEN.test(token);
}

// One Expo message per phone. A ring is "time-sensitive" so it comes
// through Focus modes; it is dropped after two minutes like on Android.
function expoMessages(tokens, { title, body, link, ring }) {
  return tokens.map((to) => ({
    to,
    title,
    body,
    sound: "default",
    priority: "high",
    ...(ring ? { interruptionLevel: "time-sensitive", ttl: 120 } : {}),
    data: { link: link ?? "/", ...(ring ? { type: "ring" } : {}) },
  }));
}

// pairs: [{ uid, token }] in the order sent; tickets: Expo's answers in the
// same order. Only "DeviceNotRegistered" means the app is gone for good.
function deadExpoTokens(pairs, tickets) {
  return pairs.filter((_, i) => tickets?.[i]?.status === "error" && tickets[i].details?.error === "DeviceNotRegistered");
}

module.exports = { deadTokens, isExpoToken, expoMessages, deadExpoTokens };
