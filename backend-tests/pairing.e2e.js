// End-to-end pairing against the local emulators: npm run e2e
import assert from "node:assert";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

function client(name) {
  const app = initializeApp({ apiKey: "demo", projectId: "demo-fam", authDomain: "demo-fam.firebaseapp.com" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const call = (fn, data) => httpsCallable(fns, fn)(data).then((r) => r.data);
  return { auth, db, call };
}

async function rejects(promise, text) {
  await assert.rejects(promise, (err) => { assert.match(err.message, text); return true; });
}

const josh = client("josh");
await createUserWithEmailAndPassword(josh.auth, `josh${Date.now()}@example.com`, "password123");
const { circleId } = await josh.call("createCircle", { circleName: "Smiths", displayName: "Josh" });
const { inviteId, token } = await josh.call("createInvite", { circleId, forName: "Mom" });

const mom = client("mom");
await signInAnonymously(mom.auth);
await rejects(mom.call("peekInvite", { circleId, inviteId, token: "wrong" }), /isn't valid/);
const peek = await mom.call("peekInvite", { circleId, inviteId, token });
assert.equal(peek.helperName, "Josh");
const claim = await mom.call("claimInvite", { circleId, inviteId, token });
assert.equal(claim.pictures.length, 3);

const thief = client("thief");
await signInAnonymously(thief.auth);
await rejects(thief.call("claimInvite", { circleId, inviteId, token }), /already used/);
await rejects(thief.call("confirmInvite", { circleId, inviteId, match: true }), /Not your invite/);

const invite = (await getDoc(doc(josh.db, `circles/${circleId}/invites/${inviteId}`))).data();
assert.deepEqual(invite.pictures, claim.pictures, "both phones see the same pictures");

assert.equal((await mom.call("confirmInvite", { circleId, inviteId, match: true })).status, "waiting");
assert.equal((await josh.call("confirmInvite", { circleId, inviteId, match: true })).status, "linked");

const circle = (await getDoc(doc(mom.db, `circles/${circleId}`))).data();
assert.deepEqual(circle.parentIds, [mom.auth.currentUser.uid]);
assert.equal(circle.members[mom.auth.currentUser.uid].name, "Mom");
assert.ok(circle.members[mom.auth.currentUser.uid].controlAllowedAt.toMillis() > Date.now() + 23 * 3600 * 1000);

// A linked phone can't be pulled into another family by a new invite.
const scammer = client("scammer");
await createUserWithEmailAndPassword(scammer.auth, `scammer${Date.now()}@example.com`, "password123");
const other = await scammer.call("createCircle", { circleName: "Not family", displayName: "Totally Josh" });
const bad = await scammer.call("createInvite", { circleId: other.circleId, forName: "Mom" });
await rejects(mom.call("peekInvite", { circleId: other.circleId, inviteId: bad.inviteId, token: bad.token }), /already linked/);
await rejects(mom.call("claimInvite", { circleId: other.circleId, inviteId: bad.inviteId, token: bad.token }), /already linked/);

// Saying "they don't match" cancels the invite.
const second = await josh.call("createInvite", { circleId, forName: "Dad" });
const dad = client("dad");
await signInAnonymously(dad.auth);
await dad.call("claimInvite", { circleId, inviteId: second.inviteId, token: second.token });
assert.equal((await josh.call("confirmInvite", { circleId, inviteId: second.inviteId, match: false })).status, "cancelled");
await rejects(dad.call("confirmInvite", { circleId, inviteId: second.inviteId, match: true }), /isn't waiting/);

// Only helpers can invite.
await rejects(mom.call("createInvite", { circleId, forName: "Stranger" }), /Only helpers/);

console.log("pairing e2e: all checks passed");
process.exit(0);
