import { test } from "node:test";
import assert from "node:assert/strict";
import { preferH264, summarize, liveLine, worstLine } from "./quality.js";

test("H.264 goes first, everything else keeps its order", () => {
  const codecs = [{ mimeType: "video/VP8" }, { mimeType: "video/rtx" }, { mimeType: "video/H264", sdpFmtpLine: "a" }, { mimeType: "video/H264", sdpFmtpLine: "b" }];
  assert.deepEqual(preferH264(codecs).map((c) => c.mimeType + (c.sdpFmtpLine ?? "")), ["video/H264a", "video/H264b", "video/VP8", "video/rtx"]);
  assert.deepEqual(preferH264([{ mimeType: "video/VP8" }]), [{ mimeType: "video/VP8" }]);
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
