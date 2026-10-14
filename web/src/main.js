// My Tech Kid helper app (the person giving help). Runs in the browser and can be
// added to an iPhone home screen. Mom's side is the Android app in android/.

import "./styles.css";
import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy, limit, onSnapshot,
  setDoc, updateDoc, serverTimestamp, arrayUnion,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseConfig, vapidKey, isConfigured } from "./config.js";
import { esc, initial, timeAgo, formatTime, isPast, storage } from "./util.js";

const root = document.getElementById("app");

const LOGO = `<svg width="30" height="30" viewBox="0 0 34 34" fill="none" aria-hidden="true"><circle cx="11" cy="17" r="8" stroke="#1D5BD6" stroke-width="3"/><circle cx="23" cy="17" r="8" stroke="#F08A3C" stroke-width="3"/></svg>`;

// `VITE_EMULATORS=1 npm run dev` talks to local Firebase emulators instead (for testing).
const useEmulators = import.meta.env.VITE_EMULATORS === "1";

if (!isConfigured && !useEmulators) {
  root.innerHTML = `<div class="brand">${LOGO} My Tech Kid</div>
    <div class="card"><h1>Almost there</h1>
    <p>My Tech Kid isn't connected to Firebase yet. Fill in <code>web/src/config.js</code> — see <code>docs/SETUP.md</code>.</p></div>`;
  throw new Error("My Tech Kid: web/src/config.js is not filled in yet");
}

const fbApp = initializeApp(useEmulators
  ? { apiKey: "demo", projectId: "demo-fam", authDomain: "demo-fam.firebaseapp.com" }
  : firebaseConfig);
const auth = getAuth(fbApp);
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
  circle: null,
  help: [],
  scams: [],
  invites: [],
  authMode: "signin",
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
  Object.assign(state, { user, profile: null, circle: null, help: [], scams: [], invites: [] });
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
  if (!id) return;
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
  return `<div class="row"><div class="brand grow">${LOGO} My Tech Kid</div>
    ${state.user ? `<button class="secondary" data-action="signout">Sign out</button>` : ""}</div>
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

function viewNoCircle() {
  return `${header()}
  <h1>Hi ${esc(myName())}! Let's set up your family</h1>
  <p class="muted">Your family circle holds the people you help (like Mom and Dad) and anyone who helps with you.</p>
  <form data-form="circle" class="card">
    <div class="field"><label for="circleName">Family name</label><input id="circleName" name="circleName" placeholder="Smith Family" required></div>
    <button type="submit" ${state.busy ? "disabled" : ""}>Create family circle</button>
  </form>`;
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
    if (h.status === "waiting") {
      return `<div class="alert red"><h2>${esc(h.parentName)} needs help</h2>
        <p>Asked ${esc(timeAgo(h.createdAt))}.</p>
        <button class="danger" data-action="accept-help" data-id="${esc(h.id)}">I'm on it</button></div>`;
    }
    if (h.helperId === uid) {
      return `<div class="alert blue"><h2>You're helping ${esc(h.parentName)}</h2>
        <p>Give them a call now. Seeing their screen arrives in the next My Tech Kid update.</p>
        <button class="good" data-action="done-help" data-id="${esc(h.id)}">All fixed</button></div>`;
    }
    return `<div class="alert blue"><p><strong>${esc(h.helperName)}</strong> is helping ${esc(h.parentName)}.</p></div>`;
  }).join("");
}

function scamCards() {
  return state.scams.filter((s) => !s.verdict).map((s) => `
    <div class="alert orange"><h2>${esc(s.parentName)} asks: is this a scam?</h2>
      <p class="quote">${esc(s.text.slice(0, 160))}${s.text.length > 160 ? "…" : ""}</p>
      <a class="button" href="#/scam/${esc(s.id)}">Answer</a></div>`).join("");
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
          : `For safety, remote control unlocks ${esc(formatTime(p.controlAllowedAt))}.`}</p></div>`).join("")
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
  <h1>${esc(familyTitle(state.circle?.name))}</h1>
  ${alertsBanner()}
  ${helpCards()}
  ${scamCards()}
  ${memberCards()}
  ${pendingInvites()}
  <a class="button" href="#/add">Add Mom or Dad</a>
  ${answered.length ? `<h2>Recent scam checks</h2>${answered.map((s) => `
    <a class="card" style="text-decoration:none;color:inherit" href="#/scam/${esc(s.id)}">
      <strong>${esc(s.parentName)}: ${esc(VERDICTS[s.verdict])}</strong>
      <span class="muted">${esc(s.text.slice(0, 80))}</span></a>`).join("")}` : ""}`;
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
    body = `<div class="alert green"><h1>${name} is linked!</h1>
      <p>${name}'s phone now has a big button that reaches you.</p></div><a class="button" href="#/">Done</a>`;
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

function render() {
  // Keep whatever the person is typing when live updates re-render the page.
  const kept = [...root.querySelectorAll("input[id], textarea[id]")].map((el) => [el.id, el.value]);
  const focused = document.activeElement?.id;

  const [, page, id] = (location.hash || "#/").split("/");
  let html;
  if (state.user === undefined) html = viewLoading();
  else if (!state.user) html = viewSignedOut();
  else if (state.profile === null) html = viewLoading();
  else if (!state.profile.circleId) html = viewNoCircle();
  else if (page === "add") html = viewAdd();
  else if (page === "invite" && id) html = viewInvite(id);
  else if (page === "scam" && id) html = viewScam(id);
  else html = viewDashboard();
  root.innerHTML = html;

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
