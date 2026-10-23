import { signInAnonymously } from '@firebase/auth';
import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';

import { auth, call, db, friendly } from './firebase';

// The same steps as Mom's Android app (TechKidViewModel.kt): this phone signs
// in on its own, and only an invite from family, checked with three
// pictures on a call, links it to the family.

export type Invite = { circleId: string; inviteId: string; token: string };
export type Picture = { emoji: string; label: string };

export type Screen =
  | { kind: 'loading' }
  | { kind: 'welcome'; note?: string }
  | { kind: 'ask'; invite: Invite; helperName: string }
  | { kind: 'pictures'; invite: Invite; helperName: string; pictures: Picture[]; confirmed: boolean }
  | { kind: 'home' };

type State = {
  screen: Screen;
  uid: string | null;
  circleId: string | null;
  myName: string;
  helperNames: string[];
  busy: boolean;
  error: string | null;
};

let state: State = { screen: { kind: 'loading' }, uid: null, circleId: null, myName: '', helperNames: [], busy: false, error: null };
const listeners = new Set<() => void>();
let userLoaded = false;
let pendingInvite: Invite | null = null;
let unsubUser: Unsubscribe | null = null;
let unsubCircle: Unsubscribe | null = null;
let unsubInvite: Unsubscribe | null = null;
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

export async function start() {
  if (started) return;
  started = true;
  try {
    // Mom never makes an account: this phone is her identity.
    await auth.authStateReady();
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    set({ uid: user.uid });
    listenToUser(user.uid);
    reportDevice(user.uid);
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
    if (circleId && kind !== 'home') {
      unsubInvite?.();
      if (pendingInvite) {
        pendingInvite = null;
        set({ error: 'This phone is already linked to your family.' });
      }
      set({ screen: { kind: 'home' } });
    } else if (!circleId && kind === 'home') {
      // A helper removed this phone from the family (lost or replaced).
      set({ screen: { kind: 'welcome', note: "This phone isn't connected to your family any more." } });
    } else if (!circleId && kind === 'loading') {
      const invite = pendingInvite;
      pendingInvite = null;
      if (invite) openInvite(invite);
      else set({ screen: { kind: 'welcome' } });
    }
  }, () => set({ screen: { kind: 'welcome', note: friendly(null) } }));
}

function watchCircle(circleId: string | null) {
  unsubCircle?.();
  unsubCircle = null;
  if (!circleId) return set({ helperNames: [] });
  unsubCircle = onSnapshot(doc(db, 'circles', circleId), (snap) => {
    const members = (snap.get('members') ?? {}) as Record<string, { name?: string }>;
    const helperIds = (snap.get('helperIds') ?? []) as string[];
    set({ helperNames: helperIds.map((id) => members[id]?.name).filter((n): n is string => !!n).map(firstName) });
  });
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
    const result = await call<{ helperName?: string }>('peekInvite', asMap(invite));
    set({ screen: { kind: 'ask', invite, helperName: firstName(result.helperName ?? 'Your family') } });
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
  set({ screen: { kind: 'welcome', note: 'Good call. You can delete that message. Only use invites from family you know.' } });
}

export const confirmPictures = (match: boolean) => act(async () => {
  const current = state.screen;
  if (current.kind !== 'pictures') return;
  const { invite } = current;
  const result = await call<{ status?: string }>('confirmInvite', { circleId: invite.circleId, inviteId: invite.inviteId, match });
  if (result.status === 'cancelled') set({ screen: { kind: 'welcome', note: "Stopped. Nothing was linked. If this wasn't your family, delete the message." } });
  else if (result.status === 'expired') set({ screen: { kind: 'welcome', note: 'This invite expired. Ask your family to send a new one.' } });
  else if (result.status === 'waiting') set({ screen: { ...current, confirmed: true } });
  // "linked": the user listener moves us to home.
});

function watchInvite(invite: Invite) {
  unsubInvite?.();
  unsubInvite = onSnapshot(doc(db, 'circles', invite.circleId, 'invites', invite.inviteId), (snap) => {
    if (state.screen.kind !== 'pictures') return;
    const status = snap.get('status');
    if (status === 'cancelled') set({ screen: { kind: 'welcome', note: 'Your family stopped this invite. Ask them to send a new one.' } });
    if (status === 'expired') set({ screen: { kind: 'welcome', note: 'This invite expired. Ask your family to send a new one.' } });
  });
}

function asMap(invite: Invite) {
  return { circleId: invite.circleId, inviteId: invite.inviteId, token: invite.token };
}

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
