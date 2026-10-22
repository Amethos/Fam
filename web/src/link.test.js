import { test } from "node:test";
import assert from "node:assert/strict";
import { linkState, isDrag } from "./link.js";

test("a dropped path is reconnecting, a late answer is slow", () => {
  const now = 10_000;
  assert.equal(linkState({ connection: "connected", pings: true, lastPong: now - 900, now }), "ok");
  assert.equal(linkState({ connection: "connected", pings: true, lastPong: now - 2000, now }), "slow");
  assert.equal(linkState({ connection: "disconnected", pings: true, lastPong: now, now }), "reconnecting");
  assert.equal(linkState({ connection: "failed", pings: true, lastPong: now, now }), "reconnecting");
});

test("older phones that don't answer pings are never called slow", () => {
  assert.equal(linkState({ connection: "connected", pings: false, lastPong: 0, now: 99_999 }), "ok");
});

test("still connecting isn't a problem to report", () => {
  assert.equal(linkState({ connection: "connecting", pings: true, lastPong: 0, now: 99_999 }), "ok");
});

test("a finger that moves is a drag", () => {
  assert.equal(isDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }), false);
  assert.equal(isDrag({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.53 }), true);
});
