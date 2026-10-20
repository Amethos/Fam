const test = require("node:test");
const assert = require("node:assert");
const { deadTokens, scamAlert } = require("../alerts");

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

test("scam alerts never show the message or picture", () => {
  const text = scamAlert({ parentName: "Mom", text: "Your code is 482913, account 4111 1111 1111 1111" });
  assert.strictEqual(text.title, "Mom asks: is this a scam?");
  assert.ok(!text.body.includes("482913") && !text.body.includes("4111"));
  const picture = scamAlert({ parentName: "Mom", text: "", imagePath: "circles/c1/scamShots/mom/s1.jpg" });
  assert.match(picture.body, /picture/);
  assert.ok(!picture.body.includes("circles/"));
});
