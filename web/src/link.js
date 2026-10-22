// How the live connection to Mom's phone is doing, so the helper's page can
// say so and hold taps back instead of landing them on a picture that is
// out of date. Pure helpers, tested in link.test.js.

// Mom's phone answers a ping every second; no answer for this long means
// her picture is probably behind too.
export const PING_EVERY_MS = 1000;
export const SLOW_AFTER_MS = 1500;
// How long Mom's phone keeps trying to find a new path before ending.
export const RECONNECT_GIVE_UP_MS = 30_000;

// "ok", "slow" (taps paused, the picture is catching up) or "reconnecting"
// (the network path dropped and Mom's phone is finding a new one).
// pings: Mom's app answers pings (older versions don't, so never "slow").
export function linkState({ connection, pings, lastPong, now }) {
  if (connection === "disconnected" || connection === "failed") return "reconnecting";
  if (connection !== "connected") return "ok";
  if (pings && now - lastPong > SLOW_AFTER_MS) return "slow";
  return "ok";
}

// A finger that has moved this far (of her screen) is dragging, so it is
// sent live as it moves instead of as one swipe at the end.
export const DRAG_START = 0.02;
export function isDrag(start, p) {
  return Math.hypot(p.x - start.x, p.y - start.y) >= DRAG_START;
}
