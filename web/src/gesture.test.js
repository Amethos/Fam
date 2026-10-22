import { test } from "node:test";
import assert from "node:assert/strict";
import { fitVideo, gestureFor, pointOnVideo } from "./gesture.js";

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

test("fills the area, cutting off her top bar and phone buttons", () => {
  // Her 1000x2000 screen with a 5% top bar and 5% buttons, in a 400x720 area:
  // the 1800 tall middle fits 720 exactly at 0.4, so 400 wide, no side bars.
  const box = fitVideo(400, 720, 1000, 2000, 0.05, 0.05);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000 + 0]));
  assert.deepEqual(round(box), { left: 0, top: -40, width: 400, height: 800 });
  // A touch at the top of the area lands just under her top bar.
  assert.deepEqual(round(pointOnVideo(box, 1000, 2000, 200, 0)), { x: 0.5, y: 0.05 });
  // Nothing to cut: plain fit, with at most 6% extra zoom.
  const plain = fitVideo(400, 800, 100, 400);
  assert.equal(Math.round(plain.height), Math.round(800 * 1.06));
  assert.equal(fitVideo(400, 800, 0, 0), null, "no video yet");
});
