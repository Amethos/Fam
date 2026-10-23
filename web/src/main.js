// My Tech Kid helper app (the person giving help). Runs in the browser and can be
// added to an iPhone home screen. Mom's side is the Android app in android/.

import "./styles.css";
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy, limit, onSnapshot,
  setDoc, updateDoc, addDoc, serverTimestamp, arrayUnion,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseConfig, vapidKey, isConfigured } from "./config.js";
import { esc, initial, timeAgo, formatTime, isPast, storage } from "./util.js";
import { watchShare, closeWatch } from "./watch.js";
import { qrSvg } from "./qr.js";
import { thisDevice, helpMethod, deviceLabel } from "./device.js";

const root = document.getElementById("app");
const myDevice = thisDevice();

// Appearance: follows the phone (light by day, dark at night) unless the
// helper picks one. Remembered on this device only.
const THEMES = { auto: "Automatic", light: "Light", dark: "Dark" };
let themeChoice = storage.get("theme") || "auto";
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
}
applyTheme(themeChoice);

const LOGO = `My Tech Kid<span class="dot">.</span>`;

// `VITE_EMULATORS=1 npm run dev` talks to local Firebase emulators instead (for testing).
const useEmulators = import.meta.env.VITE_EMULATORS === "1";

if (!isConfigured && !useEmulators) {
  root.innerHTML = `<div class="brand">${LOGO}</div>
    <div class="card"><h1>Almost there</h1>
    <p>My Tech Kid isn't connected to Firebase yet. Fill in <code>web/src/config.js</code> — see <code>docs/SETUP.md</code>.</p></div>`;
  throw new Error("My Tech Kid: web/src/config.js is not filled in yet");
}

const fbApp = initializeApp(useEmulators
  ? { apiKey: "demo", projectId: "demo-fam", authDomain: "demo-fam.firebaseapp.com" }
  : firebaseConfig);
// Email + password only. initializeAuth (instead of getAuth) skips loading
// Google's sign-in pop-up code, so the page runs only our own scripts.
const auth = initializeAuth(fbApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getFirestore(fbApp);
const functions = getFunctions(fbApp);
if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

const state = {
  user: undefined, // undefined = still loading, null = signed out
  profile: null,
  ringing: {}, // parent id -> true while their phone is ringing
  circle: null,
  help: [],
  scams: [],
  invites: [],
  shares: [],
  authMode: "signin",
  storyIndex: 0,
  verdicts: {},
  error: "",
  busy: false,
  alertsOn: typeof Notification !== "undefined" && Notification.permission === "granted",
};

let userUnsubs = [];
let circleUnsubs = [];
let circleId = null;

function clear(list) { list.forEach((u) => u()); list.length = 0; }

onAuthStateChanged(auth, (user) => {
  clear(userUnsubs);
  clear(circleUnsubs);
  Object.keys(voices).forEach(forgetVoice);
  circleId = null;
  Object.assign(state, { user, profile: null, circle: null, help: [], scams: [], invites: [], shares: [] });
  if (user) {
    userUnsubs.push(onSnapshot(doc(db, "users", user.uid), (snap) => {
      state.profile = snap.data() ?? {};
      reportDevice(user.uid, state.profile.device);
      watchCircle(state.profile.circleId ?? null);
      render();
    }));
    if (state.alertsOn) enableAlerts({ quiet: true });
  }
  render();
});

// Tell the family what kind of phone this is, so the right way to help is
// picked (FaceTime between iPhones, the app's own screen sharing on Android).
function reportDevice(uid, saved) {
  if (deviceLabel(saved) === deviceLabel(myDevice) && saved?.platform === myDevice.platform) return;
  setDoc(doc(db, "users", uid), { device: myDevice }, { merge: true })
    .catch((err) => console.warn("Could not save this phone's type", err));
}

// "Tell Josh what's wrong": Mom's voice message on an open help request.
// Loaded only inside the app (alerts never carry it), and played with one
// Audio object outside the page, so live updates don't cut it off.
const voices = {}; // help request id -> { unsub, url, seconds, said }
const player = { audio: null, id: null };

function watchVoices() {
  const open = new Set(state.help.filter((h) => h.hasVoice).map((h) => h.id));
  for (const id of Object.keys(voices)) if (!open.has(id)) forgetVoice(id);
  for (const id of open) {
    if (voices[id]) continue;
    voices[id] = { url: null, seconds: 0, said: "" };
    voices[id].unsub = onSnapshot(doc(db, `circles/${circleId}/helpRequests/${id}/voice/clip`), (snap) => {
      const v = snap.data();
      const entry = voices[id];
      if (!v || !entry) return;
      if (!entry.url && v.audio) entry.url = URL.createObjectURL(new Blob([v.audio.toUint8Array()], { type: "audio/mp4" }));
      entry.seconds = Math.round(Number(v.seconds) || 0);
      entry.said = typeof v.said === "string" ? v.said : "";
      render();
    }, () => {});
  }
}

function forgetVoice(id) {
  const entry = voices[id];
  if (!entry) return;
  entry.unsub?.();
  if (player.id === id) stopVoice();
  if (entry.url) URL.revokeObjectURL(entry.url);
  delete voices[id];
}

function stopVoice() {
  player.audio?.pause();
  player.audio = null;
  player.id = null;
}

function playVoice(id) {
  const entry = voices[id];
  if (!entry?.url) return;
  if (player.id === id) { stopVoice(); render(); return; }
  stopVoice();
  player.audio = new Audio(entry.url);
  player.id = id;
  player.audio.addEventListener("ended", () => { if (player.id === id) { stopVoice(); render(); } });
  player.audio.play().catch(() => { stopVoice(); render(); });
  render();
}

function voiceBlock(h) {
  if (!h.hasVoice) return "";
  const v = voices[h.id];
  if (!v?.url) return `<p class="muted">Loading ${esc(h.parentName)}'s voice message…</p>`;
  const length = `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, "0")}`;
  const playing = player.id === h.id;
  return `<div class="voice">
      <button class="secondary small" data-action="play-voice" data-id="${esc(h.id)}">${playing ? "Stop" : "▶ Play"} ${esc(h.parentName)}'s message</button>
      <span class="muted">${esc(length)}</span></div>
    ${v.said ? `<div class="quote"><small class="muted">${esc(h.parentName)} said</small><br>“${esc(v.said)}”</div>` : ""}`;
}

function watchCircle(id) {
  if (id === circleId) return;
  clear(circleUnsubs);
  Object.keys(voices).forEach(forgetVoice);
  circleId = id;
  if (!id) {
    // Unlinked (or removed from the family): forget what we were showing.
    Object.assign(state, { circle: null, help: [], scams: [], invites: [], shares: [] });
    return;
  }
  const base = `circles/${id}`;
  const fail = (err) => { state.error = err.message; render(); };
  circleUnsubs.push(
    onSnapshot(doc(db, base), (s) => { state.circle = s.data() ?? null; render(); }, fail),
    onSnapshot(query(collection(db, base, "helpRequests"), where("status", "in", ["waiting", "accepted"])),
      (s) => { state.help = s.docs.map((d) => ({ id: d.id, ...d.data() })); watchVoices(); render(); }, fail),
    onSnapshot(query(collection(db, base, "scamChecks"), orderBy("createdAt", "desc"), limit(20)),
      (s) => { state.scams = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail),
    onSnapshot(query(collection(db, base, "invites"), orderBy("createdAt", "desc"), limit(10)),
      (s) => { state.invites = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail),
    onSnapshot(query(collection(db, base, "screenShares"), where("status", "in", ["waiting", "live"])),
      (s) => { state.shares = s.docs.map((d) => ({ id: d.id, ...d.data() })); prefetchPasses(); openMyShare(); render(); }, fail),
  );
}

// Relay passes for screen sharing, asked for as soon as Mom's share shows up
// (before joining), so watching never waits on the backend.
const passes = new Map();
function prefetchPasses() {
  if (!state.circle?.helperIds?.includes(state.user?.uid)) return;
  for (const sh of state.shares) {
    if (sh.status === "waiting" && !passes.has(sh.id)) relayPass(sh.id);
  }
}
function relayPass(shareId) {
  const got = passes.get(shareId);
  if (got) return got;
  const asking = call("shareIceServers", { circleId, shareId })
    .catch((err) => { passes.delete(shareId); throw err; });
  passes.set(shareId, asking);
  return asking;
}
// The backend sleeps when nobody uses it, and waking takes a few seconds.
// "I'm on it" means Mom's screen is coming: wake it now. (Asking without a
// share is refused, which is fine: only the waking matters.)
function wakeRelay() {
  call("shareIceServers", { circleId, shareId: "wake" }).catch(() => {});
}

// After "I'm on it", the helper is waiting for Mom's screen: open it as soon
// as she taps Show my screen, once per share.
const autoOpened = new Set();
// Whose share each one was, so an ended share can be matched to her next one.
const shareParents = new Map();
function openMyShare() {
  const uid = state.user?.uid;
  for (const sh of state.shares) shareParents.set(sh.id, sh.parentId);
  const [, page, watching] = location.hash.split("/");
  const onWatch = page === "watch" && watching;
  // Still on the "share ended" screen of someone's share, and that same person
  // taps Show my screen again: pick it up, no need to go back and come in again.
  const endedParent = onWatch && !state.shares.some((sh) => sh.id === watching) ? shareParents.get(watching) : null;
  const mine = state.shares.find((sh) => sh.status === "waiting" && !autoOpened.has(sh.id)
    && ((endedParent && sh.parentId === endedParent)
      || state.help.some((h) => h.status === "accepted" && h.helperId === uid && h.parentId === sh.parentId)));
  if (!mine || (onWatch && !(endedParent && mine.parentId === endedParent))) return;
  autoOpened.add(mine.id);
  location.hash = `#/watch/${mine.id}`;
}

// ---------- Views ----------

// First name only: "Hi Josh", "Josh is coming to help". People sometimes type
// their full name into the first-name box.
function myName() {
  const full = state.profile?.displayName || state.user?.displayName || "";
  return full.trim().split(/\s+/)[0] || "Helper";
}

function header() {
  return `<div class="row"><div class="brand grow">${LOGO}</div>
    ${state.user ? `<button class="secondary small" data-action="signout">Sign out</button>` : ""}</div>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}`;
}

function viewLoading() {
  return `${header()}<p class="muted">Loading…</p>`;
}

function viewSignedOut() {
  const signup = state.authMode === "signup";
  return `${header()}
  <h1>${signup ? "Create your helper account" : "Welcome back"}</h1>
  <p class="muted">My Tech Kid lets you help your parents with their phone from anywhere. Only your family can connect.</p>
  <div class="tabs" role="group" aria-label="Account">
    <button class="${signup ? "secondary" : ""}" data-action="mode" data-mode="signin" aria-pressed="${!signup}">Sign in</button>
    <button class="${signup ? "" : "secondary"}" data-action="mode" data-mode="signup" aria-pressed="${signup}">New account</button>
  </div>
  <form data-form="${signup ? "signup" : "signin"}" class="card">
    ${signup ? `<div class="field"><label for="name">Your first name</label><input id="name" name="name" autocomplete="given-name" required></div>` : ""}
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" autocomplete="${signup ? "new-password" : "current-password"}" required></div>
    <button type="submit" ${state.busy ? "disabled" : ""}>${signup ? "Create account" : "Sign in"}</button>
    ${signup ? "" : `<button type="button" class="secondary" data-action="reset">Forgot password</button>`}
  </form>`;
}

// ---------- First-run story and setup ----------

// Shown once to a new visitor before they make an account. Real moments
// helpers recognize, then what changes.
const STORY = [
  {
    from: "Mom", bubble: "Honey, the screen went all funny again. Can you look at it when you get a chance?",
    title: "You've been the family tech support for years.",
    body: "You love helping. You just can't always be there.",
  },
  {
    from: "Mom", bubble: "Which button? The blue one? I don't see a blue one.",
    title: "\"Okay Mom, what do you see now?\"",
    body: "Twenty minutes on the phone, trying to picture a screen you can't see.",
  },
  {
    from: "Unknown number", warn: true, bubble: "URGENT: Your bank account has been locked. Tap here to verify your identity.",
    title: "And the texts that keep you up at night.",
    body: "Scammers count on Mom being alone when she reads one.",
  },
  {
    final: true,
    title: "Now you're one tap away.",
    body: "Mom gets one big button. You get the alert, wherever you are. She can ask \"Is this a scam?\" before she taps anything. And only family can ever connect.",
  },
];

const isIOS = /iPhone|iPad/.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPhone only allows alerts from the home-screen app.
const canAlert = () => typeof Notification !== "undefined" && "serviceWorker" in navigator && !(isIOS && !isInstalled());

function viewStory() {
  const i = Math.min(state.storyIndex, STORY.length - 1);
  const s = STORY[i];
  const top = s.bubble
    ? `<div class="msg"><div class="typing" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="bubble${s.warn ? " warn" : ""}"><span class="from">${esc(s.from)}</span>${esc(s.bubble)}</div></div>`
    : `<div class="story-mark" aria-hidden="true">tk<span class="dot">.</span></div>`;
  return `<div class="story">
    <div class="row"><div class="brand grow">${LOGO}</div>
      <button class="secondary small" data-action="story-skip">Skip</button></div>
    <div class="story-dots" aria-hidden="true">${STORY.map((_, k) => `<span class="${k < i ? "on" : k === i ? "on now" : ""}"></span>`).join("")}</div>
    <div class="story-scene">${top}
      <h1>${esc(s.title)}</h1>
      <p class="story-body">${esc(s.body)}</p></div>
    <button class="full${s.final ? " bounce" : ""}" data-action="${s.final ? "story-done" : "story-next"}">${s.final ? "Let's set it up" : "Next"}</button>
  </div>`;
}

// Setup after signing up. Each step can be skipped; the dashboard keeps
// reminding about alerts until they're on.
function setupSteps() {
  const c = state.circle;
  const hasParent = (c?.parentIds?.length ?? 0) > 0 || state.invites.length > 0;
  return [
    { key: "home", applies: isIOS, done: isInstalled() || !!storage.get("onb:home") },
    { key: "alerts", applies: canAlert(), done: state.alertsOn || !!storage.get("onb:alerts") },
    { key: "family", applies: true, done: !!state.profile?.circleId },
    { key: "parent", applies: true, done: hasParent || !!storage.get("onb:parent") },
  ].filter((step) => step.applies);
}

function currentStep() {
  return setupSteps().find((step) => !step.done) ?? null;
}

function stepFrame(step, inner) {
  const steps = setupSteps();
  const n = steps.findIndex((x) => x.key === step.key) + 1;
  const pct = Math.round((n / steps.length) * 100);
  if (motion.stepKey !== step.key) { motion.stepKey = step.key; motion.stepFrom = motion.stepPct ?? 0; }
  motion.stepPct = pct;
  return `${header()}
    <div class="progress" role="progressbar" aria-label="Setup" aria-valuemin="1" aria-valuemax="${steps.length}" aria-valuenow="${n}">
      <span style="width:${pct}%;--from:${Math.min(motion.stepFrom, pct)}%"></span></div>
    <p class="eyebrow">Step ${n} of ${steps.length}</p>
    ${inner}`;
}

const SHARE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;

function viewSetup(step) {
  if (step.key === "home") {
    return stepFrame(step, `<h1>Put My Tech Kid on your home screen</h1>
      <p class="muted">On iPhone, alerts only work from the home screen. It takes ten seconds.</p>
      <ol class="howto card">
        <li>Tap the <strong>Share</strong> button ${SHARE_ICON} at the bottom of Safari.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open <strong>My Tech Kid</strong> from your home screen and sign in.</li>
      </ol>
      <button class="secondary" data-action="skip-step" data-step="home">I'll do it later</button>`);
  }
  if (step.key === "alerts") {
    return stepFrame(step, `<h1>Know the moment Mom needs you</h1>
      <p class="muted">When Mom taps her help button or asks about a scam, your phone buzzes. You'll only get alerts from your own family.</p>
      <button data-action="alerts-setup" ${state.busy ? "disabled" : ""}>Turn on alerts</button>
      <button class="secondary" data-action="skip-step" data-step="alerts">Not now</button>`);
  }
  if (step.key === "family") {
    return stepFrame(step, `<h1>Name your family</h1>
      <p class="muted">This is your circle: the people you help, like Mom and Dad, and anyone who helps alongside you.</p>
      <form data-form="circle" class="card">
        <div class="field"><label for="circleName">Family name</label><input id="circleName" name="circleName" placeholder="Smith Family" required></div>
        <button type="submit" ${state.busy ? "disabled" : ""}>Create my family</button>
      </form>`);
  }
  return stepFrame(step, `<h1>Now add Mom or Dad</h1>
    <div class="card">
      <ol class="howto">
        <li>You text them a link.</li>
        <li>They tap it and install My Tech Kid.</li>
        <li>You call, and you both check that three pictures match.</li>
      </ol>
      <p class="muted">Best done when you can talk on the phone for five minutes.</p>
    </div>
    <a class="button" href="#/add">Add Mom or Dad</a>
    <button class="secondary" data-action="skip-step" data-step="parent">Later</button>`);
}

function alertsBanner() {
  if (state.alertsOn) return "";
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (ios && !installed) {
    return `<div class="alert blue"><h2>Get an alert when Mom needs help</h2>
      <p>On iPhone, first add My Tech Kid to your home screen: tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>. Then open My Tech Kid from your home screen and turn on alerts.</p></div>`;
  }
  return `<div class="alert blue"><h2>Get an alert when Mom needs help</h2>
    <button data-action="alerts">Turn on alerts</button></div>`;
}

function helpCards() {
  const uid = state.user.uid;
  return state.help.map((h) => {
    if (h.practice) {
      return h.status === "waiting"
        ? `<div ${popAttrs(h.id, "alert urgent")}><p class="eyebrow" style="color:inherit">Practice run</p>
            <h2>${esc(h.parentName)} just tried the help button</h2>
            <p>This is what you'll see when ${esc(h.parentName)} needs you. Tap <strong>Got it</strong> so ${esc(h.parentName)} sees it works.</p>
            <button data-action="accept-help" data-id="${esc(h.id)}">Got it</button></div>`
        : `<div ${popAttrs(h.id + "-ok", "alert green")}><h2>${esc(h.parentName)} saw it work</h2>
            <p>You're all set. Next time it's real, you'll get an alert like that one.</p></div>`;
    }
    if (h.status === "waiting") {
      return `<div ${popAttrs(h.id, "alert urgent")}><div class="row"><h2 class="grow">${esc(h.parentName)} needs help</h2>
        <span class="muted">${esc(timeAgo(h.createdAt))}</span></div>
        ${voiceBlock(h)}
        <button data-action="accept-help" data-id="${esc(h.id)}">I'm on it</button></div>`;
    }
    if (h.helperId === uid) {
      return `<div class="alert blue"><h2>You're helping ${esc(h.parentName)}</h2>
        ${voiceBlock(h)}
        <p>${helpingNote(h)}</p>
        <button class="good" data-action="done-help" data-id="${esc(h.id)}">All fixed</button></div>`;
    }
    return `<div class="alert blue"><p><strong>${esc(h.helperName)}</strong> is helping ${esc(h.parentName)}.</p></div>`;
  }).join("");
}

// Mom tapped "Show my screen" on her phone.
function shareCards() {
  return state.shares.map((sh) => {
    if (sh.status === "waiting") {
      return `<div ${popAttrs(sh.id, "alert urgent")}><h2>${esc(sh.parentName)} wants to show you their screen</h2>
        <a class="button" href="#/watch/${esc(sh.id)}">Watch ${esc(sh.parentName)}'s screen</a></div>`;
    }
    if (sh.helperId === state.user.uid) {
      return `<div class="alert blue"><p>You're watching ${esc(sh.parentName)}'s screen.</p>
        <a class="button secondary" href="#/watch/${esc(sh.id)}">Open it</a></div>`;
    }
    return `<div class="alert blue"><p><strong>${esc(sh.helperName)}</strong> is watching ${esc(sh.parentName)}'s screen.</p></div>`;
  }).join("");
}

function scamCards() {
  return state.scams.filter((s) => !s.verdict).map((s) => `
    <div ${popAttrs(s.id, "card")}><p class="eyebrow">Scam check</p><h2>${esc(s.parentName)} asks: is this a scam?</h2>
      <p class="quote">${esc(s.text.slice(0, 160))}${s.text.length > 160 ? "…" : ""}</p>
      <a class="button secondary" href="#/scam/${esc(s.id)}">Review and answer</a></div>`).join("");
}

function memberCards() {
  const c = state.circle;
  if (!c) return "";
  const parents = (c.parentIds ?? []).map((id) => ({ id, ...c.members?.[id] }));
  const helpers = (c.helperIds ?? []).map((id) => ({ id, ...c.members?.[id] }));
  const parentHtml = parents.length
    ? parents.map((p) => `<div class="card"><div class="row"><span class="avatar">${initial(p.name)}</span>
        <div class="grow"><strong>${esc(p.name)}</strong><br><span class="muted">${esc([deviceLabel(p.device), `Linked ${timeAgo(p.linkedAt)}`].filter(Boolean).join(" · "))}</span></div></div>
        ${howToHelp(p)}
        ${ringButton(p)}
        <p class="muted">${isPast(p.controlAllowedAt)
          ? `You can tap for ${esc(p.name)} while they show you their screen, once they say yes on their phone.`
          : `For safety, tapping for ${esc(p.name)} unlocks ${esc(formatTime(p.controlAllowedAt))}.`}</p>
        ${removeControls(p)}</div>`).join("")
    : `<div class="card"><p>No one is linked yet. Add Mom or Dad to get started.</p></div>`;
  const helperNames = helpers.map((h) => (h.id === state.user.uid ? "You" : esc(h.name))).join(", ");
  return `${parentHtml}<p class="muted">Helpers: ${helperNames}</p>`;
}

// Removing a phone is rare (lost, replaced, given away), so it hides behind a
// quiet link and takes two deliberate taps plus a confirmation.
function removeControls(p) {
  if (state.removing !== p.id) {
    return `<button class="text-link" data-action="show-remove" data-id="${esc(p.id)}">Phone lost or replaced?</button>`;
  }
  return `<div class="remove-box"><p>If ${esc(p.name)}'s phone was lost, replaced or given away, remove it.
      ${esc(p.name)} will need a new invite to reach you again.</p>
    <div class="row"><button class="secondary small" data-action="hide-remove">Cancel</button>
      <button class="danger small" data-action="remove-member" data-id="${esc(p.id)}" data-name="${esc(p.name)}"
        ${state.busy ? "disabled" : ""}>Remove ${esc(p.name)}'s phone</button></div></div>`;
}

// Only Mom's Android app can ring itself; iPhones have Find My for that.
function ringButton(p) {
  if (p.device?.platform !== "android") return "";
  if (state.ringing[p.id]) {
    return `<p class="muted" role="status">Ringing ${esc(p.name)}'s phone now. It stops after 30 seconds, or when they tap Found it.</p>`;
  }
  return `<button class="secondary small" data-action="ring" data-id="${esc(p.id)}" ${state.busy ? "disabled" : ""}>
    Ring ${esc(p.name)}'s phone</button>`;
}

// After "I'm on it": an Android phone asks them to share right away (they
// tap Start), and their screen opens here by itself.
function helpingNote(h) {
  const parent = state.circle?.members?.[h.parentId];
  const name = esc(h.parentName);
  if (parent?.device?.platform === "android") {
    return `Give ${name} a call now. Their phone is asking them to share their screen: once they tap
      <strong>Start</strong>, it opens here by itself, and from there you can ask to tap for them.`;
  }
  return `Give them a call now. To see their phone, ask them to tap <strong>Show ${esc(myName())} my screen</strong>.
    It opens here by itself, and from there you can ask to tap for them.`;
}

function howToHelp(p) {
  const name = esc(p.name);
  switch (helpMethod(p.device, myDevice)) {
    case "app":
      return `<p class="muted">${name} can show you their screen from the My Tech Kid app. You'll get an alert when they do.</p>`;
    case "facetime-control":
      return `<p class="muted">${name} has an iPhone, so help on FaceTime. On the call, ask them to tap Share My Screen.
        Then tap the pointing-hand button to ask to tap for them, and they tap Allow.</p>`;
    case "facetime-view":
      return `<p class="muted">${name} has an iPhone, so help on FaceTime. On the call, ask them to tap Share My Screen so you can
        see it and talk them through it. To tap for them too, you both need iPhones on iOS 18 or newer.</p>`;
    default:
      return "";
  }
}

function pendingInvites() {
  return state.invites
    .filter((i) => i.createdBy === state.user.uid && (i.status === "claimed" || (i.status === "open" && !isPast(i.expiresAt))))
    .map((i) => `<a class="button secondary" href="#/invite/${esc(i.id)}">Finish adding ${esc(i.forName)}</a>`).join("");
}

// "Scherz" -> "Scherz Family"; "the scherz family" -> "Scherz Family".
function familyTitle(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() === "the") words.shift();
  if (words.at(-1)?.toLowerCase() === "family") words.pop();
  if (!words.length) return "Your Family";
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return [...words, "Family"].join(" ");
}

function viewDashboard() {
  const answered = state.scams.filter((s) => s.verdict).slice(0, 5);
  return `${header()}
  <div><p class="muted">Your family</p><h1>${esc(familyTitle(state.circle?.name))}</h1></div>
  ${alertsBanner()}
  ${helpCards()}
  ${shareCards()}
  ${scamCards()}
  ${memberCards()}
  ${pendingInvites()}
  <a class="button" href="#/add">Add Mom or Dad</a>
  ${answered.length ? `<h2>Recent scam checks</h2>${answered.map((s) => `
    <a class="card" style="text-decoration:none;color:inherit" href="#/scam/${esc(s.id)}">
      <strong>${esc(s.parentName)}: ${esc(VERDICTS[s.verdict])}</strong>
      <span class="muted">${esc(s.text.slice(0, 80))}</span></a>`).join("")}` : ""}
  ${appearance()}`;
}

function appearance() {
  return `<div class="appearance"><span class="muted">Appearance</span>
    <div class="choices" role="group" aria-label="Appearance">${Object.entries(THEMES).map(([key, label]) =>
      `<button type="button" data-action="theme" data-choice="${key}" aria-pressed="${themeChoice === key}">${label}</button>`).join("")}</div></div>`;
}

function viewAdd() {
  return `${header()}
  <a href="#/">← Back</a>
  <h1>Add Mom or Dad</h1>
  <p class="muted">You'll get a link to text them, or a code to scan if you're together. It works once and expires after an hour.</p>
  <form data-form="invite" class="card">
    <div class="field"><label for="forName">What do you call them?</label><input id="forName" name="forName" value="Mom" required></div>
    <button type="submit" ${state.busy ? "disabled" : ""}>Create invite link</button>
  </form>`;
}

function inviteUrl(invite) {
  const token = storage.get(`invite:${invite.id}`);
  if (!token) return null;
  const params = new URLSearchParams({ c: circleId, i: invite.id, t: token });
  return `${location.origin}/join?${params}`;
}

function picturesHtml(pictures) {
  return `<div class="pictures">${(pictures ?? []).map((p) =>
    `<div class="picture"><span aria-hidden="true">${esc(p.emoji)}</span><span>${esc(p.label)}</span></div>`).join("")}</div>`;
}

const CONFETTI = ["var(--amber)", "var(--navy)", "var(--green)", "var(--amber)", "var(--focus)"];

function celebrate() {
  const bits = Array.from({ length: 22 }, (_, k) => {
    const angle = (k / 22) * Math.PI * 2;
    const dist = 90 + (k % 4) * 28;
    return `<i style="--x:${Math.round(Math.cos(angle) * dist)}px;--y:${Math.round(Math.sin(angle) * dist - 40)}px;--r:${k * 47}deg;--c:${CONFETTI[k % CONFETTI.length]};--d:${(k % 5) * 30}ms"></i>`;
  }).join("");
  return `<div class="celebrate" aria-hidden="true"><div class="confetti">${bits}</div>
    <svg viewBox="0 0 52 52" width="96" height="96"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>`;
}

function viewInvite(id) {
  const invite = state.invites.find((i) => i.id === id);
  if (!invite) return `${header()}<a href="#/">← Back</a><p class="muted">Loading invite…</p>`;
  const name = esc(invite.forName);
  let body;
  if (invite.status === "open" && isPast(invite.expiresAt)) {
    body = `<div class="card"><h1>This invite expired</h1><a class="button" href="#/add">Make a new one</a></div>`;
  } else if (invite.status === "open") {
    const url = inviteUrl(invite);
    const together = state.inPerson === invite.id;
    body = !url
      ? ""
      : together
      ? `<h1>Scan this with ${name}'s phone</h1>
        <p class="muted">On ${name}'s phone, open the Camera and point it at this code, then tap the link that pops up.</p>
        <div class="card qr-card">${qrSvg(url, `Setup code for ${name}`)}</div>
        <button class="secondary full" data-action="in-person" data-id="">Send a link instead</button>
        <div class="alert blue"><p>Waiting for ${name}'s phone… Then you'll both see three pictures: check they match.</p></div>`
      : `<h1>Text this link to ${name}</h1>
        <p class="muted">Send it from your own phone number so ${name} knows it's you. Then stay on this screen.</p>
        <div class="card"><p class="link-box">${esc(url)}</p>
          <button data-action="share" data-url="${esc(url)}" data-name="${name}">Share link</button>
          <button class="secondary" data-action="copy" data-url="${esc(url)}">Copy link</button></div>
        <button class="secondary full" data-action="in-person" data-id="${esc(invite.id)}">With ${name} now? Show a code to scan</button>
        <div class="alert blue"><p>Waiting for ${name} to open it… When they do, you'll both see three pictures. Call ${name} to check they match.</p></div>`;
    body = body || `<div class="card"><h1>Open this on the phone that made it</h1><p>The link for this invite was made on another device. You can also make a new one.</p>
        <a class="button" href="#/add">Make a new invite</a></div>`;
  } else if (invite.status === "claimed" && !invite.helperConfirmed) {
    body = `<h1>${state.inPerson === invite.id ? `Check ${name}'s phone` : `Call ${name} now`}</h1>
      <p>${state.inPerson === invite.id ? `${name}'s phone should show these three pictures:` : `Ask: <strong>"Which three pictures do you see?"</strong> They should be:`}</p>
      ${picturesHtml(invite.pictures)}
      <button class="good full" data-action="confirm" data-id="${esc(invite.id)}" data-match="yes">They match</button>
      <button class="secondary full" data-action="confirm" data-id="${esc(invite.id)}" data-match="no">They don't match — stop</button>`;
  } else if (invite.status === "claimed") {
    body = `<div class="alert blue"><h2>Waiting for ${name}</h2><p>Ask ${name} to tap <strong>They match</strong> on their phone.</p></div>
      ${picturesHtml(invite.pictures)}`;
  } else if (invite.status === "linked") {
    const practice = helpCards();
    body = `${celebrate()}<div class="alert green"><h1>${name} is linked!</h1>
      <p>${name}'s phone now has a big button that reaches you.</p></div>
      ${practice || `<p class="muted">Stay on the phone: ${name} will be asked to try the button once, and you'll see it here.</p>`}
      <a class="button${practice ? " secondary" : ""}" href="#/">Done</a>`;
  } else if (invite.status === "expired") {
    body = `<div class="card"><h1>This invite expired</h1><p>Invites have to be finished within an hour. Make a new one and try again.</p>
      <a class="button" href="#/add">Make a new invite</a></div>`;
  } else {
    body = `<div class="card"><h1>Stopped</h1><p>This invite was cancelled. If the pictures didn't match, someone else may have opened the link. Make a new one and send it again.</p>
      <a class="button" href="#/add">Make a new invite</a></div>`;
  }
  return `${header()}<a href="#/">← Back</a>${body}`;
}

const VERDICTS = { scam: "Scam", unsure: "Not sure", safe: "Safe" };

function viewScam(id) {
  const s = state.scams.find((x) => x.id === id);
  if (!s) return `${header()}<a href="#/">← Back</a><p class="muted">Loading…</p>`;
  const top = `${header()}<a href="#/">← Back</a><h1>${esc(s.parentName)}'s scam check</h1>
    <p class="muted">Sent ${esc(timeAgo(s.createdAt))}</p><p class="quote">${esc(s.text)}</p>`;
  if (s.verdict) {
    return `${top}<div class="alert ${s.verdict === "safe" ? "green" : "red"}">
      <h2>${esc(s.answeredByName)} answered: ${esc(VERDICTS[s.verdict])}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ""}</div>`;
  }
  const picked = state.verdicts[id];
  return `${top}
  <form data-form="scam" data-id="${esc(id)}" class="card">
    <p><strong>Your answer</strong></p>
    <div class="verdicts" role="group" aria-label="Your answer">
      ${Object.entries(VERDICTS).map(([key, label]) => `
        <button type="button" class="${picked === key ? (key === "safe" ? "good" : "danger") : "secondary"}"
          data-action="verdict" data-id="${esc(id)}" data-verdict="${key}" aria-pressed="${picked === key}">${label}</button>`).join("")}
    </div>
    <div class="field"><label for="note">Message to ${esc(s.parentName)}</label>
      <textarea id="note" name="note" rows="3" maxlength="500" placeholder="That's a fake delivery text. Just delete it."></textarea></div>
    <button type="submit" ${!picked || state.busy ? "disabled" : ""}>Send to ${esc(s.parentName)}</button>
  </form>`;
}

// ---------- Motion ----------
// Entrance animations play once when a new screen appears. Live updates
// re-render the page, so later renders pass --since (a negative delay) and
// animations carry on from where they were instead of starting over.
const ENTER_MS = 2200;
const POP_MS = 1500;
const motion = { key: "", since: 0, seen: new Map() };

// Class (and timing) for a card that should bounce in the first time it shows.
function popAttrs(id, classes) {
  if (!motion.seen.has(id)) motion.seen.set(id, Date.now());
  const elapsed = Date.now() - motion.seen.get(id);
  return elapsed < POP_MS ? `class="${classes} pop" style="--since:-${elapsed}ms"` : `class="${classes}"`;
}

function screenKey(page, id, step) {
  if (state.user === undefined) return "loading";
  if (!state.user) return storage.get("onb:story") ? "signin" : `story${state.storyIndex}`;
  if (state.profile === null || (state.profile.circleId && !state.circle)) return "loading";
  if (step) return `setup-${step.key}`;
  if (page === "invite") return `invite-${id}-${state.invites.find((i) => i.id === id)?.status}`;
  return `${page || "home"}-${id || ""}`;
}

function render() {
  // Keep whatever the person is typing when live updates re-render the page.
  const kept = [...root.querySelectorAll("input[id], textarea[id]")].map((el) => [el.id, el.value]);
  const focused = document.activeElement?.id;

  const [, page, id] = (location.hash || "#/").split("/");
  let html;
  const step = state.user && state.profile ? currentStep() : null;
  if (state.user === undefined) html = viewLoading();
  else if (!state.user) html = storage.get("onb:story") ? viewSignedOut() : viewStory();
  else if (state.profile === null) html = viewLoading();
  else if (state.profile.circleId && !state.circle) html = viewLoading();
  else if (step && (!state.profile.circleId || (page !== "add" && page !== "invite"))) html = viewSetup(step);
  else if (page === "add") html = viewAdd();
  else if (page === "invite" && id) html = viewInvite(id);
  else if (page === "scam" && id) html = viewScam(id);
  else html = viewDashboard();
  root.innerHTML = html;

  if (page === "watch" && id && state.circle) {
    watchShare({ db, uid: state.user.uid, myName: myName(), circleId, shareId: id,
      parentName: state.shares.find((sh) => sh.id === id)?.parentName,
      iceServers: () => relayPass(id) });
  } else {
    closeWatch();
  }

  const key = screenKey(page, id, step);
  if (key !== motion.key) { motion.key = key; motion.since = Date.now(); }
  const elapsed = Date.now() - motion.since;
  root.classList.toggle("enter", elapsed < ENTER_MS && key !== "loading");
  root.style.setProperty("--since", `-${elapsed}ms`);

  for (const [elId, value] of kept) {
    const el = document.getElementById(elId);
    if (el && el.type !== "password") el.value = value;
  }
  if (focused) document.getElementById(focused)?.focus();
}

window.addEventListener("hashchange", () => { state.error = ""; render(); window.scrollTo(0, 0); });

// ---------- Actions ----------

async function run(fn) {
  state.busy = true;
  state.error = "";
  render();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    state.error = friendlyError(err);
  } finally {
    state.busy = false;
    render();
  }
}

function friendlyError(err) {
  const code = err?.code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "That email and password don't match.";
  if (code.includes("email-already-in-use")) return "There's already an account with that email. Try signing in.";
  if (code.includes("weak-password")) return "Please use a longer password (at least 8 characters).";
  if (code.includes("network")) return "No internet connection. Try again.";
  return err?.message ?? "Something went wrong.";
}

async function enableAlerts({ quiet = false } = {}) {
  try {
    if (!(await isSupported())) throw new Error("This browser can't show alerts.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Alerts are turned off for My Tech Kid in your settings.");
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(getMessaging(fbApp), { vapidKey, serviceWorkerRegistration: registration });
    await setDoc(doc(db, "users", auth.currentUser.uid), { fcmTokens: arrayUnion(token), platform: "web" }, { merge: true });
    state.alertsOn = true;
  } catch (err) {
    if (!quiet) throw err;
    console.warn("Could not refresh alerts", err);
  }
}

const actions = {
  "play-voice": (el) => playVoice(el.dataset.id),
  mode: (el) => { state.authMode = el.dataset.mode; state.error = ""; render(); },
  signout: () => run(() => signOut(auth)),
  reset: () => run(async () => {
    const email = document.getElementById("email")?.value.trim();
    if (!email) throw new Error("Type your email first, then tap Forgot password.");
    await sendPasswordResetEmail(auth, email);
    state.error = "Check your email for a link to reset your password.";
  }),
  alerts: () => run(() => enableAlerts()),
  "accept-help": (el) => run(() => {
    wakeRelay();
    return updateDoc(doc(db, `circles/${circleId}/helpRequests/${el.dataset.id}`), {
      status: "accepted", helperId: state.user.uid, helperName: myName(), updatedAt: serverTimestamp(),
    });
  }),
  ring: (el) => run(async () => {
    const parentId = el.dataset.id;
    await addDoc(collection(db, `circles/${circleId}/rings`), {
      parentId, helperId: state.user.uid, helperName: myName(), createdAt: serverTimestamp(),
    });
    state.ringing[parentId] = true;
    setTimeout(() => { delete state.ringing[parentId]; render(); }, 30_000);
  }),
  "in-person": (el) => { state.inPerson = el.dataset.id || null; render(); },
  "show-remove": (el) => { state.removing = el.dataset.id; render(); },
  "hide-remove": () => { state.removing = null; render(); },
  "remove-member": (el) => {
    const name = el.dataset.name || "this person";
    if (!confirm(`Remove ${name}'s phone from your family?\n\nUse this if the phone was lost, replaced or given away. ${name} won't be able to reach you from it until you send a new invite.`)) return;
    state.removing = null;
    run(() => call("removeMember", { circleId, memberId: el.dataset.id }));
  },
  "done-help": (el) => run(() => updateDoc(doc(db, `circles/${circleId}/helpRequests/${el.dataset.id}`), {
    status: "done", updatedAt: serverTimestamp(),
  })),
  share: async (el) => {
    const url = el.dataset.url;
    const text = `Hi ${el.dataset.name}, it's ${myName()}. Tap this link to set up My Tech Kid so I can help with your phone:`;
    if (navigator.share) {
      try { await navigator.share({ text, url }); } catch { /* closed the share sheet */ }
    } else {
      await actions.copy(el);
    }
  },
  copy: async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.url);
      el.textContent = "Copied!";
    } catch {
      state.error = "Couldn't copy. Press and hold the link to copy it.";
      render();
    }
  },
  confirm: (el) => run(() => call("confirmInvite", { circleId, inviteId: el.dataset.id, match: el.dataset.match === "yes" })),
  "story-next": () => { state.storyIndex += 1; render(); window.scrollTo(0, 0); },
  "story-skip": () => { storage.set("onb:story", "1"); state.authMode = "signin"; render(); },
  "story-done": () => { storage.set("onb:story", "1"); state.authMode = "signup"; render(); window.scrollTo(0, 0); },
  "skip-step": (el) => { storage.set(`onb:${el.dataset.step}`, "1"); render(); window.scrollTo(0, 0); },
  "alerts-setup": () => run(() => enableAlerts()),
  theme: (el) => {
    themeChoice = el.dataset.choice;
    storage.set("theme", themeChoice);
    applyTheme(themeChoice);
    render();
  },
  verdict: (el) => { state.verdicts[el.dataset.id] = el.dataset.verdict; render(); },
};

// Read form fields by name (form.name would be the form's own name attribute).
const val = (form, field) => form.elements.namedItem(field).value;

const forms = {
  signin: (f) => run(() => signInWithEmailAndPassword(auth, val(f, "email").trim(), val(f, "password"))),
  signup: (f) => run(async () => {
    const name = val(f, "name").trim();
    const cred = await createUserWithEmailAndPassword(auth, val(f, "email").trim(), val(f, "password"));
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { displayName: name }, { merge: true });
  }),
  circle: (f) => run(() => call("createCircle", { circleName: val(f, "circleName").trim(), displayName: myName() })),
  invite: (f) => run(async () => {
    const { inviteId, token } = await call("createInvite", { circleId, forName: val(f, "forName").trim() });
    storage.set(`invite:${inviteId}`, token);
    location.hash = `#/invite/${inviteId}`;
  }),
  scam: (f) => run(async () => {
    const id = f.dataset.id;
    await updateDoc(doc(db, `circles/${circleId}/scamChecks/${id}`), {
      verdict: state.verdicts[id],
      note: val(f, "note").trim(),
      answeredBy: state.user.uid,
      answeredByName: myName(),
      answeredAt: serverTimestamp(),
    });
    delete state.verdicts[id];
  }),
};

root.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (el && actions[el.dataset.action]) {
    event.preventDefault();
    actions[el.dataset.action](el);
  }
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (form && forms[form.dataset.form]) {
    event.preventDefault();
    forms[form.dataset.form](form);
  }
});

render();

// A home-screen app on iPhone can stay open for days on an old version. When
// it comes back to the front (and every 15 minutes), check whether a newer
// version is published and reload, unless a screen share or typing is under way.
const myBuild = document.querySelector('script[src*="/assets/main-"]')?.getAttribute("src");
async function reloadIfUpdated() {
  if (!myBuild || document.hidden || location.hash.startsWith("#/watch/")) return;
  if (root.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    const latest = html.match(/\/assets\/main-[\w-]+\.js/)?.[0];
    if (latest && !myBuild.endsWith(latest)) location.reload();
  } catch { /* offline: try again later */ }
}
document.addEventListener("visibilitychange", reloadIfUpdated);
setInterval(reloadIfUpdated, 15 * 60 * 1000);
