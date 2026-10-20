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
  setDoc, updateDoc, serverTimestamp, arrayUnion,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getStorage, connectStorageEmulator, ref as storageRef, getBlob } from "firebase/storage";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseConfig, vapidKey, isConfigured } from "./config.js";
import { esc, initial, timeAgo, formatTime, isPast, storage } from "./util.js";

const root = document.getElementById("app");

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
  ? { apiKey: "demo", projectId: "demo-fam", authDomain: "demo-fam.firebaseapp.com", storageBucket: "demo-fam.appspot.com" }
  : firebaseConfig);
// Email + password only. initializeAuth (instead of getAuth) skips loading
// Google's sign-in pop-up code, so the page runs only our own scripts.
const auth = initializeAuth(fbApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getFirestore(fbApp);
const functions = getFunctions(fbApp);
const files = getStorage(fbApp);
if (useEmulators) {
  connectStorageEmulator(files, "127.0.0.1", 9199);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

const state = {
  user: undefined, // undefined = still loading, null = signed out
  profile: null,
  circle: null,
  help: [],
  scams: [],
  invites: [],
  phoneSettings: {}, // per parent phone: what the helper switched on (see PHONE_DEFAULTS)
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
  circleId = null;
  Object.assign(state, { user, profile: null, circle: null, help: [], scams: [], invites: [], phoneSettings: {} });
  if (user) {
    userUnsubs.push(onSnapshot(doc(db, "users", user.uid), (snap) => {
      state.profile = snap.data() ?? {};
      watchCircle(state.profile.circleId ?? null);
      render();
    }));
    if (state.alertsOn) enableAlerts({ quiet: true });
  }
  render();
});

function watchCircle(id) {
  if (id === circleId) return;
  clear(circleUnsubs);
  circleId = id;
  if (!id) {
    // Unlinked (or removed from the family): forget what we were showing.
    Object.assign(state, { circle: null, help: [], scams: [], invites: [], phoneSettings: {} });
    return;
  }
  const base = `circles/${id}`;
  const fail = (err) => { state.error = err.message; render(); };
  circleUnsubs.push(
    onSnapshot(doc(db, base), (s) => { state.circle = s.data() ?? null; render(); }, fail),
    onSnapshot(query(collection(db, base, "helpRequests"), where("status", "in", ["waiting", "accepted"])),
      (s) => { state.help = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail),
    onSnapshot(query(collection(db, base, "scamChecks"), orderBy("createdAt", "desc"), limit(20)),
      (s) => { state.scams = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail),
    onSnapshot(query(collection(db, base, "invites"), orderBy("createdAt", "desc"), limit(10)),
      (s) => { state.invites = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail),
    onSnapshot(collection(db, base, "phoneSettings"),
      (s) => { state.phoneSettings = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); render(); }, fail),
  );
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
        <button data-action="accept-help" data-id="${esc(h.id)}">I'm on it</button></div>`;
    }
    if (h.helperId === uid) {
      return `<div class="alert blue"><h2>You're helping ${esc(h.parentName)}</h2>
        <p>Give them a call now. Seeing their screen arrives in the next My Tech Kid update.</p>
        <button class="good" data-action="done-help" data-id="${esc(h.id)}">All fixed</button></div>`;
    }
    return `<div class="alert blue"><p><strong>${esc(h.helperName)}</strong> is helping ${esc(h.parentName)}.</p></div>`;
  }).join("");
}

// ---------- Pictures of the parent's screen ----------
// Loaded only for the family (storage.rules), kept in memory as blob: URLs.
const pictures = new Map(); // scam check id -> blob URL, "loading" or "gone"

function pictureFor(s) {
  if (!s.imagePath) return null;
  if (!pictures.has(s.id)) {
    pictures.set(s.id, "loading");
    getBlob(storageRef(files, s.imagePath))
      .then((blob) => pictures.set(s.id, URL.createObjectURL(blob)))
      .catch(() => pictures.set(s.id, "gone")) // deleted after 30 days, or not allowed
      .finally(render);
  }
  return pictures.get(s.id);
}

function pictureHtml(s, { big = false } = {}) {
  const url = pictureFor(s);
  if (url === "loading") return `<div class="shot loading" aria-label="Loading the picture"></div>`;
  if (url === "gone") return `<p class="muted">The picture of the screen was removed after 30 days.</p>`;
  const img = `<img src="${esc(url)}" alt="${esc(s.parentName)}'s screen">`;
  return big
    ? `<button type="button" class="shot${state.zoomed ? " zoomed" : ""}" data-action="zoom" aria-label="${state.zoomed ? "Fit to screen" : "Zoom in"}">${img}</button>`
    : `<div class="shot thumb">${img}</div>`;
}

function scamSummary(s, max) {
  if (!s.text) return s.imagePath ? "Sent a picture of their screen" : "";
  return s.text.length > max ? `${s.text.slice(0, max)}…` : s.text;
}

function scamCards() {
  return state.scams.filter((s) => !s.verdict).map((s) => `
    <div ${popAttrs(s.id, "card")}><p class="eyebrow">Scam check</p><h2>${esc(s.parentName)} asks: is this a scam?</h2>
      ${s.imagePath ? pictureHtml(s) : ""}
      ${s.text ? `<p class="quote">${esc(scamSummary(s, 160))}</p>` : ""}
      <a class="button secondary" href="#/scam/${esc(s.id)}">Review and answer</a></div>`).join("");
}

// ---------- What's on a parent's phone (the parent's app has no settings) ----------
const PHONE_DEFAULTS = { askTab: false, askTabSide: "right", blurSecrets: true };
const openSettings = new Set(); // stays open across live updates

function phoneSettingsHtml(p) {
  const set = { ...PHONE_DEFAULTS, ...state.phoneSettings[p.id] };
  const name = esc(p.name);
  const choice = (key, value, label) =>
    `<button type="button" data-action="phone-setting" data-id="${esc(p.id)}" data-key="${key}" data-value="${value}"
      aria-pressed="${String(set[key]) === value}" ${state.busy ? "disabled" : ""}>${label}</button>`;
  return `<details class="phone-settings" data-phone="${esc(p.id)}" ${openSettings.has(p.id) ? "open" : ""}><summary>On ${name}'s phone</summary>
    <div class="setting"><div class="grow"><strong>Ask button at the edge of the screen</strong>
      <p class="muted">${name} taps it to send you a picture of their screen when something looks like a scam.</p></div>
      <div class="choices" role="group" aria-label="Ask button">${choice("askTab", "true", "On")}${choice("askTab", "false", "Off")}</div></div>
    ${set.askTab ? `<div class="setting"><div class="grow"><strong>Which side</strong></div>
      <div class="choices" role="group" aria-label="Which side">${choice("askTabSide", "left", "Left")}${choice("askTabSide", "right", "Right")}</div></div>
      <p class="muted">The first time, ${name}'s phone shows a card to set it up. Do it together on a call: they tap
        <strong>See what it does</strong>, then <strong>I agree, turn it on</strong>, then turn on My Tech Kid.
        On Samsung, if the switch is grey, they tap <strong>The switch is grey</strong>, then the three dots, then
        <strong>Allow restricted settings</strong>. Needs Android 11 or newer.</p>` : ""}
    <div class="setting"><div class="grow"><strong>Always hide passwords and codes</strong>
      <p class="muted">Covers password boxes, one-time codes and card numbers before a picture leaves ${name}'s phone.</p></div>
      <div class="choices" role="group" aria-label="Hide passwords and codes">${choice("blurSecrets", "true", "On")}${choice("blurSecrets", "false", "Off")}</div></div>
  </details>`;
}

function memberCards() {
  const c = state.circle;
  if (!c) return "";
  const parents = (c.parentIds ?? []).map((id) => ({ id, ...c.members?.[id] }));
  const helpers = (c.helperIds ?? []).map((id) => ({ id, ...c.members?.[id] }));
  const parentHtml = parents.length
    ? parents.map((p) => `<div class="card"><div class="row"><span class="avatar">${initial(p.name)}</span>
        <div class="grow"><strong>${esc(p.name)}</strong><br><span class="muted">Linked ${esc(timeAgo(p.linkedAt))}</span></div></div>
        <p class="muted">${isPast(p.controlAllowedAt)
          ? "Safety wait is over — remote control can be used once it arrives in a My Tech Kid update."
          : `For safety, remote control unlocks ${esc(formatTime(p.controlAllowedAt))}.`}</p>
        ${phoneSettingsHtml(p)}
        <button class="secondary small" data-action="remove-member" data-id="${esc(p.id)}" data-name="${esc(p.name)}"
          ${state.busy ? "disabled" : ""}>Remove this phone</button></div>`).join("")
    : `<div class="card"><p>No one is linked yet. Add Mom or Dad to get started.</p></div>`;
  const helperNames = helpers.map((h) => (h.id === state.user.uid ? "You" : esc(h.name))).join(", ");
  return `${parentHtml}<p class="muted">Helpers: ${helperNames}</p>`;
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
  ${scamCards()}
  ${memberCards()}
  ${pendingInvites()}
  <a class="button" href="#/add">Add Mom or Dad</a>
  ${answered.length ? `<h2>Recent scam checks</h2>${answered.map((s) => `
    <a class="card" style="text-decoration:none;color:inherit" href="#/scam/${esc(s.id)}">
      <strong>${esc(s.parentName)}: ${esc(VERDICTS[s.verdict])}</strong>
      <span class="muted">${esc(scamSummary(s, 80))}</span></a>`).join("")}` : ""}
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
  <p class="muted">You'll get a link to text them. It works once and expires after an hour.</p>
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
    body = url
      ? `<h1>Text this link to ${name}</h1>
        <p class="muted">Send it from your own phone number so ${name} knows it's you. Then stay on this screen.</p>
        <div class="card"><p class="link-box">${esc(url)}</p>
          <button data-action="share" data-url="${esc(url)}" data-name="${name}">Share link</button>
          <button class="secondary" data-action="copy" data-url="${esc(url)}">Copy link</button></div>
        <div class="alert blue"><p>Waiting for ${name} to open it… When they do, you'll both see three pictures. Call ${name} to check they match.</p></div>`
      : `<div class="card"><h1>Open this on the phone that made it</h1><p>The link for this invite was made on another device. You can also make a new one.</p>
        <a class="button" href="#/add">Make a new invite</a></div>`;
  } else if (invite.status === "claimed" && !invite.helperConfirmed) {
    body = `<h1>Call ${name} now</h1>
      <p>Ask: <strong>"Which three pictures do you see?"</strong> They should be:</p>
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
    <p class="muted">Sent ${esc(timeAgo(s.createdAt))}</p>
    ${s.imagePath ? `${pictureHtml(s, { big: true })}<p class="muted">Tap the picture to zoom.</p>` : ""}
    ${s.text ? `<p class="quote">${esc(s.text)}</p>` : ""}`;
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

window.addEventListener("hashchange", () => { state.error = ""; state.zoomed = false; render(); window.scrollTo(0, 0); });

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
  mode: (el) => { state.authMode = el.dataset.mode; state.error = ""; render(); },
  signout: () => run(() => signOut(auth)),
  reset: () => run(async () => {
    const email = document.getElementById("email")?.value.trim();
    if (!email) throw new Error("Type your email first, then tap Forgot password.");
    await sendPasswordResetEmail(auth, email);
    state.error = "Check your email for a link to reset your password.";
  }),
  alerts: () => run(() => enableAlerts()),
  "accept-help": (el) => run(() => updateDoc(doc(db, `circles/${circleId}/helpRequests/${el.dataset.id}`), {
    status: "accepted", helperId: state.user.uid, helperName: myName(), updatedAt: serverTimestamp(),
  })),
  "remove-member": (el) => {
    const name = el.dataset.name || "this person";
    if (!confirm(`Remove ${name}'s phone from your family?\n\nUse this if the phone was lost, replaced or given away. ${name} won't be able to reach you from it until you send a new invite.`)) return;
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
  zoom: () => { state.zoomed = !state.zoomed; render(); },
  "phone-setting": (el) => run(() => {
    const id = el.dataset.id;
    const value = el.dataset.key === "askTabSide" ? el.dataset.value : el.dataset.value === "true";
    return setDoc(doc(db, `circles/${circleId}/phoneSettings/${id}`), {
      ...PHONE_DEFAULTS, ...state.phoneSettings[id], [el.dataset.key]: value, updatedBy: state.user.uid, updatedAt: serverTimestamp(),
    });
  }),
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

root.addEventListener("toggle", (event) => {
  const id = event.target.dataset?.phone;
  if (!id) return;
  if (event.target.open) openSettings.add(id); else openSettings.delete(id);
}, true);

root.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (form && forms[form.dataset.form]) {
    event.preventDefault();
    forms[form.dataset.form](form);
  }
});

render();
