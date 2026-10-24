import { ExtensionStorage } from '@bacons/apple-targets';
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
  type DocumentReference, type Unsubscribe,
} from 'firebase/firestore';
import { useSyncExternalStore } from 'react';

import { auth, call, db, firebaseConfig } from './firebase';
import { firstName } from './family';

// Shows this iPhone's screen to the helper's watch page (web/src/watch.js).
// The app makes the share and hands it to Apple's broadcast add-on
// (targets/broadcast/ShareSession.swift), which sends the picture phone to
// phone over WebRTC for as long as the red bar shows, even while Mom uses
// other apps (iOS pauses this app then). The share starts only from Mom's
// own tap and Apple's Start Broadcast.

const APP_GROUP = 'group.com.amethos.mytechkid';
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const ICE_WAIT_MS = 4000;
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

export type ShareState = { status: 'off' | 'starting' | 'waiting' | 'live'; watcher: string | null; error: string | null };

let shareState: ShareState = { status: 'off', watcher: null, error: null };
const listeners = new Set<() => void>();
function setShare(patch: Partial<ShareState>) {
  shareState = { ...shareState, ...patch };
  listeners.forEach((l) => l());
}
export function useShare(): ShareState {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => shareState);
}

type IceServer = { urls: string[] | string; username?: string; credential?: string };

let ref: DocumentReference | null = null;
let unsub: Unsubscribe | null = null;
let joinTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Makes the share and hands it to the broadcast add-on. Returns true when
 * it's ready: the caller then shows Apple's sheet, where Mom taps Start Broadcast.
 */
export async function startShare(opts: { uid: string; circleId: string; myName: string }): Promise<boolean> {
  if (shareState.status !== 'off') return shareState.status !== 'starting';
  setShare({ status: 'starting', watcher: null, error: null });
  try {
    const { uid, circleId, myName } = opts;
    const user = auth.currentUser;
    if (!user) throw new Error('not signed in');
    const share = doc(collection(db, 'circles', circleId, 'screenShares'));
    await setDoc(share, {
      parentId: uid,
      parentName: (myName || 'Your family member').slice(0, 60),
      status: 'waiting',
      createdAt: serverTimestamp(),
    });
    ref = share;
    // A fresh sign-in for the add-on, good for the whole share; it refreshes
    // it itself if the share runs long.
    const [token, iceServers] = await Promise.all([user.getIdTokenResult(true), relayPass(circleId, share.id)]);
    new ExtensionStorage(APP_GROUP).set('shareRequest', JSON.stringify({
      projectId: firebaseConfig.projectId,
      apiKey: firebaseConfig.apiKey,
      uid,
      circleId,
      shareId: share.id,
      idToken: token.token,
      refreshToken: user.refreshToken,
      tokenExpiresAt: Date.parse(token.expirationTime),
      createdAt: Date.now(),
      iceServers,
    }));
    setShare({ status: 'waiting' });
    unsub = onSnapshot(share, (snap) => {
      const status = snap.get('status');
      if (status === 'live') setShare({ status: 'live', watcher: firstName((snap.get('helperName') as string) || 'Your family') });
      else if (status === 'ended') reset();
    });
    // Mom never tapped Start Broadcast, or nobody came: the add-on can't see it then.
    joinTimer = setTimeout(() => { if (shareState.status === 'waiting') stopShare(); }, JOIN_WINDOW_MS);
    return true;
  } catch (err) {
    console.warn('screen share', err);
    stopShare();
    setShare({ error: "Couldn't start sharing. Try again." });
    return false;
  }
}

/** Ends the share. The add-on sees it and Apple's red bar goes away. */
export function stopShare() {
  if (ref) {
    const uid = auth.currentUser?.uid;
    updateDoc(ref, { status: 'ended', endedBy: uid, endedAt: serverTimestamp() }).catch(() => {});
  }
  reset();
}

function reset() {
  unsub?.();
  unsub = null;
  if (joinTimer) clearTimeout(joinTimer);
  joinTimer = null;
  ref = null;
  new ExtensionStorage(APP_GROUP).remove('shareRequest');
  setShare({ status: 'off', watcher: null });
}

/** The relay pass for hard networks; never waits more than a few seconds for it. */
async function relayPass(circleId: string, shareId: string): Promise<IceServer[]> {
  const timeout = new Promise<IceServer[]>((resolve) => setTimeout(() => resolve(STUN_ONLY), ICE_WAIT_MS));
  const pass = call<{ iceServers?: IceServer[] }>('shareIceServers', { circleId, shareId })
    .then((r) => (r.iceServers?.length ? r.iceServers : STUN_ONLY))
    .catch(() => STUN_ONLY);
  return Promise.race([pass, timeout]);
}
