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

// The helper's alert for a new scam check. Alerts show up on lock screens,
// so they never include the message or picture itself (it can hold codes or
// account numbers); the helper sees those after opening the app.
function scamAlert(check) {
  const name = check.parentName || "Your family";
  return {
    title: `${name} asks: is this a scam?`,
    body: check.imagePath ? "They sent a picture of their screen. Tap to see it." : "Tap to see the message.",
  };
}

module.exports = { deadTokens, scamAlert };
