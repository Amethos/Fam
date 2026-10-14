const test = require("node:test");
const assert = require("node:assert");
const { deadTokens } = require("../alerts");

const pairs = [{ uid: "mom", token: "a" }, { uid: "mom", token: "b" }, { uid: "josh", token: "c" }];
const fail = (code) => ({ success: false, error: { code } });

test("forgets only devices that are gone for good", () => {
  const res = [fail("messaging/registration-token-not-registered"), { success: true }, fail("messaging/invalid-registration-token")];
  assert.deepStrictEqual(deadTokens(pairs, res), [pairs[0], pairs[2]]);
});

test("a bad message never wipes everyone's devices", () => {
  const res = pairs.map(() => fail("messaging/invalid-argument"));
  assert.deepStrictEqual(deadTokens(pairs, res), []);
});

test("temporary failures keep the device", () => {
  const res = [fail("messaging/internal-error"), fail("messaging/server-unavailable"), fail("messaging/quota-exceeded")];
  assert.deepStrictEqual(deadTokens(pairs, res), []);
});
