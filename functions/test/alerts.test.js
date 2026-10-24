const test = require("node:test");
const assert = require("node:assert");
const { deadTokens, isExpoToken, expoMessages, deadExpoTokens } = require("../alerts");

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

test("only real Expo tokens count", () => {
  assert.ok(isExpoToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  assert.ok(isExpoToken("ExpoPushToken[abcdefghij-1234]"));
  assert.ok(!isExpoToken("ExponentPushToken[]"));
  assert.ok(!isExpoToken("https://evil.example/ExponentPushToken[xxxxxxxxxxxx]"));
  assert.ok(!isExpoToken(42));
});

test("iPhone alerts carry only the title and body, rings are time-sensitive", () => {
  const [plain] = expoMessages(["t"], { title: "Josh is coming to help", body: "Soon." });
  assert.deepStrictEqual(plain, { to: "t", title: "Josh is coming to help", body: "Soon.", sound: "default", priority: "high", data: { link: "/" } });
  const [ring] = expoMessages(["t"], { title: "Josh is ringing your phone", body: "", ring: true });
  assert.equal(ring.interruptionLevel, "time-sensitive");
  assert.equal(ring.ttl, 120);
  assert.equal(ring.data.type, "ring");
});

test("forgets only iPhones whose app is gone", () => {
  const tickets = [
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "ok", id: "x" },
    { status: "error", details: { error: "MessageRateExceeded" } },
  ];
  assert.deepStrictEqual(deadExpoTokens(pairs, tickets), [pairs[0]]);
  assert.deepStrictEqual(deadExpoTokens(pairs, undefined), []);
});
