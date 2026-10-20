// Relay passes for screen sharing (docs/STAGE2.md). Most phones connect
// directly; some networks (mobile carriers, offices) block that, and then the
// picture goes through Cloudflare's relay. It still can't see anything: the
// connection stays end-to-end encrypted between the two phones.

// Public servers that help the phones find a direct path. Always included.
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

// Long enough for the longest share (an hour) plus reconnecting.
const PASS_SECONDS = 2 * 60 * 60;

// Cloudflare's answer, made safe to hand to the phones: only the fields WebRTC
// needs, and no port 53 addresses (browsers block them, and they slow down
// connecting while the browser gives up on them).
function cleanIceServers(body) {
  const list = Array.isArray(body?.iceServers) ? body.iceServers : [body?.iceServers].filter(Boolean);
  const out = [];
  for (const s of list) {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls])
      .filter((u) => typeof u === "string" && /^(stuns?|turns?):/.test(u) && !/:53(\?|$)/.test(u));
    if (!urls.length) continue;
    const server = { urls };
    if (typeof s.username === "string") server.username = s.username;
    if (typeof s.credential === "string") server.credential = s.credential;
    out.push(server);
  }
  return out;
}

// Asks Cloudflare for a short-lived pass. Returns STUN only when the relay
// isn't set up yet or doesn't answer quickly, so sharing still works as before.
async function relayPass({ keyId, apiToken, fetchImpl = fetch, timeoutMs = 3000 }) {
  if (!keyId || !apiToken) return STUN;
  try {
    const res = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: PASS_SECONDS }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    const servers = cleanIceServers(await res.json());
    if (!servers.some((s) => s.urls.some((u) => u.startsWith("turn")))) throw new Error("no relay in the answer");
    return [...STUN, ...servers.filter((s) => s.urls.some((u) => u.startsWith("turn")))];
  } catch (err) {
    console.warn("relay pass", err.message);
    return STUN;
  }
}

module.exports = { STUN, PASS_SECONDS, cleanIceServers, relayPass };
