const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cleanCircleName, cleanPhoto, MAX_PHOTO } = require("../profile");

const jpeg = (size = 200) => {
  const bytes = Buffer.alloc(size, 7);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
};

test("keeps the family name exactly as typed", () => {
  assert.equal(cleanCircleName("Team Blue"), "Team Blue");
  assert.equal(cleanCircleName("  the   scherz family "), "the scherz family");
  assert.equal(cleanCircleName("Josh‮'s\u0007 Family"), "Josh's Family");
  assert.equal(cleanCircleName("x".repeat(60)).length, 40);
  assert.equal(cleanCircleName(undefined), "");
  assert.equal(cleanCircleName("   "), "");
});

test("accepts only a small real JPEG photo", () => {
  assert.equal(cleanPhoto(jpeg()), jpeg());
  assert.equal(cleanPhoto("data:image/png;base64,iVBORw0KGgo="), null);
  assert.equal(cleanPhoto(`data:image/jpeg;base64,${Buffer.alloc(200, 1).toString("base64")}`), null);
  assert.equal(cleanPhoto('data:image/jpeg;base64,/9j/" onerror="x'), null);
  assert.equal(cleanPhoto("https://example.com/me.jpg"), null);
  assert.equal(cleanPhoto(jpeg(MAX_PHOTO)), null);
  assert.equal(cleanPhoto(null), null);
});
