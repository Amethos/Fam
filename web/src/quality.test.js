import { test } from "node:test";
import assert from "node:assert/strict";
import { preferFormat, summarize, liveLine, worstLine, sentLine, worstSent, timelinePoint, timelineText, MAX_TIMELINE } from "./quality.js";

test("VP8 goes first, everything else keeps its order", () => {
  const codecs = [{ mimeType: "video/H264", sdpFmtpLine: "a" }, { mimeType: "video/rtx" }, { mimeType: "video/VP8" }, { mimeType: "video/H264", sdpFmtpLine: "b" }];
  assert.deepEqual(preferFormat(codecs).map((c) => c.mimeType + (c.sdpFmtpLine ?? "")), ["video/VP8", "video/H264a", "video/rtx", "video/H264b"]);
  assert.deepEqual(preferFormat(codecs, "H264").map((c) => c.mimeType + (c.sdpFmtpLine ?? "")), ["video/H264a", "video/H264b", "video/rtx", "video/VP8"]);
});

test("a share's numbers come from the video and the path it took", () => {
  const stats = [
    { id: "v", type: "inbound-rtp", kind: "video", framesDecoded: 1200, frameHeight: 1170, bytesReceived: 7_500_000, packetsReceived: 990, packetsLost: 10, freezeCount: 2, codecId: "c" },
    { id: "c", type: "codec", mimeType: "video/H264" },
    { id: "p", type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.0824, localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "relay" },
    { id: "r", type: "remote-candidate", candidateType: "srflx" },
  ];
  assert.deepEqual(summarize(stats, 60), {
    seconds: 60, relay: true, rttMs: 82, fps: 20, height: 1170, kbps: 1000, lossPct: 1, freezes: 2, codec: "H264",
  });
});

test("missing stats give zeros, never errors", () => {
  assert.deepEqual(summarize([], 0), { seconds: 1, relay: false, rttMs: 0, fps: 0, height: 0, kbps: 0, lossPct: 0, freezes: 0, codec: "" });
});

test("the menu's connection line says delay, format, path and smoothness", () => {
  const stats = [
    { id: "v", type: "inbound-rtp", kind: "video", framesPerSecond: 24.4, codecId: "c" },
    { id: "c", type: "codec", mimeType: "video/H264" },
    { id: "p", type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.0824, localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "host" },
    { id: "r", type: "remote-candidate", candidateType: "srflx" },
  ];
  assert.equal(liveLine(stats), "82 ms · H264 · direct · 24 fps");
  assert.equal(liveLine([]), "direct · 0 fps");
});

test("a relay reached over TCP says so, since it freezes on loss", () => {
  const stats = [
    { id: "p", type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.12, localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "relay", relayProtocol: "tls" },
    { id: "r", type: "remote-candidate", candidateType: "srflx" },
  ];
  assert.equal(liveLine(stats), "120 ms · relay tcp · 0 fps");
});

test("the worst moment while moving is remembered for a minute", () => {
  const samples = [
    { at: 1000, rttMs: 90, fps: 24 },
    { at: 3000, rttMs: 410, fps: 6 },
    { at: 5000, rttMs: 120, fps: 18 },
  ];
  assert.equal(worstLine(samples, 6000), "While you moved: 6 fps at worst, 410 ms");
  assert.equal(worstLine(samples, 64_000), "While you moved: 18 fps at worst, 120 ms");
  assert.equal(worstLine([], 0), "");
});

test("sentLine says what Mom's phone sends and what holds it back", () => {
  assert.equal(sentLine(null, "Mom"), "");
  assert.equal(sentLine({ fps: 2.6, w: 540, h: 1168, codec: "H264", enc: "MediaCodecVideoEncoder", est: 812.6, why: "cpu" }, "Mom"),
    "Mom's phone sends 3 fps · 540×1168 · H264 · MediaCodecVideoEncoder · 813 kbps allowed · phone too busy");
  assert.equal(sentLine({ fps: 58, why: "none" }, "Mom", true), "While you moved, Mom's phone sent 58 fps");
});

test("worstSent picks the slowest report while moving", () => {
  const now = 100_000;
  const samples = [
    { at: now - 70_000, sent: { fps: 0 } },
    { at: now - 5_000, sent: { fps: 20 } },
    { at: now - 3_000, sent: { fps: 4, why: "cpu" } },
    { at: now - 1_000 },
  ];
  assert.deepEqual(worstSent(samples, now), { fps: 4, why: "cpu" });
  assert.equal(worstSent([], now), null);
});

test("the timeline is numbers only, in the format the rules check", () => {
  const start = 1_000_000;
  assert.equal(timelinePoint({ at: start + 4_400, start, rttMs: 22.4, fps: 2.6, sent: { fps: 3, h: 1168, why: "cpu" }, moving: true }), "4,22,3,3,1168,c,1,0;");
  assert.equal(timelinePoint({ at: start + 2_000, start, rttMs: undefined, fps: 0, sent: undefined, moving: false }), "2,0,0,0,0,-,0,0;");
  assert.equal(timelinePoint({ at: start, start, rttMs: 1, fps: 5000, sent: { fps: -3, h: 10, why: "<b>", est: 2500.4 } }), "0,1,999,0,10,-,0,2500;");
  const points = Array.from({ length: MAX_TIMELINE + 5 }, (_, i) => timelinePoint({ at: start + i * 2000, start, rttMs: 99999, fps: 999, sent: { fps: 999, h: 9999, why: "cpu", est: 999999 }, moving: true }));
  const text = timelineText(points);
  assert.ok(text.startsWith("10,99999,999,999,9999,c,1,999999;"));
  // The same pattern and size cap as firestore.rules.
  assert.ok(text.length <= 12000, `${text.length}`);
  assert.match(text, /^([0-9]{1,5},[0-9]{1,5},[0-9]{1,3},[0-9]{1,3},[0-9]{1,4},[cbon-],[01](,[0-9]{1,6})?;)*$/);
});
