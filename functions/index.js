// My Tech Kid backend: pairing, family-circle membership and push notifications.
// All circle membership changes happen here (never from the apps directly),
// so the Firestore rules can keep circles read-only for clients.

const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineInt } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const { pickPictures, hashToken, newToken } = require("./pairing");
const { deadTokens, scamAlert } = require("./alerts");
const { cleanDevice, sameDevice } = require("./device");

initializeApp();
const db = getFirestore();

// Hours a newly linked parent's phone waits before it accepts remote control.
// Scams depend on urgency; a day's wait breaks that. The default (24) is in
// functions/.env; the beta turns it off for the real project in
// functions/.env.my-tech-kid, which must be deleted before a public release.
const CONTROL_WAIT_HOURS = defineInt("CONTROL_WAIT_HOURS", { default: 24 });

const INVITE_TTL_MS = 60 * 60 * 1000; // invite links expire after an hour

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in first.");
  return request.auth.uid;
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().slice(0, 40);
  return name || fallback;
}

async function loadCircle(circleId) {
  const snap = await db.doc(`circles/${circleId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That family circle doesn't exist.");
  return snap;
}

// Helper (web app) creates their family circle. Idempotent.
exports.createCircle = onCall(async (request) => {
  const uid = requireAuth(request);
  const userRef = db.doc(`users/${uid}`);
  const user = (await userRef.get()).data() ?? {};
  if (user.circleId) return { circleId: user.circleId };

  const displayName = cleanName(request.data?.displayName, "Helper");
  const circleRef = db.collection("circles").doc();
  await db.runTransaction(async (tx) => {
    tx.set(circleRef, {
      name: cleanName(request.data?.circleName, `${displayName}'s family`),
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      helperIds: [uid],
      parentIds: [],
      members: { [uid]: { name: displayName, role: "helper", linkedAt: Timestamp.now() } },
    });
    tx.set(userRef, { displayName, role: "helper", circleId: circleRef.id }, { merge: true });
  });
  return { circleId: circleRef.id };
});

// Helper creates a single-use invite link for a parent ("Mom").
exports.createInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  const circleId = String(request.data?.circleId ?? "");
  const circle = await loadCircle(circleId);
  if (!circle.get("helperIds").includes(uid)) {
    throw new HttpsError("permission-denied", "Only helpers can invite people.");
  }
  const token = newToken();
  const inviteRef = circle.ref.collection("invites").doc();
  await inviteRef.set({
    createdBy: uid,
    createdByName: circle.get(`members.${uid}.name`) ?? "Your family",
    forName: cleanName(request.data?.forName, "Mom"),
    tokenHash: hashToken(token),
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    claimedBy: null,
    pictures: [],
    helperConfirmed: false,
    parentConfirmed: false,
  });
  return { inviteId: inviteRef.id, token };
});

async function openInvite(tx, data) {
  const circleId = String(data?.circleId ?? "");
  const inviteId = String(data?.inviteId ?? "");
  const token = String(data?.token ?? "");
  if (!circleId || !inviteId || !token) throw new HttpsError("invalid-argument", "This invite link is incomplete.");
  const ref = db.doc(`circles/${circleId}/invites/${inviteId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", "This invite link isn't valid.");
  const invite = snap.data();
  const given = Buffer.from(hashToken(token));
  const stored = Buffer.from(invite.tokenHash);
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    throw new HttpsError("permission-denied", "This invite link isn't valid.");
  }
  if (invite.expiresAt.toMillis() < Date.now() && (invite.status === "open" || invite.status === "claimed")) {
    throw new HttpsError("deadline-exceeded", "This invite has expired. Ask for a new one.");
  }
  return { ref, invite };
}

// A phone that is already linked stays with its family: a new invite (for
// example one a scammer talked Mom into opening) can't move it elsewhere.
async function requireUnlinked(tx, uid) {
  const user = await tx.get(db.doc(`users/${uid}`));
  if (user.get("circleId")) {
    throw new HttpsError("already-exists", "This phone is already linked to your family.");
  }
}

// Parent's phone reads who sent the invite, before agreeing to anything.
exports.peekInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  return db.runTransaction(async (tx) => {
    await requireUnlinked(tx, uid);
    const { invite } = await openInvite(tx, request.data);
    if (invite.status !== "open") throw new HttpsError("failed-precondition", "This invite was already used.");
    return { helperName: invite.createdByName, forName: invite.forName };
  });
});

// Parent said "Yes, this is my family": lock the invite to this phone and
// show both sides the same three pictures.
exports.claimInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  return db.runTransaction(async (tx) => {
    await requireUnlinked(tx, uid);
    const { ref, invite } = await openInvite(tx, request.data);
    if (invite.status === "claimed" && invite.claimedBy === uid) {
      return { pictures: invite.pictures, helperName: invite.createdByName };
    }
    if (invite.status !== "open") throw new HttpsError("failed-precondition", "This invite was already used.");
    const pictures = pickPictures(3);
    tx.update(ref, { status: "claimed", claimedBy: uid, claimedAt: FieldValue.serverTimestamp(), pictures });
    return { pictures, helperName: invite.createdByName };
  });
});

// Either side confirms (or rejects) that the pictures match. When both have
// confirmed, the parent's phone joins the circle.
exports.confirmInvite = onCall(async (request) => {
  const uid = requireAuth(request);
  const circleId = String(request.data?.circleId ?? "");
  const inviteId = String(request.data?.inviteId ?? "");
  const match = request.data?.match === true;
  const circleRef = db.doc(`circles/${circleId}`);
  const inviteRef = circleRef.collection("invites").doc(inviteId);

  return db.runTransaction(async (tx) => {
    const [circleSnap, inviteSnap] = await Promise.all([tx.get(circleRef), tx.get(inviteRef)]);
    if (!circleSnap.exists || !inviteSnap.exists) throw new HttpsError("not-found", "Invite not found.");
    const invite = inviteSnap.data();
    const isHelper = circleSnap.get("helperIds").includes(uid);
    const isClaimer = invite.claimedBy === uid;
    if (!isHelper && !isClaimer) throw new HttpsError("permission-denied", "Not your invite.");
    if (invite.status !== "claimed") throw new HttpsError("failed-precondition", "This invite isn't waiting for a picture check.");
    // The whole pairing has to finish within the invite's hour; a half-finished
    // invite must not stay usable forever.
    if (invite.expiresAt.toMillis() < Date.now()) {
      tx.update(inviteRef, { status: "expired" });
      return { status: "expired" };
    }

    if (!match) {
      tx.update(inviteRef, { status: "cancelled", cancelledBy: uid });
      return { status: "cancelled" };
    }

    const helperConfirmed = invite.helperConfirmed || isHelper;
    const parentConfirmed = invite.parentConfirmed || isClaimer;
    if (!(helperConfirmed && parentConfirmed)) {
      tx.update(inviteRef, { helperConfirmed, parentConfirmed });
      return { status: "waiting" };
    }

    const parentUid = invite.claimedBy;
    const now = Date.now();
    tx.update(inviteRef, { helperConfirmed, parentConfirmed, status: "linked", linkedAt: FieldValue.serverTimestamp() });
    tx.update(circleRef, {
      parentIds: FieldValue.arrayUnion(parentUid),
      [`members.${parentUid}`]: {
        name: invite.forName,
        role: "parent",
        linkedAt: Timestamp.fromMillis(now),
        controlAllowedAt: Timestamp.fromMillis(now + CONTROL_WAIT_HOURS.value() * 3600 * 1000),
      },
    });
    tx.set(db.doc(`users/${parentUid}`), { displayName: invite.forName, role: "parent", circleId }, { merge: true });
    return { status: "linked" };
  });
});

// Helper removes a parent's phone from the family (lost, replaced or given
// away). The phone loses access at once and can only come back through a new
// invite with the picture check. Removing helpers waits until a family can
// have more than one helper, with approval from another helper.
exports.removeMember = onCall(async (request) => {
  const uid = requireAuth(request);
  const circleId = String(request.data?.circleId ?? "");
  const memberId = String(request.data?.memberId ?? "");
  if (!circleId || !memberId) throw new HttpsError("invalid-argument", "Who should be removed?");
  const circleRef = db.doc(`circles/${circleId}`);
  const open = await circleRef.collection("helpRequests")
    .where("parentId", "==", memberId).where("status", "in", ["waiting", "accepted"]).get();

  return db.runTransaction(async (tx) => {
    const circle = await tx.get(circleRef);
    if (!circle.exists) throw new HttpsError("not-found", "That family circle doesn't exist.");
    if (!circle.get("helperIds").includes(uid)) {
      throw new HttpsError("permission-denied", "Only helpers can remove a phone.");
    }
    if (!circle.get("parentIds").includes(memberId)) {
      throw new HttpsError("failed-precondition", "Only a parent's phone can be removed for now.");
    }
    tx.update(circleRef, {
      parentIds: FieldValue.arrayRemove(memberId),
      [`members.${memberId}`]: FieldValue.delete(),
    });
    tx.update(db.doc(`users/${memberId}`), { circleId: FieldValue.delete(), role: FieldValue.delete() });
    // Don't leave "Mom needs help" waiting on the dashboard for a removed phone.
    open.docs.forEach((d) => tx.update(d.ref, { status: "cancelled", updatedAt: FieldValue.serverTimestamp() }));
    return { status: "removed" };
  });
});

// ---- Push notifications ----

async function tokensFor(uids) {
  const snaps = await Promise.all(uids.map((u) => db.doc(`users/${u}`).get()));
  const pairs = [];
  snaps.forEach((s) => (s.get("fcmTokens") ?? []).forEach((t) => pairs.push({ uid: s.id, token: t })));
  return pairs;
}

async function notify(uids, title, body, link) {
  const pairs = await tokensFor(uids);
  if (pairs.length === 0) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: pairs.map((p) => p.token),
    notification: { title, body },
    data: { link: link ?? "/" },
    android: { priority: "high", notification: { channelId: "family" } },
    webpush: { fcmOptions: { link: link ?? "/" } },
  });
  // Forget tokens for uninstalled apps / expired subscriptions.
  const dead = deadTokens(pairs, res.responses);
  await Promise.all(dead.map((p) => db.doc(`users/${p.uid}`).update({ fcmTokens: FieldValue.arrayRemove(p.token) })));
}

async function helpersOf(circleId) {
  return (await db.doc(`circles/${circleId}`).get()).get("helperIds") ?? [];
}

exports.onHelpRequest = onDocumentCreated("circles/{circleId}/helpRequests/{id}", async (event) => {
  const req = event.data.data();
  if (req.practice) {
    await notify(await helpersOf(event.params.circleId), `Practice: ${req.parentName} tried the help button`,
      `Tap "Got it" so ${req.parentName} sees it works.`, "/#/");
    return;
  }
  await notify(await helpersOf(event.params.circleId), `${req.parentName} needs help`, "Tap to help now.", "/#/");
});

exports.onHelpRequestUpdated = onDocumentUpdated("circles/{circleId}/helpRequests/{id}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status !== "accepted" && after.status === "accepted") {
    if (after.practice) return; // Mom is watching it happen on her screen.
    await notify([after.parentId], `${after.helperName} is coming to help`, `${after.helperName} will call you in a moment.`);
  }
});

exports.onScamCheck = onDocumentCreated("circles/{circleId}/scamChecks/{id}", async (event) => {
  const check = event.data.data();
  const { title, body } = scamAlert(check);
  await notify(await helpersOf(event.params.circleId), title, body, `/#/scam/${event.params.id}`);
});

exports.onScamAnswered = onDocumentUpdated("circles/{circleId}/scamChecks/{id}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.verdict || !after.verdict) return;
  const titles = { scam: "Scam — don't tap it", unsure: "Not sure — don't tap it yet", safe: "It's safe" };
  await notify([after.parentId], `${after.answeredByName}: ${titles[after.verdict]}`, after.note || "Open My Tech Kid to see the answer.");
});


exports.onScreenShare = onDocumentCreated("circles/{circleId}/screenShares/{id}", async (event) => {
  const share = event.data.data();
  await notify(await helpersOf(event.params.circleId), `${share.parentName} wants to show you their screen`,
    "Tap to watch now.", `/#/watch/${event.params.id}`);
});

// "Ring Mom's phone": a data message, so her app plays the sound itself (loud,
// even on silent) and says who is ringing. Rings older than two minutes are
// dropped so a phone that was off doesn't go off later by surprise.
exports.onRing = onDocumentCreated("circles/{circleId}/rings/{id}", async (event) => {
  const ring = event.data.data();
  if (ring.createdAt?.toMillis() < Date.now() - 2 * 60 * 1000) return;
  const pairs = await tokensFor([ring.parentId]);
  if (pairs.length === 0) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: pairs.map((p) => p.token),
    data: { type: "ring", ringId: event.params.id, helperName: String(ring.helperName ?? "") },
    android: { priority: "high", ttl: 2 * 60 * 1000 },
  });
  const dead = deadTokens(pairs, res.responses);
  await Promise.all(dead.map((p) => db.doc(`users/${p.uid}`).update({ fcmTokens: FieldValue.arrayRemove(p.token) })));
});

// Each app reports what kind of phone it runs on (users/{uid}.device). Copy it
// into the family circle, which only the backend can write, so the helper can
// see whether Mom needs in-app screen sharing (Android) or FaceTime (iPhone).
exports.onUserDevice = onDocumentWritten("users/{uid}", async (event) => {
  const after = event.data?.after?.data();
  const circleId = after?.circleId;
  const device = cleanDevice(after?.device);
  if (!circleId || !device) return;
  const before = event.data?.before?.data();
  if (before?.circleId === circleId && sameDevice(cleanDevice(before?.device), device)) return;
  const uid = event.params.uid;
  const ref = db.doc(`circles/${circleId}`);
  await db.runTransaction(async (tx) => {
    const circle = await tx.get(ref);
    // Never re-add someone who was removed from the family.
    if (!circle.exists || !circle.get(`members.${uid}`)) return;
    if (sameDevice(circle.get(`members.${uid}.device`), device)) return;
    tx.update(ref, { [`members.${uid}.device`]: device });
  });
});

// Pictures of a parent's screen are kept for 30 days, then deleted. The scam
// check itself stays (the helper app says the picture was removed).
const SCAM_SHOT_DAYS = 30;
exports.cleanupScamShots = onSchedule("every day 04:00", async () => {
  const cutoff = Date.now() - SCAM_SHOT_DAYS * 24 * 3600 * 1000;
  const [files] = await getStorage().bucket().getFiles({ prefix: "circles/" });
  const old = files.filter((f) => f.name.includes("/scamShots/") && Date.parse(f.metadata.timeCreated) < cutoff);
  await Promise.all(old.map((f) => f.delete({ ignoreNotFound: true })));
});
