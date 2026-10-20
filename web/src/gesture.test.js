import { test } from "node:test";
import assert from "node:assert/strict";
import { gestureFor, pointOnVideo } from "./gesture.js";

test("a short touch is a tap, a long one a hold, a moving one a swipe", () => {
  const p = { x: 0.5, y: 0.5 };
  assert.deepEqual(gestureFor(p, { x: 0.505, y: 0.5 }, 120), { t: "tap", x: 0.5, y: 0.5 });
  assert.deepEqual(gestureFor(p, p, 900), { t: "hold", x: 0.5, y: 0.5 });
  assert.deepEqual(gestureFor(p, { x: 0.5, y: 0.1 }, 250), { t: "swipe", x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.1, ms: 250 });
  assert.equal(gestureFor(p, { x: 0.9, y: 0.5 }, 10).ms, 80);
  assert.equal(gestureFor(p, { x: 0.9, y: 0.5 }, 9000).ms, 1500);
});

test("maps a touch on a letterboxed video to Mom's screen", () => {
  // A 400x800 box showing a 100x400 phone: it's 200 wide, centered (100px bars each side).
  const box = { left: 0, top: 0, width: 400, height: 800 };
  assert.deepEqual(pointOnVideo(box, 100, 400, 200, 400), { x: 0.5, y: 0.5 });
  assert.deepEqual(pointOnVideo(box, 100, 400, 100, 0), { x: 0, y: 0 });
  assert.equal(pointOnVideo(box, 100, 400, 50, 400), null, "the black bar misses");
  assert.equal(pointOnVideo(box, 0, 0, 200, 400), null, "no video yet");
});
