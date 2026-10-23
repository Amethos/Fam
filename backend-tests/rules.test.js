// Checks firestore.rules against the local Firestore emulator: npm test
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, arrayUnion } from "firebase/firestore";

let env;
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-fam",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "circles/c1"), {
      name: "Smiths", helperIds: ["josh"], parentIds: ["mom"],
      members: { josh: { name: "Josh", role: "helper" }, mom: { name: "Mom", role: "parent" } },
    });
    await setDoc(doc(d, "users/mom"), { displayName: "Mom", role: "parent", circleId: "c1" });
    await setDoc(doc(d, "circles/c1/invites/i1"), { createdBy: "josh", status: "claimed", claimedBy: "newphone" });
    await setDoc(doc(d, "circles/c1/helpRequests/h1"), { parentId: "mom", parentName: "Mom", status: "waiting" });
    await setDoc(doc(d, "circles/c1/scamChecks/s1"), { parentId: "mom", parentName: "Mom", text: "pay $1.99", verdict: null });
  });
});

const helpRequest = (parentId, status = "waiting") => ({ parentId, parentName: "Mom", status, createdAt: serverTimestamp() });
const scam = (extra = {}) => ({ parentId: "mom", parentName: "Mom", text: "Pay now", createdAt: serverTimestamp(), verdict: null, ...extra });
const answer = (uid, extra = {}) => ({ verdict: "scam", note: "Delete it", answeredBy: uid, answeredByName: "Josh", answeredAt: serverTimestamp(), ...extra });

test("only circle members can read the circle", async () => {
  await assertSucceeds(getDoc(doc(db("josh"), "circles/c1")));
  await assertSucceeds(getDoc(doc(db("mom"), "circles/c1")));
  await assertFails(getDoc(doc(db("stranger"), "circles/c1")));
  await assertFails(getDoc(doc(db(null), "circles/c1")));
});

test("nobody can change circle membership from an app", async () => {
  await assertFails(updateDoc(doc(db("josh"), "circles/c1"), { helperIds: arrayUnion("stranger") }));
  await assertFails(updateDoc(doc(db("mom"), "circles/c1"), { helperIds: arrayUnion("stranger") }));
  await assertFails(setDoc(doc(db("stranger"), "circles/c2"), { helperIds: ["stranger"], parentIds: [] }));
});

test("users can only set their name, alert tokens and platform", async () => {
  await assertSucceeds(setDoc(doc(db("mom"), "users/mom"), { fcmTokens: arrayUnion("t1"), platform: "android" }, { merge: true }));
  await assertFails(updateDoc(doc(db("mom"), "users/mom"), { circleId: "evil" }));
  await assertFails(setDoc(doc(db("stranger"), "users/stranger"), { displayName: "X", circleId: "c1" }));
  await assertFails(getDoc(doc(db("stranger"), "users/mom")));
  const tooMany = Array.from({ length: 11 }, (_, i) => `t${i}`);
  await assertFails(setDoc(doc(db("mom"), "users/mom"), { fcmTokens: tooMany }, { merge: true }));
  await assertFails(setDoc(doc(db("mom"), "users/mom"), { displayName: "x".repeat(61) }, { merge: true }));
  await assertSucceeds(setDoc(doc(db("josh"), "users/josh"), { platform: "web" }, { merge: true }));
  await assertFails(setDoc(doc(db("mom"), "users/mom"), { platform: "x".repeat(5000) }, { merge: true }));
});

test("a phone can say what kind of phone it is, and nothing else rides along", async () => {
  const set = (device) => setDoc(doc(db("mom"), "users/mom"), { device }, { merge: true });
  await assertSucceeds(set({ platform: "android", model: "Samsung SM-S911U", osVersion: 14 }));
  await assertSucceeds(set({ platform: "ios", osVersion: 18 }));
  await assertSucceeds(setDoc(doc(db("newhelper"), "users/newhelper"), { device: { platform: "computer" } }));
  // A brand-new phone, so nothing already saved fills in the gaps.
  const fresh = (device) => setDoc(doc(db("fresh"), "users/fresh"), { device });
  await assertFails(fresh({ platform: "toaster" }));
  await assertFails(fresh({ model: "No platform" }));
  await assertFails(fresh({ platform: "android", circleId: "c2" }));
  await assertFails(fresh({ platform: "android", model: "x".repeat(61) }));
  await assertFails(fresh({ platform: "android", osVersion: "14" }));
  await assertFails(fresh("android"));
  await assertFails(set({ platform: "toaster" }));
  await assertFails(setDoc(doc(db("stranger"), "users/mom"), { device: { platform: "android" } }, { merge: true }));
});

test("invites are readable only by helpers and the phone that claimed them", async () => {
  await assertSucceeds(getDoc(doc(db("josh"), "circles/c1/invites/i1")));
  await assertSucceeds(getDoc(doc(db("newphone"), "circles/c1/invites/i1")));
  await assertFails(getDoc(doc(db("stranger"), "circles/c1/invites/i1")));
});

test("only the parent can ask for help, for themselves", async () => {
  await assertSucceeds(addDoc(collection(db("mom"), "circles/c1/helpRequests"), helpRequest("mom")));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/helpRequests"), helpRequest("mom", "accepted")));
  await assertFails(addDoc(collection(db("josh"), "circles/c1/helpRequests"), helpRequest("josh")));
  await assertFails(addDoc(collection(db("stranger"), "circles/c1/helpRequests"), helpRequest("stranger")));
});

test("a practice help request is marked with a true/false flag only", async () => {
  await assertSucceeds(addDoc(collection(db("mom"), "circles/c1/helpRequests"), { ...helpRequest("mom"), practice: true }));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/helpRequests"), { ...helpRequest("mom"), practice: "yes" }));
  await assertFails(addDoc(collection(db("josh"), "circles/c1/helpRequests"), { ...helpRequest("josh"), practice: true }));
});

test("helpers accept help; the parent can cancel", async () => {
  await assertFails(updateDoc(doc(db("stranger"), "circles/c1/helpRequests/h1"), { status: "accepted", helperId: "stranger", helperName: "X" }));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "accepted", helperId: "someoneelse", helperName: "X" }));
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "accepted", helperId: "josh", helperName: "Josh", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db("mom"), "circles/c1/helpRequests/h1"), { status: "done", updatedAt: serverTimestamp() }));
});

test("a finished or cancelled help request can't be reopened", async () => {
  const accept = (uid) => ({ status: "accepted", helperId: uid, helperName: "Josh", updatedAt: serverTimestamp() });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "circles/c1/helpRequests/done1"), { parentId: "mom", parentName: "Mom", status: "done" });
    await setDoc(doc(ctx.firestore(), "circles/c1/helpRequests/gone1"), { parentId: "mom", parentName: "Mom", status: "cancelled" });
  });
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/done1"), accept("josh")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/gone1"), accept("josh")));
  await assertFails(updateDoc(doc(db("mom"), "circles/c1/helpRequests/gone1"), { status: "done", updatedAt: serverTimestamp() }));
  // Once accepted, it can only be finished, not taken again.
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), accept("josh")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), accept("josh")));
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "done", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "accepted", updatedAt: serverTimestamp() }));
});

test("a helper's name on a help request must be a short name", async () => {
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "accepted", helperId: "josh", helperName: "x".repeat(61) }));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/helpRequests/h1"), { status: "accepted", helperId: "josh", helperName: 42 }));
});

test("only the parent sends scam checks, unanswered", async () => {
  await assertSucceeds(addDoc(collection(db("mom"), "circles/c1/scamChecks"), scam()));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/scamChecks"), scam({ verdict: "safe" })));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/scamChecks"), scam({ text: "" })));
  await assertFails(addDoc(collection(db("josh"), "circles/c1/scamChecks"), scam({ parentId: "josh" })));
});

test("only a helper answers a scam check, once", async () => {
  await assertFails(updateDoc(doc(db("mom"), "circles/c1/scamChecks/s1"), answer("mom", { verdict: "safe" })));
  await assertFails(updateDoc(doc(db("stranger"), "circles/c1/scamChecks/s1"), answer("stranger", { verdict: "safe" })));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/scamChecks/s1"), answer("josh", { verdict: "maybe" })));
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/scamChecks/s1"), answer("josh")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/scamChecks/s1"), answer("josh", { verdict: "safe" })));
});

// These names go into alerts and onto the helper's screen.
test("names on help requests and scam checks must be short names", async () => {
  await assertFails(addDoc(collection(db("mom"), "circles/c1/helpRequests"), { ...helpRequest("mom"), parentName: "x".repeat(61) }));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/helpRequests"), { ...helpRequest("mom"), parentName: 42 }));
  const { parentName, ...noName } = helpRequest("mom");
  await assertFails(addDoc(collection(db("mom"), "circles/c1/helpRequests"), noName));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/scamChecks"), scam({ parentName: "x".repeat(61) })));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/scamChecks"), scam({ parentName: "" })));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/scamChecks/s1"), answer("josh", { answeredByName: "x".repeat(61) })));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/scamChecks/s1"), answer("josh", { answeredByName: null })));
});

// ---- Screen sharing (stage 2) ----

const share = (extra = {}) => ({ parentId: "mom", parentName: "Mom", status: "waiting", createdAt: serverTimestamp(), ...extra });
const join = (uid, extra = {}) => ({ status: "live", helperId: uid, helperName: "Josh", startedAt: serverTimestamp(), ...extra });
const end = (uid) => ({ status: "ended", endedBy: uid, endedAt: serverTimestamp() });
const signal = (uid, extra = {}) => ({ from: uid, type: "offer", payload: "v=0", createdAt: serverTimestamp(), ...extra });

async function seedShare(id, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `circles/c1/screenShares/${id}`), data));
}

test("only the parent's own phone can start sharing its screen", async () => {
  await assertSucceeds(addDoc(collection(db("mom"), "circles/c1/screenShares"), share()));
  await assertFails(addDoc(collection(db("josh"), "circles/c1/screenShares"), share({ parentId: "josh" })));
  await assertFails(addDoc(collection(db("josh"), "circles/c1/screenShares"), share()));
  await assertFails(addDoc(collection(db("stranger"), "circles/c1/screenShares"), share({ parentId: "stranger" })));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/screenShares"), share({ status: "live" })));
  await assertFails(addDoc(collection(db("mom"), "circles/c1/screenShares"), share({ helperId: "josh" })));
});

test("one helper joins a fresh share; strangers and stale shares are refused", async () => {
  const { Timestamp } = await import("firebase/firestore");
  await seedShare("fresh", { parentId: "mom", parentName: "Mom", status: "waiting", createdAt: Timestamp.now() });
  await seedShare("stale", { parentId: "mom", parentName: "Mom", status: "waiting", createdAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000) });
  await assertFails(updateDoc(doc(db("stranger"), "circles/c1/screenShares/fresh"), join("stranger")));
  await assertFails(updateDoc(doc(db("mom"), "circles/c1/screenShares/fresh"), join("mom")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/screenShares/fresh"), join("someoneelse")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/screenShares/stale"), join("josh")));
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/screenShares/fresh"), join("josh")));
  await assertFails(updateDoc(doc(db("josh"), "circles/c1/screenShares/fresh"), join("josh")));
});

test("the parent or the joined helper can end a share, and it stays ended", async () => {
  const { Timestamp } = await import("firebase/firestore");
  const live = { parentId: "mom", parentName: "Mom", status: "live", helperId: "josh", helperName: "Josh", createdAt: Timestamp.now() };
  await seedShare("a", live);
  await seedShare("b", live);
  await assertFails(updateDoc(doc(db("stranger"), "circles/c1/screenShares/a"), end("stranger")));
  await assertFails(updateDoc(doc(db("mom"), "circles/c1/screenShares/a"), end("josh")));
  await assertSucceeds(updateDoc(doc(db("mom"), "circles/c1/screenShares/a"), end("mom")));
  await assertFails(updateDoc(doc(db("mom"), "circles/c1/screenShares/a"), { status: "live" }));
  await assertSucceeds(updateDoc(doc(db("josh"), "circles/c1/screenShares/b"), end("josh")));
  await assertSucceeds(getDoc(doc(db("josh"), "circles/c1/screenShares/a")));
  await assertFails(getDoc(doc(db("stranger"), "circles/c1/screenShares/a")));
});

test("the joined helper saves a share's smoothness numbers once, and nothing else", async () => {
  const { Timestamp } = await import("firebase/firestore");
  const quality = (extra = {}) => ({ quality: { seconds: 60, relay: true, rttMs: 82, fps: 20, height: 1170, kbps: 1000, lossPct: 1, freezes: 2, codec: "H264", ...extra } });
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "circles/c1"), {
    name: "Smiths", helperIds: ["josh", "amy"], parentIds: ["mom"],
    members: { josh: { name: "Josh", role: "helper" }, amy: { name: "Amy", role: "helper" }, mom: { name: "Mom", role: "parent" } },
  }));
  const base = { parentId: "mom", parentName: "Mom", helperId: "josh", helperName: "Josh", createdAt: Timestamp.now() };
  await seedShare("q-live", { ...base, status: "live" });
  await seedShare("q-ended", { ...base, status: "ended" });
  await seedShare("q-waiting", { parentId: "mom", parentName: "Mom", status: "waiting", createdAt: Timestamp.now() });
  const ref = (uid, id) => doc(db(uid), `circles/c1/screenShares/${id}`);
  // Only the helper who watched, only numbers.
  await assertFails(updateDoc(ref("mom", "q-live"), quality()));
  await assertFails(updateDoc(ref("amy", "q-live"), quality()));
  await assertFails(updateDoc(ref("josh", "q-waiting"), quality()));
  await assertFails(updateDoc(ref("josh", "q-live"), quality({ codec: "x".repeat(21) })));
  await assertFails(updateDoc(ref("josh", "q-live"), quality({ screen: "her bank balance" })));
  await assertFails(updateDoc(ref("josh", "q-live"), quality({ fps: "fast" })));
  await assertFails(updateDoc(ref("josh", "q-live"), { ...quality(), status: "waiting" }));
  await assertSucceeds(updateDoc(ref("josh", "q-live"), quality()));
  await assertSucceeds(updateDoc(ref("josh", "q-ended"), quality()));
  // Once only.
  await assertFails(updateDoc(ref("josh", "q-ended"), quality({ fps: 30 })));
});

test("connection messages flow only between the two people on a live share", async () => {
  const { Timestamp } = await import("firebase/firestore");
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "circles/c1"), {
      name: "Smiths", helperIds: ["josh", "amy"], parentIds: ["mom"],
      members: { josh: { name: "Josh", role: "helper" }, amy: { name: "Amy", role: "helper" }, mom: { name: "Mom", role: "parent" } },
    });
  });
  await seedShare("live", { parentId: "mom", parentName: "Mom", status: "live", helperId: "josh", helperName: "Josh", createdAt: Timestamp.now() });
  await seedShare("waiting", { parentId: "mom", parentName: "Mom", status: "waiting", createdAt: Timestamp.now() });
  await seedShare("over", { parentId: "mom", parentName: "Mom", status: "ended", helperId: "josh", helperName: "Josh", createdAt: Timestamp.now() });
  const signals = (uid, id) => collection(db(uid), `circles/c1/screenShares/${id}/signals`);
  await assertSucceeds(addDoc(signals("mom", "live"), signal("mom")));
  await assertSucceeds(addDoc(signals("josh", "live"), signal("josh", { type: "answer" })));
  // The helper's page says hello when it (re)joins, so Mom's phone reconnects.
  await assertSucceeds(addDoc(signals("josh", "live"), signal("josh", { type: "hello" })));
  // Another helper in the family can't listen in.
  await assertFails(addDoc(signals("amy", "live"), signal("amy")));
  await assertFails(addDoc(signals("stranger", "live"), signal("stranger")));
  // Nobody can pretend to be Mom.
  await assertFails(addDoc(signals("josh", "live"), signal("mom")));
  await assertFails(addDoc(signals("mom", "live"), signal("mom", { type: "control" })));
  await assertFails(addDoc(signals("mom", "waiting"), signal("mom")));
  await assertFails(addDoc(signals("mom", "over"), signal("mom")));
  await assertSucceeds(getDoc(doc(db("josh"), "circles/c1/screenShares/live/signals/x")));
  await assertFails(getDoc(doc(db("amy"), "circles/c1/screenShares/live/signals/x")));
});

test("only a helper can ring a parent's phone, in their own name", async () => {
  const ring = (uid, extra = {}) => addDoc(collection(db(uid), "circles/c1/rings"),
    { parentId: "mom", helperId: uid, helperName: "Josh", createdAt: serverTimestamp(), ...extra });
  await assertSucceeds(ring("josh"));
  await assertFails(ring("mom"));
  await assertFails(ring("stranger"));
  await assertFails(ring("josh", { parentId: "someone-else" }));
  await assertFails(ring("josh", { helperId: "mom" }));
  await assertFails(ring("josh", { loud: "forever" }));
  await assertFails(ring("josh", { helperName: "x".repeat(61) }));
});
