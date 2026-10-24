// My Tech Kid helper app (the person giving help). Runs in the browser and can be
// added to an iPhone home screen. The side of the person getting help is the
// Android app in android/.

import "./styles.css";
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy, limit, onSnapshot,
  setDoc, updateDoc, addDoc, serverTimestamp, arrayUnion,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseConfig, vapidKey, isConfigured, apkPath } from "./config.js";
import { esc, initial, timeAgo, formatTime, isPast, storage } from "./util.js";
import { watchShare, closeWatch } from "./watch.js";
import { qrSvg } from "./qr.js";
import { isPhoto, shrinkPhoto } from "./photo.js";
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
      (s) => { state.help = s.docs.map((d) => ({ id: d.id, ...d.data() })); watchVoices(); acceptFromAlert(); render(); }, fail),
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

// Tapping the "needs help" alert opens #/help/<id>: that tap is "I'm on it",
// so the helper doesn't have to find the button too. Only for a request
// still waiting (another helper may have taken it); then back to home.
function acceptFromAlert() {
  const [, page, id] = location.hash.split("/");
  if (page !== "help" || !id || !circleId) return;
  const req = state.help.find((h) => h.id === id);
  if (!req) return;
  history.replaceState(null, "", "#/");
  if (req.status === "waiting" && !req.practice) acceptHelp(id);
}

function acceptHelp(id) {
  return run(() => {
    wakeRelay();
    return updateDoc(doc(db, `circles/${circleId}/helpRequests/${id}`), {
      status: "accepted", helperId: state.user.uid, helperName: myName(), updatedAt: serverTimestamp(),
    });
  });
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

// Once the family exists, Sign out lives in Settings (the gear on Home).
function header(right = state.user && !state.circle ? `<button class="secondary small" data-action="signout">Sign out</button>` : "") {
  return `<div class="row"><div class="brand grow">${LOGO}</div>${right}</div>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}`;
}

function viewLoading() {
  return `${header()}<p class="muted">Loading…</p>`;
}

function viewSignedOut() {
  const signup = state.authMode === "signup";
  return `${header()}
  <h1>${signup ? "Create your helper account" : "Welcome back"}</h1>
  <p class="muted">My Tech Kid lets you help the people you look out for with their phone, from anywhere. Only people you link can connect.</p>
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

// Who's here? The website is mostly for helpers, but someone who wants help
// can land on it too, so the very first screen asks. Remembered on this
// device only.
const ROLES = {
  helper: { title: "I help someone with their phone", note: "A parent, grandparent, partner, friend or neighbor" },
  "getting-help": { title: "I want help with my phone", note: "Someone you trust helps from their own phone" },
};
// The link from "Text someone who can help" on the Android app
// (`/?start=helper`) already says who this is.
if (new URLSearchParams(location.search).get("start") === "helper") storage.set("onb:role", "helper");

// Shown once to a new helper before they make an account. Real moments
// helpers recognize, then what changes. Gender neutral on purpose: the person
// they help could be anyone.
const STORY = [
  {
    from: "Pat", bubble: "Hi, the screen went all funny again. Can you look at it when you get a chance?",
    title: "You're the one everyone calls for tech help.",
    body: "You love helping. You just can't always be there.",
  },
  {
    from: "Pat", bubble: "Which button? The blue one? I don't see a blue one.",
    title: "\"Okay, what do you see now?\"",
    body: "Twenty minutes on the phone, trying to picture a screen you can't see.",
  },
  {
    from: "Unknown number", warn: true, bubble: "URGENT: Your bank account has been locked. Tap here to verify your identity.",
    title: "And the texts that keep you up at night.",
    body: "Scammers count on people being alone when they read one.",
  },
  {
    final: true,
    title: "Now you're one tap away.",
    body: "They get one big button. You get the alert, wherever you are. They can ask \"Is this a scam?\" before tapping anything. And only people you link can ever connect.",
  },
];

const isIOS = /iPhone|iPad/.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPhone only allows alerts from the home-screen app.
const canAlert = () => typeof Notification !== "undefined" && "serviceWorker" in navigator && !(isIOS && !isInstalled());

function viewRole() {
  return `<div class="brand">${LOGO}</div>
    <h1>Who are you?</h1>
    <p class="muted">My Tech Kid connects someone who wants a hand with their phone to a person they trust.</p>
    ${Object.entries(ROLES).map(([key, r]) => `
      <button class="choice" data-action="role" data-role="${key}"><strong>${r.title}</strong><span>${r.note}</span></button>`).join("")}
    <button class="secondary small" data-action="role-signin">I already have an account</button>`;
}

// For someone who wants help: the app lives on their Android phone, and the
// person helping them starts the link.
function viewGettingHelp() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const steps = isAndroid
    ? `<div class="card"><ol class="howto">
        <li>Download My Tech Kid and tap <strong>Install</strong>.</li>
        <li>Open it and tap <strong>Text someone who can help</strong>.</li>
        <li>On a phone call, you both check that three pictures match.</li>
      </ol>
      <a class="button full" href="${esc(apkPath)}" download>Download My Tech Kid</a></div>`
    : `<div class="card"><p>For now, getting help works on <strong>Android</strong> phones. iPhone is coming later.</p>
      <p class="muted">If you have an Android phone, open this page on it. Or send this page to the person who helps you with tech.</p>
      <button class="secondary" data-action="share-site">Send this page to someone</button></div>`;
  return `<div class="brand">${LOGO}</div>
    <h1>Let's get you some help</h1>
    <p class="muted">You'll get one big button that reaches someone you trust, plus an "Is this a scam?" button.</p>
    ${steps}
    <div class="alert blue"><p><strong>Only connect with people you know.</strong> Banks, Samsung, Google, Microsoft and the police will never ask you to use this app.</p></div>
    <button class="secondary small" data-action="role-back">Go back</button>`;
}

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
// reminding about alerts until they're on. The photo step is only for a new
// family (it needs the family to exist, and helpers who already linked
// someone change it from the home page).
function setupSteps() {
  const c = state.circle;
  const hasParent = (c?.parentIds?.length ?? 0) > 0 || state.invites.length > 0;
  return [
    { key: "home", applies: isIOS, done: isInstalled() || !!storage.get("onb:home") },
    { key: "alerts", applies: canAlert(), done: state.alertsOn || !!storage.get("onb:alerts") },
    { key: "family", applies: true, done: !!state.profile?.circleId },
    { key: "photo", applies: !hasParent, done: !!myPhoto() || !!storage.get("onb:photo") },
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
    return stepFrame(step, `<h1>Know the moment you're needed</h1>
      <p class="muted">When someone you help taps their help button or asks about a scam, your phone buzzes. You'll only get alerts from people you've linked.</p>
      <button data-action="alerts-setup" ${state.busy ? "disabled" : ""}>Turn on alerts</button>
      <button class="secondary" data-action="skip-step" data-step="alerts">Not now</button>`);
  }
  if (step.key === "family") {
    return stepFrame(step, `<h1>Name your family</h1>
      <p class="muted">This is your circle: the people you help, and anyone who helps alongside you. Friends and neighbors count too.</p>
      <form data-form="circle" class="card">
        <div class="field"><label for="circleName">Family name</label><input id="circleName" name="circleName" value="${esc(myName())}'s Family" maxlength="40" required></div>
        <button type="submit" ${state.busy ? "disabled" : ""}>Create my family</button>
      </form>`);
  }
  if (step.key === "photo") {
    return stepFrame(step, `<h1>Add your photo</h1>
      <p class="muted">The person you help sees your face on their big button, so they know exactly who they're reaching.</p>
      ${photoPicker()}
      <button class="secondary" data-action="skip-step" data-step="photo">Later</button>`);
  }
  return stepFrame(step, `<h1>Now add someone you help</h1>
    <div class="card">
      <ol class="howto">
        <li>You text them a link.</li>
        <li>They tap it and install My Tech Kid.</li>
        <li>You call, and you both check that three pictures match.</li>
      </ol>
      <p class="muted">Best done when you can talk on the phone for five minutes.</p>
    </div>
    <a class="button" href="#/add">Add someone</a>
    <button class="secondary" data-action="skip-step" data-step="parent">Later</button>`);
}

function alertsBanner() {
  if (state.alertsOn) return "";
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (ios && !installed) {
    return `<div class="alert blue"><h2>Get an alert when someone needs help</h2>
      <p>On iPhone, first add My Tech Kid to your home screen: tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>. Then open My Tech Kid from your home screen and turn on alerts.</p></div>`;
  }
  return `<div class="alert blue"><h2>Get an alert when someone needs help</h2>
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
  return parents.length
    ? parents.map((p) => `<div class="card"><div class="row"><span class="avatar">${initial(p.name)}</span>
        <div class="grow"><strong>${esc(p.name)}</strong><br><span class="muted">${esc(personLine(p))}</span></div></div>
        ${howToHelp(p)}
        ${ringButton(p)}</div>`).join("")
    : `<div class="card"><p>No one is linked yet. Add someone you help to get started.</p></div>`;
}

function personLine(p) {
  return [relationLabel(p.relationship), deviceLabel(p.device), `Linked ${timeAgo(p.linkedAt)}`].filter(Boolean).join(" · ");
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
  if (parent?.device?.platform === "ios") {
    return `Give ${name} a call now. To see their iPhone, ask them to tap <strong>Show ${esc(myName())} my screen</strong>,
      then <strong>Start Broadcast</strong>. It opens here by itself. iPhones don't let anyone tap for them, so talk them through it.`;
  }
  return `Give them a call now. To see their phone, ask them to tap <strong>Show ${esc(myName())} my screen</strong>.
    It opens here by itself, and from there you can ask to tap for them.`;
}

function howToHelp(p) {
  const name = esc(p.name);
  switch (helpMethod(p.device, myDevice)) {
    case "app":
      return `<p class="muted">${name} can show you their screen from the My Tech Kid app. You'll get an alert when they do.</p>`;
    case "app-view-tap-on-facetime":
      return `<p class="muted">${name} can show you their screen from the My Tech Kid app. iPhones don't let apps tap for
        someone, so talk them through it. To tap for them, use FaceTime: ask them to tap Share My Screen, then tap the
        pointing-hand button, and they tap Allow.</p>`;
    case "app-view":
      return `<p class="muted">${name} can show you their screen from the My Tech Kid app, so you can see it and talk them
        through it. iPhones don't let apps tap for someone.</p>`;
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

// Families named after this change are shown exactly as typed ("Team Blue").
function familyName(circle) {
  return circle?.nameAsTyped ? circle.name : familyTitle(circle?.name);
}

function myPhoto() {
  const photo = state.circle?.members?.[state.user.uid]?.photo;
  return isPhoto(photo) ? photo : null;
}

function faceHtml(name, photo, cls = "avatar") {
  return photo ? `<img class="${cls} photo" src="${photo}" alt="">` : `<span class="${cls}">${initial(name)}</span>`;
}

function photoCard() {
  const photo = myPhoto();
  const who = parentWord();
  return `<a class="card photo-card" href="#/photo">
    <div class="row">${faceHtml(myName(), photo, "avatar big")}
      <div class="grow"><strong>${esc(myName())}</strong><br>
      <span class="muted">${photo ? "Change your photo." : "Add your photo."} ${esc(who ?? "They")} see${who ? "s" : ""} it on the big button.</span></div>${CHEVRON}</div></a>`;
}

function viewFamilyName() {
  const current = familyName(state.circle);
  const ideas = [`${myName()}'s Family`, parentWord() && `${parentWord()}'s Helpers`]
    .filter((v, k, all) => v && v !== current && all.indexOf(v) === k);
  return `${header()}
  <a href="#/settings">← Settings</a>
  <h1>Your family's name</h1>
  <form data-form="rename" class="card">
    <div class="field"><label for="familyName">Shown exactly as you type it</label>
      <input id="familyName" name="familyName" value="${esc(current)}" maxlength="40" required></div>
    ${ideas.length ? `<div class="row ideas"><span class="muted">Ideas</span>${ideas.map((v) =>
      `<button type="button" class="secondary small" data-action="name-idea" data-name="${esc(v)}">${esc(v)}</button>`).join("")}</div>` : ""}
    <button type="submit" ${state.busy ? "disabled" : ""}>Save</button>
  </form>
  <p class="muted">Everyone who helps sees the new name. Nothing changes on the phones of the people you help.</p>`;
}

// The name of the first person this helper helps, or null before anyone is linked.
function parentWord() {
  const id = state.circle?.parentIds?.[0];
  return (id && state.circle.members?.[id]?.name) || null;
}

function viewPhoto() {
  const who = parentWord();
  return `${header()}
  <a href="#/settings">← Settings</a>
  <h1>Your photo</h1>
  <p class="muted">${who ? esc(who) : "The person you help"} sees your face on the big button, so they know exactly who they're reaching.</p>
  ${photoPicker()}`;
}

// The big-button preview and the two ways to pick a photo, on the photo page
// and in setup. Saving it is handled by the "change" listener below.
function photoPicker() {
  const photo = myPhoto();
  const who = parentWord();
  return `<div class="card button-preview">
    <p class="eyebrow">On ${who ? `${esc(who)}'s` : "their"} phone</p>
    <div class="mini-button">${faceHtml(myName(), photo, "mini-face")}
      <span class="mini-title">Tap for help</span><span class="mini-from">from ${esc(myName())}</span></div>
  </div>
  <label class="button full${state.busy ? " disabled" : ""}" for="selfie">Take a selfie</label>
  <input class="hidden-file" id="selfie" type="file" accept="image/*" capture="user" data-photo ${state.busy ? "disabled" : ""}>
  <label class="button secondary full${state.busy ? " disabled" : ""}" for="pickPhoto">Choose from photos</label>
  <input class="hidden-file" id="pickPhoto" type="file" accept="image/*" data-photo ${state.busy ? "disabled" : ""}>
  ${photo ? `<button class="text-link" data-action="remove-photo" ${state.busy ? "disabled" : ""}>Use my first letter instead</button>` : ""}
  <p class="muted">Only your family circle can see it. You can change it any time.</p>`;
}

function viewDashboard() {
  const answered = state.scams.filter((s) => s.verdict).slice(0, 5);
  return `${header(`<a class="gear" href="#/settings" aria-label="Settings">${GEAR}</a>`)}
  <div><p class="muted">Your family</p><h1${familyName(state.circle).length > 18 ? ' class="long"' : ""}>${esc(familyName(state.circle))}</h1></div>
  ${alertsBanner()}
  ${helpCards()}
  ${shareCards()}
  ${scamCards()}
  ${memberCards()}
  ${pendingInvites()}
  <a class="button" href="#/add">Add someone</a>
  ${answered.length ? `<h2>Recent scam checks</h2>${answered.map((s) => `
    <a class="card" style="text-decoration:none;color:inherit" href="#/scam/${esc(s.id)}">
      <strong>${esc(s.parentName)}: ${esc(VERDICTS[s.verdict])}</strong>
      <span class="muted">${esc(s.text.slice(0, 80))}</span></a>`).join("")}` : ""}`;
}

// ---------- Settings: everything the helper sets up once, off the Home screen ----------

const GEAR = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const CHEVRON = `<svg class="chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;

function people() {
  const c = state.circle;
  const list = (ids) => (ids ?? []).map((id) => ({ id, ...c?.members?.[id] }));
  return { parents: list(c?.parentIds), helpers: list(c?.helperIds) };
}

function alertsRow() {
  if (state.alertsOn) return `<span class="on-dot">On</span>`;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (ios && !installed) return `<span class="muted">Add to home screen first</span>`;
  return `<button class="small" data-action="alerts" ${state.busy ? "disabled" : ""}>Turn on</button>`;
}

function viewSettings() {
  const { parents, helpers } = people();
  const helperNames = helpers.map((h) => (h.id === state.user.uid ? "You" : h.name)).join(", ");
  return `${header()}
  <a href="#/">← Home</a>
  <h1>Settings</h1>
  ${photoCard()}
  <p class="section-label">Your family</p>
  <div class="group">
    <a class="item" href="#/family"><span class="grow">Family name</span><span class="muted value">${esc(familyName(state.circle))}</span>${CHEVRON}</a>
    ${parents.map((p) => `<a class="item" href="#/person/${esc(p.id)}"><span class="avatar small">${initial(p.name)}</span>
      <span class="grow">${esc(p.name)}<br><span class="muted sub">${esc(personLine(p))}</span></span>${CHEVRON}</a>`).join("")}
    <a class="item" href="#/add"><span class="grow">Add someone</span>${CHEVRON}</a>
    <div class="item"><span class="grow">Helpers</span><span class="muted value">${esc(helperNames)}</span></div>
  </div>
  <p class="section-label">This phone</p>
  <div class="group">
    <div class="item"><span class="grow">Alerts</span>${alertsRow()}</div>
    <div class="item stack"><span>Look</span>
      <div class="choices" role="group" aria-label="Look">${Object.entries(THEMES).map(([key, label]) =>
        `<button type="button" data-action="theme" data-choice="${key}" aria-pressed="${themeChoice === key}">${label}</button>`).join("")}</div></div>
  </div>
  <p class="section-label">Account</p>
  <div class="group">
    <div class="item"><span class="grow">Email</span><span class="muted value">${esc(state.user.email ?? "")}</span></div>
    <button class="item" data-action="signout">Sign out</button>
    <a class="item danger-text" href="#/delete">Delete my account</a>
  </div>
  <p class="muted center">My Tech Kid beta</p>`;
}

function viewPerson(id) {
  const p = people().parents.find((x) => x.id === id);
  if (!p) return `${header()}<a href="#/settings">← Settings</a><p class="muted">They're no longer linked.</p>`;
  return `${header()}
  <a href="#/settings">← Settings</a>
  <div class="row"><span class="avatar big">${initial(p.name)}</span>
    <div class="grow"><h1>${esc(p.name)}</h1><span class="muted">${esc(personLine(p))}</span></div></div>
  <div class="card"><strong>Seeing and tapping</strong>
    ${howToHelp(p)}
    <p class="muted">${isPast(p.controlAllowedAt)
      ? `You can tap for ${esc(p.name)} while they show you their screen.`
      : `For safety, tapping for ${esc(p.name)} unlocks ${esc(formatTime(p.controlAllowedAt))}.`}</p></div>
  ${removeControls(p)}`;
}

// Apple and Google require deleting an account from inside the app. The
// password is asked again so an unlocked phone on a table isn't enough.
function viewDeleteAccount() {
  const { parents, helpers } = people();
  const others = helpers.filter((h) => h.id !== state.user.uid).map((h) => h.name);
  const names = parents.map((p) => p.name).join(" and ");
  const effect = others.length
    ? `<div class="card"><p>Your name, photo and sign-in are erased for good.</p>
        ${names ? `<p>${esc(others.join(" and "))} still help${others.length === 1 ? "s" : ""} ${esc(names)}, so nothing changes on their phone${parents.length > 1 ? "s" : ""}.</p>` : ""}</div>`
    : `<div class="card"><p>Your name, photo and sign-in are erased for good.</p></div>
      <div class="alert red"><strong>You're the only helper</strong>
        <p>${names ? `${esc(names)}'s phone${parents.length > 1 ? "s are" : " is"} unlinked, and the` : "The"} family's help requests, scam checks and voice messages are erased too.</p></div>`;
  return `${header()}
  <a href="#/settings">← Settings</a>
  <h1>Delete my account</h1>
  ${effect}
  <form data-form="delete-account" class="card">
    <div class="field"><label for="deletePassword">Type your password to confirm</label>
      <input id="deletePassword" name="password" type="password" autocomplete="current-password" required></div>
    <button type="submit" class="danger" ${state.busy ? "disabled" : ""}>Delete my account</button>
    <a class="button secondary" href="#/settings">Keep my account</a>
  </form>`;
}

// Who the person being added is to the helper. Their phone sees the matching
// word for the helper ("Josh, your grandchild"); see RELATIONSHIPS in
// functions/pairing.js. "Someone else" shows no word.
const RELATIONSHIPS = {
  parent: "Your parent",
  grandparent: "Your grandparent",
  partner: "Your partner",
  relative: "Another relative",
  friend: "A friend",
  neighbor: "A neighbor",
  other: "Someone else",
};
const relationLabel = (key) => (key && key !== "other" ? RELATIONSHIPS[key] : null);

function viewAdd() {
  return `${header()}
  <a href="#/">← Back</a>
  <h1>Add someone you help</h1>
  <p class="muted">You'll get a link to text them, or a code to scan if you're together. It works once and expires after an hour.</p>
  <form data-form="invite" class="card">
    <fieldset class="field"><legend>Who are they to you?</legend>
      <div class="chips">${Object.entries(RELATIONSHIPS).map(([key, label]) => `
        <label class="chip"><input type="radio" name="relationship" value="${key}" required><span>${label}</span></label>`).join("")}</div>
    </fieldset>
    <div class="field"><label for="forName">What do you call them?</label><input id="forName" name="forName" placeholder="Like Mom, Grandpa or Alex" maxlength="40" required></div>
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
  if (!state.user) {
    const role = storage.get("onb:role");
    if (!role && !storage.get("onb:story")) return "role";
    if (role === "getting-help") return "getting-help";
    return storage.get("onb:story") ? "signin" : `story${state.storyIndex}`;
  }
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
  else if (!state.user) html = signedOutView();
  else if (state.profile === null) html = viewLoading();
  else if (state.profile.circleId && !state.circle) html = viewLoading();
  else if (step && (!state.profile.circleId || (page !== "add" && page !== "invite"))) html = viewSetup(step);
  else if (page === "add") html = viewAdd();
  else if (page === "settings") html = viewSettings();
  else if (page === "person" && id) html = viewPerson(id);
  else if (page === "delete") html = viewDeleteAccount();
  else if (page === "family") html = viewFamilyName();
  else if (page === "photo") html = viewPhoto();
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
    if (el && el.type !== "password" && el.type !== "file") el.value = value;
  }
  if (focused) document.getElementById(focused)?.focus();
}

// Before signing in: who are you, then the helper's story, then the account.
// Anyone who already finished the story is a helper.
function signedOutView() {
  const role = storage.get("onb:role");
  if (!role && !storage.get("onb:story")) return viewRole();
  if (role === "getting-help") return viewGettingHelp();
  return storage.get("onb:story") ? viewSignedOut() : viewStory();
}

window.addEventListener("hashchange", () => { state.error = ""; acceptFromAlert(); render(); window.scrollTo(0, 0); });

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
  "accept-help": (el) => acceptHelp(el.dataset.id),
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
    run(async () => {
      await call("removeMember", { circleId, memberId: el.dataset.id });
      location.hash = "#/settings";
    });
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
  role: (el) => { storage.set("onb:role", el.dataset.role); render(); window.scrollTo(0, 0); },
  "role-back": () => { storage.remove("onb:role"); render(); window.scrollTo(0, 0); },
  "role-signin": () => { storage.set("onb:role", "helper"); storage.set("onb:story", "1"); state.authMode = "signin"; render(); },
  "share-site": async () => {
    const url = location.origin;
    const text = "Can you help me with my phone? I'd like to use My Tech Kid. Start here:";
    if (navigator.share) {
      try { await navigator.share({ text, url }); } catch { /* closed the share sheet */ }
    } else {
      try { await navigator.clipboard.writeText(`${text} ${url}`); state.error = "Copied. Paste it into a text to someone you trust."; } catch {
        state.error = `Send this address to someone you trust: ${url}`;
      }
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
  "name-idea": (el) => { document.getElementById("familyName").value = el.dataset.name; },
  "remove-photo": () => run(() => call("setMyPhoto", { circleId, photo: null })),
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
  rename: (f) => run(async () => {
    await call("renameCircle", { circleId, name: val(f, "familyName") });
    location.hash = "#/settings";
  }),
  "delete-account": (f) => run(async () => {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, val(f, "password")));
    await call("deleteMyAccount", {});
    location.hash = "#/";
    await signOut(auth).catch(() => {});
  }),
  invite: (f) => run(async () => {
    const relationship = f.querySelector("input[name=relationship]:checked")?.value ?? "other";
    const { inviteId, token } = await call("createInvite", { circleId, forName: val(f, "forName").trim(), relationship });
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

// "Take a selfie" / "Choose from photos": shrink it here, then save it.
root.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-photo]");
  const file = input?.files?.[0];
  if (!file) return;
  run(async () => {
    await call("setMyPhoto", { circleId, photo: await shrinkPhoto(file) });
    if (location.hash.startsWith("#/photo")) location.hash = "#/settings";
  });
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
