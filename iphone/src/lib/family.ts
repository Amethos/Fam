import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAnonymously } from '@firebase/auth';
import {
  addDoc, Bytes, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
  where, writeBatch, type DocumentReference, type Unsubscribe,
} from 'firebase/firestore';
import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';

import { setUpAlerts } from './alerts';
import { auth, call, db, friendly } from './firebase';
import { log } from './log';
import * as voice from './voice';

// The same steps as Mom's Android app (TechKidViewModel.kt): this phone signs
// in on its own, and only an invite from family, checked with three
// pictures on a call, links it to the family. Then: the help button (talk
// first), "Is this a scam?", and a one-time practice run.

export type Invite = { circleId: string; inviteId: string; token: string };
export type Picture = { emoji: string; label: string };
export type HelpRequest = { id: string; status: string; helperName: string | null; practice: boolean; hasVoice: boolean };
export type ScamCheck = {
  id: string; text: string; verdict: string | null; note: string | null; answeredByName: string | null; createdAt: number;
};
export type Talk = { kind: 'ready' } | { kind: 'recording'; seconds: number } | { kind: 'sending' };

export type Screen =
  | { kind: 'loading' }
  | { kind: 'welcome'; note?: string }
  | { kind: 'ask'; invite: Invite; helperName: string; helperRelation: string | null; helperPhoto: string | null }
  | { kind: 'pictures'; invite: Invite; helperName: string; pictures: Picture[]; confirmed: boolean }
  | { kind: 'intro' }
  | { kind: 'home' }
  | { kind: 'talk' }
  | { kind: 'scam' };

type State = {
  screen: Screen;
  uid: string | null;
  circleId: string | null;
  myName: string;
  helperNames: string[];
  /** The first helper's photo (a small JPEG data URL), shown on the big button. */
  helperPhoto: string | null;
  activeHelp: HelpRequest | null;
  practiceHelp: HelpRequest | null;
  scamChecks: ScamCheck[];
  talk: Talk;
  busy: boolean;
  error: string | null;
};

const LINKED: Screen['kind'][] = ['intro', 'home', 'talk', 'scam'];
const INTRO_KEY = 'introSeen';
const TALK_WAIT_MS = 30_000;
const QUIET_DB = -40;

let state: State = {
  screen: { kind: 'loading' }, uid: null, circleId: null, myName: '', helperNames: [], helperPhoto: null,
  activeHelp: null, practiceHelp: null, scamChecks: [], talk: { kind: 'ready' }, busy: false, error: null,
};
const listeners = new Set<() => void>();
let userLoaded = false;
let introSeen = false;
let pendingInvite: Invite | null = null;
let unsubUser: Unsubscribe | null = null;
let circleUnsubs: Unsubscribe[] = [];
let unsubInvite: Unsubscribe | null = null;
let talkTimer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let started = false;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useFamily(): State {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => state);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Josh" / "Josh or Sam" / "Josh, Sam or Lee". */
export function names(list: string[]): string {
  if (list.length === 0) return 'your helper';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

/** The helper's photo only if it's the small JPEG the backend allows (functions/profile.js). */
function cleanPhoto(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 100_000 && PHOTO.test(value) ? value : null;
}

export async function start() {
  if (started) return;
  started = true;
  try {
    introSeen = (await AsyncStorage.getItem(INTRO_KEY)) === 'yes';
    // Mom never makes an account: this phone is her identity.
    await auth.authStateReady();
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    set({ uid: user.uid });
    listenToUser(user.uid);
    reportDevice(user.uid);
    // Only refreshes the alert address if she already said yes; it never asks here.
    setUpAlerts(user.uid, false);
  } catch (err) {
    set({ screen: { kind: 'welcome', note: friendly(err) } });
  }
}

/** Tells the family what kind of phone this is, so the helper's app picks the right way to help. */
async function reportDevice(uid: string) {
  const major = Number(String(Device.osVersion ?? '').split('.')[0]);
  const device: Record<string, unknown> = { platform: 'ios', model: (Device.modelName ?? 'iPhone').slice(0, 60) };
  if (major > 0 && major < 100) device.osVersion = major;
  try {
    await setDoc(doc(db, 'users', uid), { device }, { merge: true });
  } catch {
    // Only used to pick how to help; the app works without it.
  }
}

function listenToUser(uid: string) {
  unsubUser?.();
  unsubUser = onSnapshot(doc(db, 'users', uid), (snap) => {
    userLoaded = true;
    const circleId = (snap.get('circleId') as string | undefined) ?? null;
    const myName = (snap.get('displayName') as string | undefined) ?? '';
    if (circleId !== state.circleId) watchCircle(circleId);
    set({ circleId, myName });
    const kind = state.screen.kind;
    const linked = LINKED.includes(kind);
    if (circleId && !linked) {
      unsubInvite?.();
      if (pendingInvite) {
        pendingInvite = null;
        set({ error: 'This phone is already linked to your family.' });
      }
      set({ screen: { kind: introSeen ? 'home' : 'intro' } });
    } else if (!circleId && linked) {
      // A helper removed this phone from the family (lost or replaced).
      stopTalk();
      set({
        activeHelp: null, practiceHelp: null, scamChecks: [], helperNames: [], helperPhoto: null,
        screen: { kind: 'welcome', note: "This phone isn't connected to your family any more." },
      });
    } else if (!circleId && kind === 'loading') {
      const invite = pendingInvite;
      pendingInvite = null;
      if (invite) openInvite(invite);
      else set({ screen: { kind: 'welcome' } });
    }
  }, () => set({ screen: { kind: 'welcome', note: friendly(null) } }));
}

function watchCircle(circleId: string | null) {
  circleUnsubs.forEach((u) => u());
  circleUnsubs = [];
  const me = state.uid;
  if (!circleId || !me) return set({ helperNames: [], helperPhoto: null });
  // Errors: no longer in this family (a helper removed this phone); the user listener handles it.
  const ignore = () => {};
  circleUnsubs.push(onSnapshot(doc(db, 'circles', circleId), (snap) => {
    const members = (snap.get('members') ?? {}) as Record<string, { name?: string; photo?: string }>;
    const helperIds = (snap.get('helperIds') ?? []) as string[];
    set({
      helperNames: helperIds.map((id) => members[id]?.name).filter((n): n is string => !!n).map(firstName),
      helperPhoto: cleanPhoto(helperIds[0] ? members[helperIds[0]]?.photo : null),
    });
  }, ignore));
  // Only open requests: finished ones would pile up and be re-read every launch.
  circleUnsubs.push(onSnapshot(query(
    collection(db, 'circles', circleId, 'helpRequests'),
    where('parentId', '==', me),
    where('status', 'in', ['waiting', 'accepted']),
  ), (snap) => {
    const open = snap.docs
      .map((d) => ({ d, at: d.get('createdAt')?.toMillis?.() ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => b.at - a.at)
      .map(({ d }): HelpRequest => ({
        id: d.id,
        status: d.get('status'),
        helperName: d.get('helperName') ? firstName(d.get('helperName')) : null,
        practice: d.get('practice') === true,
        hasVoice: d.get('hasVoice') === true,
      }));
    set({ activeHelp: open.find((h) => !h.practice) ?? null, practiceHelp: open.find((h) => h.practice) ?? null });
  }, ignore));
  // Her screen shows only her latest check; don't load her whole history.
  circleUnsubs.push(onSnapshot(query(
    collection(db, 'circles', circleId, 'scamChecks'),
    where('parentId', '==', me),
    orderBy('createdAt', 'desc'),
    limit(5),
  ), (snap) => {
    set({
      scamChecks: snap.docs.map((d): ScamCheck => ({
        id: d.id,
        text: d.get('text') ?? '',
        verdict: d.get('verdict') ?? null,
        note: d.get('note') ?? null,
        answeredByName: d.get('answeredByName') ?? null,
        createdAt: d.get('createdAt')?.toMillis?.() ?? Date.now(),
      })).sort((a, b) => b.createdAt - a.createdAt),
    });
  }, ignore));
}

// ---------- Invite links (mytechkid://join?c=…&i=…&t=…) ----------

export function handleInviteLink(invite: Invite) {
  if (state.circleId) set({ error: 'This phone is already linked to your family.' });
  else if (!userLoaded) pendingInvite = invite;
  else openInvite(invite);
}

async function openInvite(invite: Invite) {
  set({ screen: { kind: 'loading' }, error: null });
  try {
    const result = await call<{ helperName?: string; helperRelation?: string | null; helperPhoto?: string | null }>(
      'peekInvite', asMap(invite),
    );
    const relation = result.helperRelation ? result.helperRelation[0].toUpperCase() + result.helperRelation.slice(1) : null;
    set({
      screen: {
        kind: 'ask',
        invite,
        helperName: firstName(result.helperName ?? 'Your helper'),
        helperRelation: relation,
        helperPhoto: cleanPhoto(result.helperPhoto),
      },
    });
  } catch (err) {
    set({ screen: { kind: 'welcome', note: friendly(err) } });
  }
}

export const acceptInvite = () => act(async () => {
  const ask = state.screen;
  if (ask.kind !== 'ask') return;
  const result = await call<{ pictures?: Picture[] }>('claimInvite', asMap(ask.invite));
  set({ screen: { kind: 'pictures', invite: ask.invite, helperName: ask.helperName, pictures: result.pictures ?? [], confirmed: false } });
  watchInvite(ask.invite);
});

export function rejectInvite() {
  set({ screen: { kind: 'welcome', note: 'Good call. You can delete that message. Only use invites from people you know.' } });
}

export const confirmPictures = (match: boolean) => act(async () => {
  const current = state.screen;
  if (current.kind !== 'pictures') return;
  const { invite } = current;
  const result = await call<{ status?: string }>('confirmInvite', { circleId: invite.circleId, inviteId: invite.inviteId, match });
  if (result.status === 'cancelled') set({ screen: { kind: 'welcome', note: "Stopped. Nothing was linked. If this wasn't someone you know, delete the message." } });
  else if (result.status === 'expired') set({ screen: { kind: 'welcome', note: 'This invite expired. Ask the person who sent it for a new one.' } });
  else if (result.status === 'waiting') set({ screen: { ...current, confirmed: true } });
  // "linked": the user listener moves us on.
});

function watchInvite(invite: Invite) {
  unsubInvite?.();
  unsubInvite = onSnapshot(doc(db, 'circles', invite.circleId, 'invites', invite.inviteId), (snap) => {
    if (state.screen.kind !== 'pictures') return;
    const status = snap.get('status');
    if (status === 'cancelled') set({ screen: { kind: 'welcome', note: 'The person who sent this invite stopped it. Ask them for a new one.' } });
    if (status === 'expired') set({ screen: { kind: 'welcome', note: 'This invite expired. Ask the person who sent it for a new one.' } });
  }, () => {
    // Once linked, the invite is no longer readable; it isn't needed then.
  });
}

function asMap(invite: Invite) {
  return { circleId: invite.circleId, inviteId: invite.inviteId, token: invite.token };
}

// ---------- First time: the practice run ----------

/** Mom tries her button once, and her helper answers "Got it". */
export const tryPractice = () => act(async () => {
  const id = state.circleId;
  if (!id || state.practiceHelp) return;
  await addDoc(collection(db, 'circles', id, 'helpRequests'), {
    parentId: state.uid,
    parentName: myCircleName(),
    status: 'waiting',
    createdAt: serverTimestamp(),
    practice: true,
  });
});

/** Done with the intro: asks about alerts once (the screen just explained it). */
export function finishIntro() {
  introSeen = true;
  AsyncStorage.setItem(INTRO_KEY, 'yes').catch(() => {});
  set({ screen: { kind: 'home' } });
  if (state.uid) setUpAlerts(state.uid, true);
  // Close the practice run so it never shows up as real help.
  const id = state.circleId;
  const practice = state.practiceHelp;
  if (!id || !practice) return;
  updateDoc(doc(db, 'circles', id, 'helpRequests', practice.id), {
    status: practice.status === 'accepted' ? 'done' : 'cancelled',
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

// ---------- Help ----------

function myCircleName(): string {
  return (state.myName || 'Your family member').slice(0, 60);
}

/**
 * Tap for help, talk first: Mom can say what's wrong before anything is sent,
 * so her helper's one alert already says there's a voice message. If she
 * taps nothing for 30 seconds, the request goes anyway: she's never stuck.
 */
export function askForHelp() {
  if (!state.circleId || state.busy) return;
  clearTalkTimer();
  set({ talk: { kind: 'ready' }, screen: { kind: 'talk' } });
  talkTimer = setTimeout(() => {
    if (state.screen.kind === 'talk' && state.talk.kind === 'ready') sendHelp(null);
  }, TALK_WAIT_MS);
}

/** "Just ask Josh to call me", or the microphone isn't allowed: send without a message. */
export function askWithoutTalking() {
  if (state.talk.kind === 'ready') sendHelp(null);
}

/** Back from the talk screen: she changed her mind, nothing was sent. */
export function leaveTalk() {
  if (state.talk.kind === 'sending') return;
  stopTalk();
  set({ screen: { kind: 'home' } });
}

function clearTalkTimer() {
  if (talkTimer) clearTimeout(talkTimer as ReturnType<typeof setTimeout>);
  if (talkTimer) clearInterval(talkTimer as ReturnType<typeof setInterval>);
  talkTimer = null;
}

function stopTalk() {
  clearTalkTimer();
  voice.cancelRecording();
  set({ talk: { kind: 'ready' } });
}

/** Mom tapped the microphone: record until she stops talking. */
export async function startTalking() {
  if (state.talk.kind !== 'ready') return;
  clearTalkTimer();
  if (!(await voice.micAllowed())) return askWithoutTalking();
  try {
    await voice.startRecording();
  } catch (err) {
    log(`microphone didn't start: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    return sendHelp(null); // the microphone didn't work; still get her help
  }
  set({ talk: { kind: 'recording', seconds: 0 } });
  let spoke = false;
  let quietMs = 0;
  talkTimer = setInterval(() => {
    if (state.talk.kind !== 'recording') return;
    if (voice.level() > QUIET_DB) {
      spoke = true;
      quietMs = 0;
    } else if (spoke) {
      quietMs += 200;
    }
    const seconds = voice.seconds();
    set({ talk: { kind: 'recording', seconds: Math.floor(seconds) } });
    // Done after 4 seconds of quiet, or at one minute.
    if ((spoke && quietMs >= 4000) || seconds >= voice.MAX_TALK_SECONDS) finishTalking();
  }, 200);
}

/** "Send to Josh", or she stopped talking. */
export async function finishTalking() {
  if (state.talk.kind !== 'recording') return;
  clearTalkTimer();
  set({ talk: { kind: 'sending' } });
  const recording = await voice.stopRecording();
  log(recording ? `voice message ${Math.round(recording.bytes.length / 1000)} KB, ${Math.round(recording.seconds)} s` : 'no voice message');
  const ok = recording && recording.bytes.length > 0 && recording.bytes.length <= voice.MAX_VOICE_BYTES && recording.seconds >= 1;
  sendHelp(ok ? recording : null);
}

function sendHelp(recording: voice.Recording | null) {
  const id = state.circleId;
  if (!id) return;
  clearTalkTimer();
  set({ talk: { kind: 'sending' } });
  act(async () => {
    try {
      const help: DocumentReference = doc(collection(db, 'circles', id, 'helpRequests'));
      const batch = writeBatch(db);
      batch.set(help, {
        parentId: state.uid,
        parentName: myCircleName(),
        status: 'waiting',
        createdAt: serverTimestamp(),
        hasVoice: recording != null,
      });
      if (recording) {
        batch.set(doc(help, 'voice', 'clip'), {
          audio: Bytes.fromUint8Array(recording.bytes),
          mime: 'audio/mp4',
          seconds: recording.seconds,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      log(`help asked${recording ? ` with a ${Math.round(recording.seconds)} s voice message` : ''}`);
      set({ screen: { kind: 'home' } });
    } finally {
      set({ talk: { kind: 'ready' } });
    }
  });
}

/** "Never mind, I'm OK" (cancelled) or "All fixed, thank you" (done). */
export const finishHelp = (status: 'cancelled' | 'done') => act(async () => {
  const id = state.circleId;
  const help = state.activeHelp;
  if (!id || !help) return;
  await updateDoc(doc(db, 'circles', id, 'helpRequests', help.id), { status, updatedAt: serverTimestamp() });
});

// ---------- Is this a scam? ----------

export function openScamCheck() {
  set({ screen: { kind: 'scam' }, error: null });
}

export const sendScamCheck = (text: string) => act(async () => {
  const id = state.circleId;
  if (!id) return;
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) {
    set({ error: 'Paste or type the message first.' });
    return;
  }
  await addDoc(collection(db, 'circles', id, 'scamChecks'), {
    parentId: state.uid,
    parentName: myCircleName(),
    text: trimmed,
    createdAt: serverTimestamp(),
    verdict: null,
  });
});

export function goHome() {
  set({ screen: state.circleId ? { kind: 'home' } : { kind: 'welcome' }, error: null });
}

// ---------- Plumbing ----------

async function act(block: () => Promise<void>) {
  set({ busy: true, error: null });
  try {
    await block();
  } catch (err) {
    set({ error: friendly(err) });
  } finally {
    set({ busy: false });
  }
}

export function clearError() {
  set({ error: null });
}
