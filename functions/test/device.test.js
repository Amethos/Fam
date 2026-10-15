const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cleanDevice, sameDevice } = require("../device");

test("keeps only a known platform, a short model and a sensible version", () => {
  assert.deepEqual(cleanDevice({ platform: "android", model: " Samsung SM-S911U ", osVersion: 14 }),
    { platform: "android", model: "Samsung SM-S911U", osVersion: 14 });
  assert.deepEqual(cleanDevice({ platform: "ios", osVersion: 18 }), { platform: "ios", osVersion: 18 });
  assert.deepEqual(cleanDevice({ platform: "ios", model: "x".repeat(80), osVersion: 1000 }),
    { platform: "ios", model: "x".repeat(60) });
  assert.equal(cleanDevice({ platform: "toaster" }), null);
  assert.equal(cleanDevice(undefined), null);
});

test("notices when the phone changes", () => {
  assert.ok(sameDevice({ platform: "android", osVersion: 14 }, { platform: "android", osVersion: 14 }));
  assert.ok(!sameDevice({ platform: "android", osVersion: 14 }, { platform: "android", osVersion: 15 }));
  assert.ok(!sameDevice(null, { platform: "ios" }));
});
