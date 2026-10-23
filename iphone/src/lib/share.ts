import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
  type DocumentReference, type Unsubscribe,
} from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import {
  mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription,
} from 'react-native-webrtc';

import { call, db } from './firebase';
import { firstName } from './family';

// Shows this iPhone's screen to the helper's watch page (web/src/watch.js),
// speaking the same language as Mom's Android app (ScreenShareService.kt):
// the share starts only from Mom's own tap and Apple's Start Broadcast, the
// picture goes phone to phone over WebRTC (end-to-end encrypted), and
// Firestore only carries the setup messages. iPhone can't be tapped for, so
// there is no control channel beyond pings.

const FIRST_GEN = 'first';
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_SHARE_MS = 60 * 60 * 1000;
const ICE_WAIT_MS = 4000;
const MAX_RECONNECTS = 20;
const MAX_BITRATE = 4_000_000;
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

type IceServer = { urls: string[]; username?: string; credential?: string };

let active: Share | null = null;

/** Starts a share. The caller shows Apple's broadcast picker right after, so Mom can tap Start Broadcast. */
export async function startShare(opts: { uid: string; circleId: string; myName: string }) {
  if (active) return;
  setShare({ status: 'starting', watcher: null, error: null });
  const share = new Share(opts);
  active = share;
  try {
    await share.start();
  } catch (err) {
    console.warn('screen share', err);
    share.stop(false);
    setShare({ error: "Couldn't start sharing. Try again." });
  }
}

export function stopShare() {
  active?.stop(true);
}

class Share {
  private ref: DocumentReference | null = null;
  private stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: ReturnType<RTCPeerConnection['createDataChannel']> | null = null;
  private fast: ReturnType<RTCPeerConnection['createDataChannel']> | null = null;
  private gen = '';
  private reconnects = 0;
  private live = false;
  private offered = false;
  private stopping = false;
  private outbox: [string, string][] = [];
  private pending: RTCIceCandidate[] = [];
  private seen = new Set<string>();
  private unsubs: Unsubscribe[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private iceServers: IceServer[] | null = null;
  private waiters: (() => void)[] = [];
  private startedAt = Date.now();

  constructor(private opts: { uid: string; circleId: string; myName: string }) {}

  async start() {
    // Starts listening for the broadcast add-on (targets/broadcast). The
    // picture arrives once Mom taps Start Broadcast in Apple's sheet.
    this.stream = await mediaDevices.getDisplayMedia({});
    this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop(true));

    const { uid, circleId, myName } = this.opts;
    const ref = doc(collection(db, 'circles', circleId, 'screenShares'));
    this.ref = ref;
    await setDoc(ref, {
      parentId: uid,
      parentName: (myName || 'Your family member').slice(0, 60),
      status: 'waiting',
      createdAt: serverTimestamp(),
    });
    // Mom may have stopped while the share was being made.
    if (this.stopping) {
      updateDoc(ref, { status: 'ended', endedBy: uid, endedAt: serverTimestamp() }).catch(() => {});
      return;
    }
    setShare({ status: 'waiting' });
    this.fetchIceServers(circleId, ref.id);
    // Ready before the helper joins, so the picture shows the moment they do.
    this.withIceServers(() => { if (!this.stopping && !this.pc) this.connect(FIRST_GEN); });

    this.unsubs.push(onSnapshot(ref, (snap) => {
      const status = snap.get('status');
      if (status === 'live') {
        this.live = true;
        setShare({ status: 'live', watcher: firstName((snap.get('helperName') as string) || 'Your family') });
        this.flushOutbox();
        if (!this.offered) {
          this.offered = true;
          this.listenForSignals(ref);
          this.withIceServers(() => { if (!this.pc) this.connect(FIRST_GEN); });
        }
      } else if (status === 'ended') {
        this.stop(false);
      }
    }));
    // Nobody joined in time: stop on our own (the rules refuse late joins too).
    this.timers.push(setTimeout(() => { if (!this.live) this.stop(true); }, JOIN_WINDOW_MS));
    // Never left on by accident.
    const check = setInterval(() => { if (Date.now() - this.startedAt > MAX_SHARE_MS) this.stop(true); }, 30_000);
    this.timers.push(check as unknown as ReturnType<typeof setTimeout>);
  }

  private connect(gen: string) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || this.stopping) return;
    this.closeConnection();
    this.gen = gen;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers ?? STUN_ONLY, iceCandidatePoolSize: 2 });
    this.pc = pc;
    pc.addEventListener('icecandidate', (e: any) => {
      if (this.gen !== gen || !e.candidate) return;
      const c = e.candidate;
      this.sendSignal('candidate', JSON.stringify({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, gen }));
    });
    const sender = pc.addTrack(track, this.stream!);
    const params = sender.getParameters();
    params.encodings?.forEach((e: any) => { e.maxBitrate = MAX_BITRATE; });
    sender.setParameters(params).catch(() => {});

    // Created before the offer so they're part of the same encrypted connection.
    const channel = pc.createDataChannel('control');
    this.channel = channel;
    channel.addEventListener('open', () => {
      // No tapping on iPhone: only pings, so the helper's page knows the link is alive.
      this.send({ t: 'caps', ping: true, fast: true });
    });
    channel.addEventListener('message', (e: any) => this.onHelperMessage(e.data, false));
    const fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    this.fast = fast;
    fast.addEventListener('message', (e: any) => this.onHelperMessage(e.data, true));

    pc.createOffer({}).then(async (offer: RTCSessionDescription) => {
      await pc.setLocalDescription(offer);
      if (this.gen === gen) this.sendSignal('offer', JSON.stringify({ sdp: offer.sdp, gen }));
    }).catch((err: unknown) => console.warn('screen share offer', err));
  }

  private onHelperMessage(data: unknown, fast: boolean) {
    try {
      const m = JSON.parse(String(data));
      if (m.t === 'ping') this.send({ t: 'pong' }, fast);
    } catch {
      // Not ours.
    }
  }

  private send(message: object, fast = false) {
    const dc = fast ? this.fast : this.channel;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(message));
  }

  private listenForSignals(ref: DocumentReference) {
    const q = query(collection(ref, 'signals'), orderBy('createdAt'));
    this.unsubs.push(onSnapshot(q, (snap) => {
      snap.docChanges().forEach(({ type, doc: d }) => {
        if (type !== 'added' || this.seen.has(d.id)) return;
        this.seen.add(d.id);
        const m = d.data();
        if (m.from === this.opts.uid) return;
        let payload: any;
        try { payload = JSON.parse(m.payload); } catch { return; }
        // The helper's page reloaded: start a fresh connection for it.
        if (m.type === 'hello') {
          const gen = String(payload.gen ?? '').slice(0, 40);
          if (gen && gen !== this.gen && this.reconnects++ < MAX_RECONNECTS) this.connect(gen);
          return;
        }
        // Messages for an older connection (before a reload) are ignored.
        if ((payload.gen ?? FIRST_GEN) !== this.gen) return;
        const pc = this.pc;
        if (!pc) return;
        if (m.type === 'answer') {
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }))
            .then(() => {
              this.pending.splice(0).forEach((c) => pc.addIceCandidate(c));
            })
            .catch((err: unknown) => console.warn('screen share answer', err));
        } else if (m.type === 'candidate') {
          const c = new RTCIceCandidate({ candidate: payload.candidate, sdpMid: payload.sdpMid, sdpMLineIndex: payload.sdpMLineIndex });
          if (pc.remoteDescription) pc.addIceCandidate(c);
          else this.pending.push(c);
        }
      });
    }));
  }

  private sendSignal(type: string, payload: string) {
    const ref = this.ref;
    if (!ref || this.stopping) return;
    // The rules only take setup messages once the helper has joined.
    if (!this.live) {
      this.outbox.push([type, payload]);
      return;
    }
    addDoc(collection(ref, 'signals'), { from: this.opts.uid, type, payload, createdAt: serverTimestamp() })
      .catch((err) => console.warn('screen share signal', err));
  }

  private flushOutbox() {
    this.outbox.splice(0).forEach(([type, payload]) => this.sendSignal(type, payload));
  }

  private fetchIceServers(circleId: string, shareId: string) {
    call<{ iceServers?: IceServer[] }>('shareIceServers', { circleId, shareId })
      .then((r) => this.serversReady(r.iceServers?.length ? r.iceServers : STUN_ONLY))
      .catch(() => this.serversReady(STUN_ONLY));
  }

  private serversReady(list: IceServer[]) {
    if (this.stopping || this.iceServers) return;
    this.iceServers = list;
    this.waiters.splice(0).forEach((w) => w());
  }

  /** Runs once the relay pass is in; never waits more than a few seconds for it. */
  private withIceServers(block: () => void) {
    if (this.iceServers) return block();
    this.waiters.push(block);
    this.timers.push(setTimeout(() => this.serversReady(STUN_ONLY), ICE_WAIT_MS));
  }

  private closeConnection() {
    this.channel?.close();
    this.fast?.close();
    this.pc?.close();
    this.channel = null;
    this.fast = null;
    this.pc = null;
    this.pending = [];
  }

  stop(endShare: boolean) {
    if (this.stopping) return;
    this.stopping = true;
    this.timers.forEach((t) => { clearTimeout(t); clearInterval(t as unknown as ReturnType<typeof setInterval>); });
    this.unsubs.forEach((u) => u());
    this.closeConnection();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream?.release();
    if (endShare && this.ref) {
      updateDoc(this.ref, { status: 'ended', endedBy: this.opts.uid, endedAt: serverTimestamp() }).catch(() => {});
    }
    if (active === this) active = null;
    setShare({ status: 'off', watcher: null });
  }
}
