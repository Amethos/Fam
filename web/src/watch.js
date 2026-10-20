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
import { gestureFor, pointOnVideo } from "./gesture.js";

// Public STUN servers find a direct path between the phones. A TURN relay for
// networks that block direct paths comes later (docs/STAGE2.md).
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

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
    el.innerHTML = `
      <div class="watch-bar"><strong class="watch-title"></strong>
        <button class="danger small" data-watch-stop>Stop</button></div>
      <video autoplay playsinline muted></video>
      <p class="watch-note"></p>
      <div class="watch-control" hidden>
        <p class="watch-control-note muted" role="status"></p>
        <button data-watch-ask>Ask to tap for them</button>
        <div class="watch-keys" hidden>
          <button class="secondary small" data-key="back">Back</button>
          <button class="secondary small" data-key="home">Home</button>
          <button class="secondary small" data-key="recents">Apps</button>
          <button class="secondary small" data-key="notifications">Alerts</button>
        </div>
      </div>
      <a class="button secondary watch-back" href="#/">Back to dashboard</a>`;
    el.querySelector("[data-watch-stop]").addEventListener("click", () => { location.hash = "#/"; });
    el.querySelector("[data-watch-ask]").addEventListener("click", () => {
      send({ t: "ask" });
      setControl({ state: "sent" });
    });
    el.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => send({ t: "key", name: b.dataset.key })));
    addGestures(el.querySelector("video"));
  }
  el.querySelector(".watch-title").textContent = `${name}'s screen`;
  el.querySelector(".watch-note").innerHTML = message ? esc(message) : "";
  el.querySelector("video").hidden = !video;
  // While watching, Stop is the only way out (it ends the share on Mom's phone too).
  el.querySelector("[data-watch-stop]").hidden = !session;
  el.querySelector(".watch-back").hidden = !!session;
}

// Opens the watch page for one share: joins it if it's still waiting, then
// answers Mom's phone and shows her screen.
export async function watchShare({ db, uid, myName, circleId, shareId, parentName }) {
  if (current === shareId) return;
  current = shareId;
  await stop({ end: false });
  const shareRef = doc(db, `circles/${circleId}/screenShares/${shareId}`);
  const s = { shareId, name: parentName || FALLBACK_NAME, unsubs: [], pc: null, seen: new Set(), pending: [], remoteSet: false, ended: false };
  session = s;
  show(s.name, "Connecting…");

  let lost = false;
  try {
    lost = await runTransaction(db, async (tx) => {
      const snap = await tx.get(shareRef);
      const share = snap.data();
      if (!share) throw new Error("This screen share isn't available.");
      // Opened again after this page reloaded: the old connection is gone and
      // Mom's phone can't start a new one on its own, so end it cleanly.
      if (share.status === "live" && share.helperId === uid) {
        tx.update(shareRef, { status: "ended", endedBy: uid, endedAt: serverTimestamp() });
        return true;
      }
      if (share.status !== "waiting") throw new Error("This screen share has ended.");
      tx.update(shareRef, { status: "live", helperId: uid, helperName: myName, startedAt: serverTimestamp() });
      return false;
    });
    if (lost) throw new Error("lost");
  } catch (err) {
    if (session === s) session = null;
    const ended = /ended|isn't available/.test(err.message);
    show(s.name, err.message === "lost"
      ? `The connection was lost when this page reloaded. Ask ${s.name} to tap Show my screen again.`
      : ended ? err.message : `Couldn't join. It may have timed out: ask ${s.name} to tap Show my screen again.`);
    return;
  }
  if (session !== s) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  s.pc = pc;
  const signals = collection(db, `circles/${circleId}/screenShares/${shareId}/signals`);
  const send = (type, payload) => addDoc(signals, { from: uid, type, payload: JSON.stringify(payload), createdAt: serverTimestamp() });

  pc.onicecandidate = (e) => {
    if (e.candidate) send("candidate", { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
  };
  pc.ontrack = (e) => {
    // Show each picture as soon as it arrives instead of buffering for
    // smoothness: taps feel quicker when the screen keeps up.
    try {
      if ("jitterBufferTarget" in e.receiver) e.receiver.jitterBufferTarget = 0;
      else if ("playoutDelayHint" in e.receiver) e.receiver.playoutDelayHint = 0;
    } catch { /* older browsers: keep the default */ }
    const video = overlay().querySelector("video");
    video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    show(s.name, "", { video: true });
  };
  // Mom's phone opens this channel; older versions of her app don't have it.
  pc.ondatachannel = (e) => {
    if (e.channel.label !== "control") return;
    s.channel = e.channel;
    e.channel.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.t === "control") setControl(msg);
      if (msg.t === "refused") flashNote(`That spot is under ${s.name}'s Stop button, or ${s.name} is answering a question. Try again.`);
    };
    e.channel.onclose = () => { if (session === s) setControl(null); };
  };
  pc.onconnectionstatechange = () => {
    // Mom's phone ends it too when the connection fails, so nothing stays shared.
    if (pc.connectionState === "failed") {
      stop({ end: true, message: `The connection dropped. Ask ${s.name} to tap Show my screen again.` });
    }
  };

  s.unsubs.push(onSnapshot(shareRef, (snap) => {
    const share = snap.data();
    s.name = share?.parentName || s.name;
    if (!share || share.status === "ended") {
      stop({ end: false, message: `${s.name} stopped sharing.` });
    } else if (!pc.remoteDescription) {
      show(s.name, `Waiting for ${s.name}'s phone…`);
    }
  }));

  s.unsubs.push(onSnapshot(query(signals, orderBy("createdAt")), (snap) => {
    snap.docChanges().forEach(async ({ type, doc: d }) => {
      if (type !== "added" || s.seen.has(d.id)) return;
      const m = d.data();
      if (m.from === uid) return;
      s.seen.add(d.id);
      try {
        const payload = JSON.parse(m.payload);
        if (m.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
          s.remoteSet = true;
          for (const c of s.pending.splice(0)) await pc.addIceCandidate(c);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await send("answer", { sdp: answer.sdp });
        } else if (m.type === "candidate") {
          if (s.remoteSet) await pc.addIceCandidate(payload);
          else s.pending.push(payload);
        }
      } catch (err) {
        console.warn("screen share signal", err);
      }
    });
  }));

  // Ending the share is how we tell Mom's phone to stop.
  s.end = () => updateDoc(shareRef, { status: "ended", endedBy: uid, endedAt: serverTimestamp() }).catch(() => {});
}

// ---------- Tapping for Mom ----------

function send(msg) {
  const ch = session?.channel;
  if (ch?.readyState === "open") ch.send(JSON.stringify(msg));
}

let controlOn = false;

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
  ask.hidden = !["ready", "declined", "off", "waiting"].includes(msg?.state);
  ask.textContent = `Ask to tap for ${name}`;
  el.classList.toggle("controlling", controlOn);
  const notes = {
    ready: "",
    sent: `Asking ${name}'s phone…`,
    asking: `${name}'s phone is asking them to say yes. Tell them it's you.`,
    on: "Tap, hold or swipe on the screen. Stop on either phone ends it.",
    declined: `${name} said no, or didn't answer in time. You can ask again.`,
    off: `${name} needs to turn on tapping once. On their phone, open My Tech Kid and tap Agree and turn it on, then turn on "My Tech Kid: let family tap for me". On a Samsung, if it says Restricted setting, go to Settings, Apps, My Tech Kid, tap ⋮ at the top, then Allow restricted settings, and try again. Then tap Ask again here.`,
    waiting: msg?.until
      ? `For safety, tapping for ${name} unlocks ${new Date(msg.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
      : `For safety, tapping for ${name} isn't unlocked yet.`,
  };
  note.textContent = notes[msg?.state] ?? "";
}

let flashTimer;
function flashNote(text) {
  const note = document.querySelector("#watch .watch-control-note");
  if (!note) return;
  const before = note.textContent;
  note.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { note.textContent = before; }, 3000);
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

function addGestures(video) {
  let start = null;
  let last = null;
  video.addEventListener("pointerdown", (e) => {
    if (!controlOn) return;
    const p = pointOn(video, e);
    if (!p) return;
    e.preventDefault();
    video.setPointerCapture?.(e.pointerId);
    start = { ...p, time: performance.now() };
    last = p;
  });
  video.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = pointOn(video, e);
    if (p) last = p;
  });
  const finish = (e) => {
    if (!start) return;
    const g = gestureFor(start, last ?? start, performance.now() - start.time);
    start = null;
    last = null;
    if (e.type === "pointerup" && controlOn) {
      send(g);
      ripple(e.clientX, e.clientY);
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
    s.unsubs.forEach((u) => u());
    s.pc?.close();
    if (end) await s.end?.();
  }
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
