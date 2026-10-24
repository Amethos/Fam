import { test } from "node:test";
import assert from "node:assert/strict";
import { thisDevice, helpMethod, deviceLabel } from "./device.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const HOME_SCREEN = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S911U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

test("knows which phone the helper is on", () => {
  assert.deepEqual(thisDevice(IPHONE, 5), { platform: "ios", model: "iPhone", osVersion: 26 });
  assert.deepEqual(thisDevice(HOME_SCREEN, 5), { platform: "ios", model: "iPhone", osVersion: 17 });
  assert.deepEqual(thisDevice(IPAD, 5), { platform: "ios", model: "iPad", osVersion: 18 });
  assert.deepEqual(thisDevice(IPAD, 0), { platform: "computer" });
  assert.deepEqual(thisDevice(SAMSUNG, 5), { platform: "android", osVersion: 14 });
});

test("picks the way to help from both phones", () => {
  const iphone18 = { platform: "ios", osVersion: 18 };
  assert.equal(helpMethod({ platform: "android" }, iphone18), "app");
  assert.equal(helpMethod(iphone18, iphone18), "app-view-tap-on-facetime");
  assert.equal(helpMethod({ platform: "ios", osVersion: 17 }, iphone18), "app-view");
  assert.equal(helpMethod(iphone18, { platform: "android", osVersion: 14 }), "app-view");
  assert.equal(helpMethod(iphone18, { platform: "computer" }), "app-view");
  assert.equal(helpMethod(undefined, iphone18), null);
});

test("describes a phone in a few words", () => {
  assert.equal(deviceLabel({ platform: "android", model: "Samsung SM-S911U", osVersion: 14 }), "Samsung SM-S911U · Android 14");
  assert.equal(deviceLabel({ platform: "ios", model: "iPhone" }), "iPhone · iOS");
  assert.equal(deviceLabel(undefined), "");
});
