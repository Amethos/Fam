// Watching Mom's screen (stage 2). Mom's phone starts every share; the helper
// joins it here, and the two phones connect directly with WebRTC (end-to-end
// encrypted). Firestore only carries the short setup messages
// (circles/{cid}/screenShares/{id}/signals), which the rules limit to the two
// people on a live share. Nothing is recorded.
//
// Tapping for Mom (stage 3) uses a data channel on the same connection. Her
// phone decides everything: the family's safety wait, her accessibility
// switch, and her own "Yes". This page only asks, then sends taps as points
// (0..1 of her screen) while her phone says control is on.
//
// The page lives in its own <section id="watch"> outside #app, so the rest of
// the app can keep re-rendering without restarting the video.

import {
  doc, collection, query, orderBy, onSnapshot, addDoc, updateDoc, serverTimestamp, runTransaction,
} from "firebase/firestore";
import { esc } from "./util.js";
import { fitVideo, gestureFor, pointOnVideo } from "./gesture.js";
import { preferFormat, summarize, liveLine, liveFps, worstLine, sentLine, worstSent, timelinePoint, timelineText, receiveDelays } from "./quality.js";
import { linkState, isDrag, PING_EVERY_MS, RECONNECT_GIVE_UP_MS } from "./link.js";

// Public STUN servers find a direct path between the phones. The backend adds
// a short-lived relay pass for networks that block direct paths, once the
// relay is set up (docs/STAGE2.md); without it, these are used.
const ICE_SERVERS = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const ICE_WAIT_MS = 4000;

// The relay pass, or plain STUN if the backend is slow or says no. A pass
// that turns up after the wait still goes to onLate, so the connection can
// use it instead of it being thrown away.
async function iceServersFrom(fetchServers, onLate) {
  if (!fetchServers) return ICE_SERVERS;
  const usable = (got) => (Array.isArray(got?.iceServers) && got.iceServers.length ? got.iceServers : null);
  let late = false;
  let timer;
  const fetching = Promise.resolve().then(fetchServers);
  fetching.then((got) => { if (late && usable(got)) onLate?.(usable(got)); }).catch(() => {});
  const slow = new Promise((resolve) => { timer = setTimeout(() => { late = true; resolve(null); }, ICE_WAIT_MS); });
  try {
    return usable(await Promise.race([fetching, slow])) ?? ICE_SERVERS;
  } catch (err) {
    console.warn("relay pass", err);
    return ICE_SERVERS;
  } finally {
    clearTimeout(timer);
  }
}

const FALLBACK_NAME = "Your family member";
let session = null;
let current = null; // the share this page is open for, so re-renders don't re-join

function overlay() {
  let el = document.getElementById("watch");
  if (!el) {
    el = document.createElement("section");
    el.id = "watch";
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

function show(name, message, { video = false } = {}) {
  const el = overlay();
  el.hidden = false;
  document.body.classList.add("watching");
  if (!el.querySelector("video")) {
    const icon = (d, size = 20) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    el.innerHTML = `
      <div class="watch-stage">
        <video autoplay playsinline muted></video>
        <p class="watch-note"></p>
      </div>
      <div class="watch-top">
        <a class="watch-float watch-exit" href="#/" aria-label="Back (ends sharing)">${icon('<path d="M15 5l-7 7 7 7"/>', 22)}</a>
        <div class="watch-banner" role="status"><span class="watch-dot"></span>
          <span class="watch-connecting"></span><span class="watch-live"></span><span class="watch-tapping"></span><span class="watch-pointing"></span><span class="watch-weak"></span><span class="watch-short"></span></div>
        <button class="watch-float watch-menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="watch-menu">
          ${icon('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>', 22)}<span class="watch-dot"></span></button>
      </div>
      <div class="watch-scrim" hidden></div>
      <div class="watch-menu" id="watch-menu" hidden>
        <div class="watch-status">
          <span class="watch-state"><span class="watch-dot"></span><span class="watch-connecting">Connecting</span><span class="watch-live">Live</span><span class="watch-tapping">You're tapping</span></span>
          <strong class="watch-title"></strong>
          <span class="watch-stats"></span>
        </div>
        <div class="watch-control" hidden>
          <button data-watch-ask>${icon('<path d="M9 11V5a2 2 0 0 1 4 0v6"/><path d="M13 10a2 2 0 0 1 4 0v2"/><path d="M17 12a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L4 15a2 2 0 0 1 3.4-2L9 15"/>')}<span class="watch-ask-label"></span></button>
          <p class="watch-control-note" role="status"></p>
          <button class="watch-alerts" data-key="notifications" hidden>${icon('<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>')}Pull down alerts</button>
          <button data-watch-point aria-pressed="false">${icon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>')}<span class="watch-point-label"></span></button>
        </div>
        <button class="danger" data-watch-stop><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>Stop sharing</button>
      </div>
      <nav class="watch-keys" aria-label="Phone buttons" hidden>
        <button data-key="recents" aria-label="Recent apps">${icon('<path d="M7 6v12M12 6v12M17 6v12"/>', 24)}</button>
        <button data-key="home" aria-label="Home">${icon('<rect x="5" y="5" width="14" height="14" rx="5"/>', 24)}</button>
        <button data-key="back" aria-label="Back">${icon('<path d="M15 5l-7 7 7 7"/>', 24)}</button>
      </nav>
      <section class="watch-guide" aria-live="polite" hidden>
        <div class="watch-guide-head"><span class="watch-guide-kicker"></span>
          <button class="watch-guide-hide" aria-label="Hide these steps">${icon('<path d="M6 6l12 12M18 6L6 18"/>', 18)}</button></div>
        <h2 class="watch-guide-title"></h2>
        <ol class="watch-guide-steps"></ol>
        <p class="watch-guide-note"></p>
      </section>
      <p class="watch-weak-note" role="status" hidden></p>
      <p class="watch-toast" role="status" hidden></p>`;
    el.querySelector("[data-watch-stop]").addEventListener("click", () => { location.hash = "#/"; });
    el.querySelector("[data-watch-ask]").addEventListener("click", () => {
      send({ t: "ask" });
      setControl({ state: "sent" });
    });
    el.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => {
      send({ t: "key", name: b.dataset.key });
      // A flash, so a press never seems to do nothing while her screen catches up.
      b.classList.remove("pressed");
      void b.offsetWidth;
      b.classList.add("pressed");
    }));
    el.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("animationend", () => b.classList.remove("pressed")));
    el.querySelector(".watch-banner").addEventListener("click", () => bannerPulse());
    el.querySelector("[data-watch-point]").addEventListener("click", () => {
      setPointing(!pointing);
      if (pointing) setMenu(false);
      bannerPulse();
    });
    addMenuButton(el.querySelector(".watch-menu-btn"));
    el.querySelector(".watch-scrim").addEventListener("click", () => setMenu(false));
    el.querySelector(".watch-guide-hide").addEventListener("click", () => { el.querySelector(".watch-guide").hidden = true; });
    addGestures(el.querySelector("video"));
    // Keep her picture filling the screen as it or the screen changes size.
    el.querySelector("video").addEventListener("resize", layoutVideo);
    el.querySelector("video").addEventListener("loadedmetadata", layoutVideo);
    if (window.ResizeObserver) new ResizeObserver(layoutVideo).observe(el.querySelector(".watch-stage"));
    else window.addEventListener("resize", layoutVideo);
  }
  el.querySelector(".watch-title").textContent = `${name}'s screen`;
  el.querySelector(".watch-banner .watch-connecting").textContent = `Connecting to ${name}…`;
  el.querySelector(".watch-banner .watch-live").textContent = `You're on ${name}'s screen`;
  el.querySelector(".watch-banner .watch-tapping").textContent = `Tapping on ${name}'s phone`;
  el.querySelector(".watch-banner .watch-pointing").textContent = `Showing ${name} where to tap`;
  el.querySelector(".watch-point-label").textContent = `Show ${name} where`;
  el.querySelector(".watch-note").innerHTML = message ? esc(message) : "";
  el.querySelector("video").hidden = !video;
  if (video !== el.classList.contains("live")) {
    el.classList.toggle("live", video);
    bannerPulse();
  }
  // The back button always leaves (and ends the share); the menu, with Stop
  // in it, is only there while watching.
  el.querySelector("[data-watch-stop]").hidden = !session;
  el.querySelector(".watch-menu-btn").hidden = !session;
  el.querySelector(".watch-banner").hidden = !session;
  if (!session) setMenu(false);
}

// The pop-out menu: everything besides Back lives here, so her screen can
// fill the helper's.
function setMenu(open) {
  const el = document.getElementById("watch");
  if (!el?.querySelector(".watch-menu")) return;
  el.querySelector(".watch-menu").hidden = !open;
  el.querySelector(".watch-scrim").hidden = !open;
  el.querySelector(".watch-menu-btn").setAttribute("aria-expanded", String(open));
  el.classList.toggle("menu-open", open);
  if (open) placeMenu(el);
}

// The banner says whose screen this is, then shrinks to a small pill after a
// few seconds so it covers less of her screen. A change of state (or a tap on
// it) shows it in full again.
let bannerTimer;
function bannerPulse() {
  const el = document.getElementById("watch");
  const banner = el?.querySelector(".watch-banner");
  if (!banner) return;
  banner.querySelector(".watch-short").textContent = link === "reconnecting" ? "Reconnecting" : link === "slow" ? "Slow"
    : pointing ? "Pointing" : el.classList.contains("controlling") ? "Tapping" : (session?.name ?? FALLBACK_NAME);
  banner.classList.remove("compact");
  clearTimeout(bannerTimer);
  if (el.classList.contains("live")) bannerTimer = setTimeout(() => banner.classList.add("compact"), 4000);
}

// The menu button can be dragged out of the way; a short press opens the menu.
const MENU_SPOT = "watch-menu-spot";
function addMenuButton(btn) {
  let start = null;
  let dragged = false;
  const put = (x, y) => {
    const size = btn.offsetWidth || 48;
    btn.style.position = "fixed";
    btn.style.left = `${Math.min(Math.max(8, x - size / 2), innerWidth - size - 8)}px`;
    btn.style.top = `${Math.min(Math.max(8, y - size / 2), innerHeight - size - 8)}px`;
  };
  try {
    const spot = JSON.parse(localStorage.getItem(MENU_SPOT) ?? "null");
    if (spot) put(spot.x * innerWidth, spot.y * innerHeight);
  } catch { /* no saved spot */ }
  btn.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY };
    dragged = false;
    btn.setPointerCapture?.(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
    dragged = true;
    btn.classList.add("dragging");
    put(e.clientX, e.clientY);
    if (!document.querySelector("#watch .watch-menu").hidden) placeMenu(document.getElementById("watch"));
  });
  const end = (e) => {
    if (!start) return;
    start = null;
    btn.classList.remove("dragging");
    if (dragged) {
      const r = btn.getBoundingClientRect();
      try { localStorage.setItem(MENU_SPOT, JSON.stringify({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight })); } catch { /* fine */ }
    } else if (e.type === "pointerup") {
      setMenu(document.querySelector("#watch .watch-menu").hidden);
    }
  };
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
  // Keyboard and screen readers still open it with a click.
  btn.addEventListener("click", (e) => { if (e.detail === 0) setMenu(document.querySelector("#watch .watch-menu").hidden); });
}

// Opens the menu next to the menu button, wherever it has been dragged.
function placeMenu(el) {
  const btn = el.querySelector(".watch-menu-btn");
  const menu = el.querySelector(".watch-menu");
  menu.style.cssText = "";
  if (btn.style.position !== "fixed") return;
  const r = btn.getBoundingClientRect();
  const below = r.top + r.height / 2 < innerHeight / 2;
  const onLeft = r.left + r.width / 2 < innerWidth / 2;
  menu.style.top = below ? `${r.bottom + 10}px` : "auto";
  menu.style.bottom = below ? "auto" : `${innerHeight - r.top + 10}px`;
  menu.style.left = onLeft ? `${Math.max(14, r.left)}px` : "auto";
  menu.style.right = onLeft ? "auto" : `${Math.max(14, innerWidth - r.right)}px`;
  menu.style.transformOrigin = `${below ? "top" : "bottom"} ${onLeft ? "left" : "right"}`;
}

// Opens the watch page for one share: joins it if it's still waiting, then
// answers Mom's phone and shows her screen.
export async function watchShare({ db, uid, myName, circleId, shareId, parentName, iceServers }) {
  if (current === shareId) return;
  current = shareId;
  await stop({ end: false });
  const shareRef = doc(db, `circles/${circleId}/screenShares/${shareId}`);
  const s = { shareId, openedAt: Date.now(), name: parentName || FALLBACK_NAME, unsubs: [], pc: null, seen: new Set(), pending: [], remoteSet: false, ended: false,
    caps: {}, lastPong: 0, downSince: 0 };
  session = s;
  show(s.name, "Connecting…");

  let rejoin = false;
  try {
    rejoin = await runTransaction(db, async (tx) => {
      const snap = await tx.get(shareRef);
      const share = snap.data();
      if (!share) throw new Error("This screen share isn't available.");
      // Already watching it (this page reloaded, or was opened again): ask
      // Mom's phone for a fresh connection instead of joining.
      if (share.status === "live" && share.helperId === uid) return true;
      if (share.status !== "waiting") throw new Error("This screen share has ended.");
      tx.update(shareRef, { status: "live", helperId: uid, helperName: myName, startedAt: serverTimestamp() });
      return false;
    });
  } catch (err) {
    if (session === s) session = null;
    const ended = /ended|isn't available/.test(err.message);
    show(s.name, ended ? err.message : `Couldn't join. It may have timed out: ask ${s.name} to tap Show my screen again.`);
    return;
  }
  if (session !== s) return;
  // Which connection this page is on. Mom's phone labels its first offer
  // "first" (older versions of her app send no label); a reloaded page picks
  // a new label and only listens to messages carrying it.
  const gen = rejoin ? crypto.randomUUID() : "first";
  const ours = (payload) => (payload.gen ?? "first") === gen;

  const servers = await iceServersFrom(iceServers, (late) => {
    // Mom's phone adds it the next time it refreshes the connection.
    if (session === s && s.pc?.connectionState !== "closed") s.pc?.setConfiguration({ iceServers: late });
  });
  if (session !== s) return;
  const pc = new RTCPeerConnection({ iceServers: servers });
  s.pc = pc;
  s.shareRef = shareRef;
  const signals = collection(db, `circles/${circleId}/screenShares/${shareId}/signals`);
  const send = (type, payload) => addDoc(signals, { from: uid, type, payload: JSON.stringify(payload), createdAt: serverTimestamp() });

  pc.onicecandidate = (e) => {
    if (e.candidate) send("candidate", { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex, gen });
  };
  pc.ontrack = (e) => {
    // Show each picture as soon as it arrives instead of buffering for
    // smoothness: taps feel quicker when the screen keeps up.
    try {
      if ("jitterBufferTarget" in e.receiver) e.receiver.jitterBufferTarget = 0;
      else if ("playoutDelayHint" in e.receiver) e.receiver.playoutDelayHint = 0;
    } catch { /* older browsers: keep the default */ }
    s.videoAt ??= Date.now();
    const video = overlay().querySelector("video");
    video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    show(s.name, "", { video: true });
  };
  // Mom's phone opens this channel; older versions of her app don't have it.
  pc.ondatachannel = (e) => {
    // Pings and finger moves: never resent, so a lost one can't hold up the rest.
    if (e.channel.label === "fast") {
      s.fast = e.channel;
      e.channel.onmessage = (m) => {
        // Only proves the lane works; how fresh her picture is comes from
        // the reliable pings, so a lost packet here never pauses taps.
        try { if (JSON.parse(m.data).t === "pong") s.fastOk = Date.now(); } catch { /* ignore */ }
      };
      return;
    }
    if (e.channel.label !== "control") return;
    s.channel = e.channel;
    e.channel.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.t === "control") setControl(msg);
      // What her app can do (older versions say nothing): answer pings, live drags.
      if (msg.t === "caps") { s.caps = msg; s.lastPong = Date.now(); }
      if (msg.t === "pong") s.lastPong = Date.now();
      // What her phone actually sends (numbers only), for the menu.
      if (msg.t === "sent") s.sent = { ...msg, at: Date.now() };
      // How tall her top bar and her own phone buttons are, to cut them off.
      if (msg.t === "screen") {
        const part = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.15) : 0);
        s.bars = { top: part(msg.top), bottom: part(msg.bottom) };
        layoutVideo();
      }
      if (msg.t === "refused") flashNote(`That spot is under ${s.name}'s Stop button, or ${s.name} is answering a question. Try again.`);
    };
    e.channel.onclose = () => { if (session === s) setControl(null); };
  };
  // When the network path drops, Mom's phone looks for a new one for up to
  // 30 seconds (her Stop bar stays up); taps wait until the picture is back.
  pc.onconnectionstatechange = () => checkLink(s);
  s.pingTimer = setInterval(() => {
    if (s.caps.ping) send({ t: "ping" });
    if (s.caps.fast && s.fast?.readyState === "open") s.fast.send(JSON.stringify({ t: "ping" }));
    checkLink(s);
  }, PING_EVERY_MS / 2);
  s.statsTimer = setInterval(() => showStats(s), 2000);

  s.unsubs.push(onSnapshot(shareRef, (snap) => {
    const share = snap.data();
    s.name = share?.parentName || s.name;
    if (!share || share.status === "ended") {
      stop({ end: false, message: `${s.name}'s screen share ended.` });
    } else if (!pc.remoteDescription) {
      show(s.name, `Waiting for ${s.name}'s phone…`);
    }
  }));

  s.unsubs.push(onSnapshot(query(signals, orderBy("createdAt")), (snap) => {
    snap.docChanges().forEach(async ({ type, doc: d }) => {
      if (type !== "added" || s.seen.has(d.id)) return;
      const m = d.data();
      s.seen.add(d.id);
      try {
        const payload = JSON.parse(m.payload);
        // This share was opened again in a newer window, which takes over.
        if (m.from === uid) {
          if (m.type === "hello" && payload.gen !== gen && payload.at > s.openedAt && session === s) {
            current = null;
            stop({ end: false, message: `${s.name}'s screen is open in another window now.` });
          }
          return;
        }
        if (!ours(payload)) return; // for an earlier connection
        if (m.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
          askForFormat(pc);
          s.remoteSet = true;
          for (const c of s.pending.splice(0)) await pc.addIceCandidate(c);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await send("answer", { sdp: answer.sdp, gen });
        } else if (m.type === "candidate") {
          if (s.remoteSet) await pc.addIceCandidate(payload);
          else s.pending.push(payload);
        }
      } catch (err) {
        console.warn("screen share signal", err);
      }
    });
  }));

  if (rejoin) send("hello", { gen, at: s.openedAt }).catch((err) => console.warn("screen share hello", err));

  // Ending the share is how we tell Mom's phone to stop.
  s.end = () => updateDoc(shareRef, { status: "ended", endedBy: uid, endedAt: serverTimestamp() }).catch(() => {});
}

// The helper's answer decides the video format (VP8, see quality.js).
// Browsers without this keep the default.
function askForFormat(pc) {
  try {
    const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
    if (!codecs?.length) return;
    for (const t of pc.getTransceivers()) {
      if (t.receiver.track?.kind === "video" && t.setCodecPreferences) t.setCodecPreferences(preferFormat(codecs));
    }
  } catch (err) {
    console.warn("video format", err);
  }
}

// A few numbers about how smooth the share was (no picture, nothing typed),
// saved once on the share's record so we can tune for real networks.
async function saveQuality(s) {
  if (!s.videoAt || !s.pc || !s.shareRef) return;
  try {
    const report = await Promise.race([s.pc.getStats(), new Promise((resolve) => setTimeout(resolve, 500))]);
    if (!report) return;
    const quality = summarize([...report.values()], (Date.now() - s.videoAt) / 1000);
    if (s.sent?.enc) quality.enc = String(s.sent.enc).replace(/[^A-Za-z0-9._ -]/g, "").slice(0, 40);
    if (s.timeline?.length) quality.timeline = timelineText(s.timeline);
    // If the timeline is refused, the basic numbers still get saved.
    updateDoc(s.shareRef, { quality }).catch((err) => {
      console.warn("share numbers", err);
      if (!quality.timeline && !quality.enc) return; // already saved, e.g. by another window
      const { timeline, enc, ...basic } = quality;
      updateDoc(s.shareRef, { quality: basic }).catch(() => {});
    });
  } catch { /* nice to have, never in the way */ }
}

// ---------- How the connection is doing ----------

// A small line in the menu: delay, video format, relay or direct, pictures a second.
// Also notes each moment on the share's timeline, saved when it ends.
async function showStats(s) {
  const el = document.querySelector("#watch .watch-stats");
  // Once her picture is showing (not every browser reports connectionState).
  if (session !== s || !s.pc || !(s.videoAt || s.pc.connectionState === "connected")) return;
  try {
    const report = await Promise.race([s.pc.getStats(), new Promise((_, no) => setTimeout(no, 1500))]);
    const stats = [...report.values()];
    const now = Date.now();
    const moving = now - (s.touchedAt ?? 0) < 2500;
    const rttMs = summarize(stats, 1).rttMs;
    const fps = liveFps(stats);
    // Her phone's report, unless it's gone quiet (an older app, a dropped link).
    const sent = s.sent && now - s.sent.at < 5000 ? s.sent : undefined;
    const video = stats.find((x) => x.type === "inbound-rtp" && x.kind === "video");
    const delays = receiveDelays(video, s.lastVideo);
    s.lastVideo = video;
    s.timeline = [...(s.timeline ?? []).slice(-400), timelinePoint({ at: now, start: s.videoAt ?? now, rttMs, fps, sent, moving, delays })];
    // A still screen sends nothing, so it isn't counted as a slow moment.
    const still = sent && Number.isFinite(sent.cap) && sent.cap < 1;
    if (moving && !still) s.worst = [...(s.worst ?? []).slice(-60), { at: now, rttMs, fps, sent }];
    if (!el) return;
    const low = worstSent(s.worst ?? [], now);
    el.textContent = [liveLine(stats), worstLine(s.worst ?? [], now), sentLine(low ?? s.sent, s.name, !!low)]
      .filter(Boolean).join("\n");
  } catch {
    el.textContent = "Connection numbers not available";
  }
}

let link = "ok";

function checkLink(s) {
  if (session !== s || !s.pc) return;
  const now = Date.now();
  const state = linkState({ connection: s.pc.connectionState, pings: !!s.caps.ping, lastPong: s.lastPong, now });
  if (state === "reconnecting") {
    s.downSince ||= now;
    // Mom's phone has given up by now too, so nothing stays shared.
    if (now - s.downSince > RECONNECT_GIVE_UP_MS + 5000) {
      stop({ end: true, message: `The connection dropped. Ask ${s.name} to tap Show my screen again.` });
      return;
    }
  } else {
    s.downSince = 0;
  }
  setLink(state);
}

function setLink(state) {
  const el = document.getElementById("watch");
  const changed = state !== link;
  link = state;
  if (!el?.querySelector(".watch-weak")) return;
  const name = session?.name ?? FALLBACK_NAME;
  el.classList.toggle("weak", state !== "ok");
  el.classList.toggle("reconnecting", state === "reconnecting");
  el.querySelector(".watch-weak").textContent = state === "reconnecting" ? `Reconnecting to ${name}…`
    : controlOn ? "Slow connection · taps paused" : "Slow connection";
  const note = el.querySelector(".watch-weak-note");
  note.textContent = state === "reconnecting"
    ? `${name}'s signal blinked. Finding a better connection. Taps are paused until the picture is back.`
    : `${name}'s screen is catching up. Your taps work again as soon as it does.`;
  note.hidden = !(state === "reconnecting" || (state === "slow" && controlOn));
  if (changed) bannerPulse();
}

// ---------- Tapping for Mom ----------

// Numbers finger moves, so her phone drops any that arrive after a newer one.
let moveSeq = 0;

function send(msg, { fast = false } = {}) {
  // The fast lane only once her phone has answered on it lately.
  const quick = fast && session?.fast?.readyState === "open" && Date.now() - (session.fastOk ?? 0) < 3000;
  const ch = quick ? session.fast : session?.channel;
  if (ch?.readyState === "open") ch.send(JSON.stringify(msg));
}

let controlOn = false;
let pointing = false;

function setPointing(on) {
  pointing = on;
  const el = document.getElementById("watch");
  el?.classList.toggle("pointing", on);
  el?.querySelector("[data-watch-point]")?.setAttribute("aria-pressed", String(on));
}
let askTimer;

// What Mom's phone says about tapping. null = not available (no channel).
function setControl(msg) {
  const el = document.getElementById("watch");
  if (!el?.querySelector(".watch-control")) return;
  const box = el.querySelector(".watch-control");
  const note = el.querySelector(".watch-control-note");
  const ask = el.querySelector("[data-watch-ask]");
  const keys = el.querySelector(".watch-keys");
  const name = session?.name ?? FALLBACK_NAME;
  controlOn = msg?.state === "on";
  box.hidden = !msg;
  keys.hidden = !controlOn;
  el.querySelector(".watch-alerts").hidden = !controlOn;
  ask.hidden = !["ready", "declined", "off", "opened", "blocked", "waiting"].includes(msg?.state);
  ask.querySelector(".watch-ask-label").textContent = "Ask to tap";
  ask.setAttribute("aria-label", `Ask to tap for ${name}`);
  ask.classList.toggle("locked", msg?.state === "waiting");
  // Just said no: asking again works after a short pause, so wait it out here.
  clearTimeout(askTimer);
  const wait = msg?.state === "declined" && msg.until ? msg.until - Date.now() : 0;
  ask.disabled = wait > 0;
  if (wait > 0) askTimer = setTimeout(() => { ask.disabled = false; }, Math.min(wait, 60_000));
  const changed = controlOn !== el.classList.contains("controlling");
  if (!controlOn) setPointing(false);
  if (controlOn && changed) setMenu(false);
  el.classList.toggle("controlling", controlOn);
  if (changed) bannerPulse();
  if (changed) setLink(link);
  const notes = {
    ready: "",
    sent: `Asking ${name}'s phone…`,
    asking: `${name}'s phone is asking them to say yes. Tell them it's you.`,
    on: "Tap, hold or swipe on the screen. Stop on either phone ends it.",
    declined: `${name} said no, or didn't answer in time. You can ask again in a few seconds.`,
    off: `${name} needs to turn on tapping once. Follow the steps on your screen.`,
    opened: `${name} needs to turn on tapping once. Follow the steps on your screen.`,
    blocked: `${name}'s phone blocked the switch. Follow the steps on your screen.`,
    waiting: msg?.until
      ? `For safety, tapping for ${name} unlocks ${new Date(msg.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
      : `For safety, tapping for ${name} isn't unlocked yet.`,
  };
  note.textContent = notes[msg?.state] ?? "";
  setGuide(el, msg?.state, name);
}

// Turning on tapping the first time: steps for the helper to read out on the
// call, following along as her phone reports each one. It turns green by
// itself once the switch is on and her phone asks her to say yes.
let guiding = false;
function setGuide(el, state, name) {
  const guide = el.querySelector(".watch-guide");
  const who = esc(name);
  const steps = {
    off: [
      [`“Tap <b>Agree and show me where</b> on your screen.”`, "now"],
      [`“Tap <b>Installed apps</b>.” (Some phones say Downloaded apps.)`],
      [`“Tap <b>My Tech Kid</b>.”`],
      [`“Turn the switch on, then tap <b>Allow</b>.”`],
    ],
    opened: [
      [`${who} tapped Agree`, "done"],
      [`“Tap <b>Installed apps</b>.” (Some phones say Downloaded apps.)`, "now"],
      [`“Tap <b>My Tech Kid</b>.”`],
      [`“Turn the switch on, then tap <b>Allow</b>.”`],
    ],
    blocked: [
      [`“Tap <b>Take me there</b> on your screen.”`, "now"],
      [`“Tap <b>⋮</b> in the top corner.”`],
      [`“Tap <b>Allow restricted settings</b>.”`],
      [`“Come back to My Tech Kid and tap <b>Turn it on</b>.”`],
    ],
  }[state];
  if (steps) {
    const changed = guide.dataset.state !== state;
    guiding = true;
    guide.dataset.state = state;
    guide.classList.remove("done");
    guide.querySelector(".watch-guide-kicker").textContent = "One-time setup";
    guide.querySelector(".watch-guide-title").innerHTML = state === "blocked"
      ? `The switch is still off. If ${who}’s phone said “Restricted setting” (normal for apps from a link), read these to ${who}:`
      : `${who}’s phone needs one switch on. Read these to ${who}:`;
    guide.querySelector(".watch-guide-steps").innerHTML = steps.map(([text, mark], i) =>
      `<li class="${mark ?? ""}"><span class="watch-guide-num">${mark === "done" ? "✓" : i + 1}</span><span>${text}</span></li>`).join("");
    guide.querySelector(".watch-guide-note").textContent = "This turns green by itself when the switch is on.";
    if (changed) guide.hidden = false;
  } else if (guiding && state === "asking") {
    guide.dataset.state = state;
    guide.classList.add("done");
    guide.querySelector(".watch-guide-kicker").textContent = "Switch is on";
    guide.querySelector(".watch-guide-title").innerHTML = `${who}’s phone is asking them to say yes. Tell ${who} it’s you.`;
    guide.querySelector(".watch-guide-steps").innerHTML = "";
    guide.querySelector(".watch-guide-note").textContent = "";
    guide.hidden = false;
  } else if (state !== "sent") {
    guiding = false;
    delete guide.dataset.state;
    guide.hidden = true;
  }
}

let flashTimer;
function flashNote(text) {
  const note = document.querySelector("#watch .watch-control-note");
  const toast = document.querySelector("#watch .watch-toast");
  if (!note) return;
  const before = note.textContent;
  note.textContent = text;
  if (toast) { toast.textContent = text; toast.hidden = false; }
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    note.textContent = before;
    if (toast) toast.hidden = true;
  }, 3000);
}

// Her picture: her top bar (clock, Wi-Fi) and her own phone buttons cut off,
// filling the screen (our bar has the buttons). The video element is the
// whole picture, so pointOnVideo maps taps and drags on it exactly.
function layoutVideo() {
  const el = document.getElementById("watch");
  const video = el?.querySelector("video");
  const stage = el?.querySelector(".watch-stage");
  if (!video || !stage) return;
  const bars = session?.bars ?? { top: 0, bottom: 0 };
  const box = fitVideo(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight, bars.top, bars.bottom);
  if (!box) { video.removeAttribute("style"); return; }
  Object.assign(video.style, {
    left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, right: "auto", bottom: "auto",
  });
}

function pointOn(video, e) {
  return pointOnVideo(video.getBoundingClientRect(), video.videoWidth, video.videoHeight, e.clientX, e.clientY);
}

// Instant feedback on the helper's phone, before Mom's screen catches up.
function ripple(x, y) {
  const dot = document.createElement("span");
  dot.className = "watch-ripple";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  document.getElementById("watch")?.append(dot);
  setTimeout(() => dot.remove(), 450);
}

// A drag (scrolling, moving something) goes to her phone live, as the finger
// moves, when her app can do that; a short touch is still one tap or hold.
// Moves go out up to 60 times a second (every 16 ms), and every 300 ms while
// the finger rests, so her phone knows the finger is still down. At 50 ms
// (20 a second) Chrome only redrew 20 times a second while scrolling, since a
// page moves only when the finger does (Gray's timeline, Oct 23).
const MOVE_EVERY_MS = 16;
const STILL_DOWN_MS = 300;

function addGestures(video) {
  let start = null;
  let last = null;
  let dragging = false;
  let sentAt = 0;
  let stillTimer;
  const move = () => {
    if (!dragging || link !== "ok") return;
    send({ t: "move", x: last.x, y: last.y, n: ++moveSeq }, { fast: true });
    sentAt = performance.now();
    clearTimeout(stillTimer);
    stillTimer = setTimeout(move, STILL_DOWN_MS);
  };
  const touched = () => { if (session) session.touchedAt = Date.now(); };
  video.addEventListener("pointerdown", touched);
  video.addEventListener("pointermove", touched);
  video.addEventListener("pointerdown", (e) => {
    if (!controlOn) return;
    const p = pointOn(video, e);
    if (!p) return;
    e.preventDefault();
    // The picture is behind: a tap now could land on something that changed.
    if (link !== "ok") return;
    video.setPointerCapture?.(e.pointerId);
    start = { ...p, time: performance.now() };
    last = p;
    dragging = false;
  });
  video.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = pointOn(video, e);
    if (!p) return;
    last = p;
    if (!dragging && !pointing && session?.caps?.drag && link === "ok" && isDrag(start, p)) {
      dragging = true;
      send({ t: "down", x: start.x, y: start.y, n: ++moveSeq });
      sentAt = 0;
    }
    if (dragging && performance.now() - sentAt >= MOVE_EVERY_MS) move();
  });
  const finish = (e) => {
    if (!start) return;
    clearTimeout(stillTimer);
    const end = last ?? start;
    // Pointing shows her where to tap (a ring on her screen) instead of tapping.
    const g = dragging ? { t: "up", x: end.x, y: end.y, n: ++moveSeq }
      : pointing ? { t: "point", x: end.x, y: end.y } : gestureFor(start, end, performance.now() - start.time);
    const wasDrag = dragging;
    start = null;
    last = null;
    dragging = false;
    // A drag always gets its "up", so her phone lifts the finger.
    if ((e.type === "pointerup" || wasDrag) && controlOn && (link === "ok" || wasDrag)) {
      send(g);
      if (!wasDrag) ripple(e.clientX, e.clientY);
    }
  };
  video.addEventListener("pointerup", finish);
  video.addEventListener("pointercancel", finish);
  video.addEventListener("contextmenu", (e) => { if (controlOn) e.preventDefault(); });
}

export async function stop({ end = true, message = "" } = {}) {
  const s = session;
  session = null;
  setControl(null);
  if (s) {
    clearInterval(s.pingTimer);
    clearInterval(s.statsTimer);
    s.unsubs.forEach((u) => u());
    await saveQuality(s);
    s.pc?.close();
    if (end) await s.end?.();
  }
  setLink("ok");
  const el = document.getElementById("watch");
  if (!el) return;
  if (message) {
    show(s?.name ?? FALLBACK_NAME, message);
  } else {
    el.hidden = true;
    el.innerHTML = "";
    document.body.classList.remove("watching");
  }
}

// Leaving the watch page ends the share, so Mom's phone stops too.
export function closeWatch() {
  if (!current) return;
  current = null;
  stop({ end: true });
}
