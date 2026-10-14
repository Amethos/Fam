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
