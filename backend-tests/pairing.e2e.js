// End-to-end pairing against the local emulators: npm run e2e
import assert from "node:assert";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } from "firebase/firestore";
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

// Mom's phone says what kind of phone it is; the helper sees it in the circle.
await setDoc(doc(mom.db, `users/${mom.auth.currentUser.uid}`),
  { device: { platform: "android", model: "Samsung SM-S911U", osVersion: 14 } }, { merge: true });
let momDevice;
for (let i = 0; i < 50 && !momDevice; i++) {
  await new Promise((r) => setTimeout(r, 200));
  momDevice = (await getDoc(doc(josh.db, `circles/${circleId}`))).get(`members.${mom.auth.currentUser.uid}.device`);
}
assert.deepEqual(momDevice, { platform: "android", model: "Samsung SM-S911U", osVersion: 14 });

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

// Invites run out after an hour, including ones opened but not finished.
// The emulator's "owner" token lets the test move an invite's clock back.
async function expire(inviteId) {
  const url = `http://127.0.0.1:8080/v1/projects/demo-fam/databases/(default)/documents/circles/${circleId}/invites/${inviteId}?updateMask.fieldPaths=expiresAt`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { expiresAt: { timestampValue: new Date(Date.now() - 1000).toISOString() } } }),
  });
  assert.ok(res.ok, `couldn't expire invite: ${res.status}`);
}
const stale = await josh.call("createInvite", { circleId, forName: "Aunt Sue" });
await expire(stale.inviteId);
const sue = client("sue");
await signInAnonymously(sue.auth);
await rejects(sue.call("peekInvite", { circleId, inviteId: stale.inviteId, token: stale.token }), /expired/);
await rejects(sue.call("claimInvite", { circleId, inviteId: stale.inviteId, token: stale.token }), /expired/);

const halfDone = await josh.call("createInvite", { circleId, forName: "Uncle Bob" });
const bob = client("bob");
await signInAnonymously(bob.auth);
await bob.call("claimInvite", { circleId, inviteId: halfDone.inviteId, token: halfDone.token });
await expire(halfDone.inviteId);
assert.equal((await bob.call("confirmInvite", { circleId, inviteId: halfDone.inviteId, match: true })).status, "expired");
await rejects(josh.call("confirmInvite", { circleId, inviteId: halfDone.inviteId, match: true }), /isn't waiting/);
assert.ok(!(await getDoc(doc(josh.db, `circles/${circleId}`))).data().parentIds.includes(bob.auth.currentUser.uid));

// Only helpers can invite.
await rejects(mom.call("createInvite", { circleId, forName: "Stranger" }), /Only helpers/);

// A helper can remove Mom's phone; she then needs a new invite to come back.
const momUid = mom.auth.currentUser.uid;
await rejects(mom.call("removeMember", { circleId, memberId: momUid }), /Only helpers/);
await rejects(scammer.call("removeMember", { circleId, memberId: momUid }), /Only helpers/);
await rejects(josh.call("removeMember", { circleId, memberId: josh.auth.currentUser.uid }), /Only a parent/);
const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
const pending = await addDoc(collection(mom.db, `circles/${circleId}/helpRequests`),
  { parentId: momUid, parentName: "Mom", status: "waiting", createdAt: serverTimestamp() });
assert.equal((await josh.call("removeMember", { circleId, memberId: momUid })).status, "removed");
const after = (await getDoc(doc(josh.db, `circles/${circleId}`))).data();
assert.ok(!after.parentIds.includes(momUid));
assert.equal(after.members[momUid], undefined);
assert.equal((await getDoc(doc(josh.db, pending.path))).data().status, "cancelled");
await assert.rejects(getDoc(doc(mom.db, `circles/${circleId}`)), "a removed phone can no longer read the family");
const relink = await josh.call("createInvite", { circleId, forName: "Mom" });
assert.equal((await mom.call("peekInvite", { circleId, inviteId: relink.inviteId, token: relink.token })).helperName, "Josh");

console.log("pairing e2e: all checks passed");
process.exit(0);
