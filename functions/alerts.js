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

module.exports = { deadTokens };
