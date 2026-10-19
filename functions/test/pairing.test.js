const test = require("node:test");
const assert = require("node:assert");
const { PICTURES, RELATIONSHIPS, cleanRelationship, pickPictures, newToken, hashToken } = require("../pairing");

test("pictures are distinct", () => {
  for (let i = 0; i < 200; i++) {
    const keys = pickPictures(3).map((p) => p.key);
    assert.strictEqual(new Set(keys).size, 3);
  }
});

test("picture keys are unique", () => {
  assert.strictEqual(new Set(PICTURES.map((p) => p.key)).size, PICTURES.length);
});

test("tokens are random and hashes are stable", () => {
  const a = newToken();
  assert.notStrictEqual(a, newToken());
  assert.ok(a.length >= 32);
  assert.strictEqual(hashToken(a), hashToken(a));
  assert.notStrictEqual(hashToken(a), a);
});

test("relationships: known keys pass, anything else becomes other", () => {
  assert.strictEqual(cleanRelationship("grandparent"), "grandparent");
  assert.strictEqual(cleanRelationship("neighbor"), "neighbor");
  assert.strictEqual(cleanRelationship("boss"), "other");
  assert.strictEqual(cleanRelationship(undefined), "other");
  assert.strictEqual(cleanRelationship("toString"), "other");
  assert.strictEqual(RELATIONSHIPS.parent, "your child");
});
