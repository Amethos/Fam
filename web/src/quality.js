// How smooth a screen share was, and which video format to ask for.
// Pure helpers, so they can be tested without a real connection.

// The video format to ask Mom's phone for. H.264 looked best on paper
// (hardware chips on both phones), but Gray's Samsung sent only about 2
// pictures a second with it while scrolling, so VP8 goes first. Formats the
// browser can't match keep their order after it, so nothing is lost.
export const VIDEO_FORMAT = "VP8";
export function preferFormat(codecs, name = VIDEO_FORMAT) {
  const match = (c) => c.mimeType?.toLowerCase() === `video/${name.toLowerCase()}`;
  return [...codecs.filter(match), ...codecs.filter((c) => !match(c))];
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
  const fps = liveFps(stats);
  return [s.rttMs ? `${s.rttMs} ms` : "", s.codec, s.relay ? `relay${viaTcp(stats) ? " tcp" : ""}` : "direct", `${fps} fps`]
    .filter(Boolean).join(" · ");
}

// A relay reached over TCP waits for every lost piece before showing the
// next picture, so one dropped packet can freeze the screen for seconds.
function viaTcp(stats) {
  const pair = stats.find((x) => x.type === "candidate-pair" && (x.nominated || x.selected) && x.state === "succeeded");
  const local = pair && stats.find((x) => x.id === pair.localCandidateId);
  return /^(tcp|tls)$/i.test(local?.relayProtocol ?? "");
}

export function liveFps(stats) {
  const video = stats.find((x) => x.type === "inbound-rtp" && x.kind === "video");
  return Math.round(video?.framesPerSecond ?? 0);
}

// The menu closes when the helper touches the screen, so it also remembers
// the worst moment while their finger was on it (a still screen sends no
// pictures, so only those moments count). samples: [{ at, rttMs, fps }].
export const WORST_WINDOW_MS = 60_000;
export function worstLine(samples, now) {
  const recent = samples.filter((x) => now - x.at <= WORST_WINDOW_MS);
  if (!recent.length) return "";
  const fps = Math.min(...recent.map((x) => x.fps));
  const rtt = Math.max(...recent.map((x) => x.rttMs));
  return `While you moved: ${fps} fps at worst${rtt ? `, ${rtt} ms` : ""}`;
}

// What Mom's phone says it actually sends (newer versions of her app), so a
// slow share can be pinned on her phone or the network. sent: { fps, w, h,
// why, enc, codec }; why is "cpu" (her phone is too busy) or "bandwidth".
export function sentLine(sent, name, moving = false) {
  if (!sent) return "";
  const fps = Math.round(Number(sent.fps) || 0);
  const why = { cpu: "phone too busy", bandwidth: "network too slow" }[sent.why] ?? "";
  const parts = [`${fps} fps`, sent.w && sent.h ? `${sent.w}×${sent.h}` : "", String(sent.codec ?? "").slice(0, 10),
    String(sent.enc ?? "").slice(0, 30), why].filter(Boolean);
  return `${moving ? `While you moved, ${name}'s phone sent` : `${name}'s phone sends`} ${parts.join(" · ")}`;
}

// The slowest picture rate Mom's phone reported while the helper's finger
// was on the screen, within the same window as worstLine.
export function worstSent(samples, now) {
  const recent = samples.filter((x) => x.sent && now - x.at <= WORST_WINDOW_MS);
  return recent.reduce((low, x) => (!low || (Number(x.sent.fps) || 0) < (Number(low.fps) || 0) ? x.sent : low), null);
}
