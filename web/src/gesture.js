// Turns a helper's finger on Mom's screen into a tap for her phone.
// Points are 0..1 of her screen's width and height.

// A short touch is a tap, a long one a press-and-hold, a moving one a swipe.
export function gestureFor(start, end, ms) {
  const moved = Math.hypot(end.x - start.x, end.y - start.y);
  if (moved < 0.02) return ms >= 500 ? { t: "hold", x: start.x, y: start.y } : { t: "tap", x: start.x, y: start.y };
  return { t: "swipe", x1: start.x, y1: start.y, x2: end.x, y2: end.y, ms: Math.round(Math.min(Math.max(ms, 80), 1500)) };
}

// Where a pointer is on a letterboxed video (object-fit: contain), or null on
// the black bars. rect is the element's box; the video is videoW x videoH.
export function pointOnVideo(rect, videoW, videoH, clientX, clientY) {
  if (!videoW || !videoH) return null;
  const scale = Math.min(rect.width / videoW, rect.height / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  const x = (clientX - rect.left - (rect.width - w) / 2) / w;
  const y = (clientY - rect.top - (rect.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
