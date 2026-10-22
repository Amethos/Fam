// How smooth a screen share was, and which video format to ask for.
// Pure helpers, so they can be tested without a real connection.

// Both phones have a chip for H.264 video: faster and easier on the battery
// than the default (VP8, which an iPhone decodes in software). Formats the
// browser can't match keep their order after it, so nothing is lost if
// Mom's phone can't do H.264.
export function preferH264(codecs) {
  const h264 = codecs.filter((c) => /\/h264$/i.test(c.mimeType));
  return [...h264, ...codecs.filter((c) => !/\/h264$/i.test(c.mimeType))];
}

// A few numbers about one share, saved on its record when it ends so we can
// see how real networks do: no screen content, nothing about Mom's phone.
// stats is the list of entries from RTCPeerConnection.getStats().
export function summarize(stats, seconds) {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const video = stats.find((s) => s.type === "inbound-rtp" && s.kind === "video");
  const pair = stats.find((s) => s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded");
  const local = pair && byId.get(pair.localCandidateId);
  const remote = pair && byId.get(pair.remoteCandidateId);
  const secs = Math.max(1, Math.round(seconds));
  const round = (n) => (Number.isFinite(n) ? Math.round(n) : 0);
  const received = video?.packetsReceived ?? 0;
  const lost = Math.max(0, video?.packetsLost ?? 0);
  const codec = video?.codecId ? byId.get(video.codecId)?.mimeType?.split("/")[1] : "";
  return {
    seconds: secs,
    relay: local?.candidateType === "relay" || remote?.candidateType === "relay",
    rttMs: round((pair?.currentRoundTripTime ?? 0) * 1000),
    fps: round((video?.framesDecoded ?? 0) / secs),
    height: round(video?.frameHeight ?? 0),
    kbps: round(((video?.bytesReceived ?? 0) * 8) / secs / 1000),
    lossPct: received + lost ? Math.round((lost / (received + lost)) * 1000) / 10 : 0,
    freezes: round(video?.freezeCount ?? 0),
    codec: String(codec ?? "").slice(0, 20),
  };
}

// Right now, for the helper's menu: how long a round trip to Mom's phone
// takes, the video format, whether it goes through the relay, and pictures
// a second. Lets a test say why it feels slow instead of guessing.
export function liveLine(stats) {
  const s = summarize(stats, 1);
  const video = stats.find((x) => x.type === "inbound-rtp" && x.kind === "video");
  const fps = Math.round(video?.framesPerSecond ?? 0);
  return [s.rttMs ? `${s.rttMs} ms` : "", s.codec, s.relay ? "relay" : "direct", `${fps} fps`]
    .filter(Boolean).join(" · ");
}
