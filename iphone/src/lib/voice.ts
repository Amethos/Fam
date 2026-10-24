import {
  AudioModule, AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';

// "Tell Josh what's wrong": a short voice message for her helper, the same
// as VoiceNote.kt on Android. Small AAC (audio/mp4) so a minute fits well
// under the 400 KB firestore.rules allow. The microphone is on only while
// the talk screen says "I'm listening".

export const MAX_TALK_SECONDS = 60;
export const MAX_VOICE_BYTES = 400_000;

export type Recording = { bytes: Uint8Array; seconds: number };

let recorder: AudioRecorder | null = null;

/** Asks for the microphone if needed. False if they said no. */
export async function micAllowed(): Promise<boolean> {
  try {
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function startRecording() {
  cancelRecording();
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const r = new AudioModule.AudioRecorder({
    extension: '.m4a',
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
    isMeteringEnabled: true,
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
    ios: {
      outputFormat: IOSOutputFormat.MPEG4AAC,
      audioQuality: AudioQuality.MEDIUM,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
  });
  await r.prepareToRecordAsync();
  r.record();
  recorder = r;
}

/** How loud it is right now, in decibels (about -160 silent to 0 loud). */
export function level(): number {
  return recorder?.getStatus().metering ?? -160;
}

export function seconds(): number {
  return (recorder?.getStatus().durationMillis ?? 0) / 1000;
}

/** Stops and returns the recording, or null if it didn't work. The file is deleted. */
export async function stopRecording(): Promise<Recording | null> {
  const r = recorder;
  recorder = null;
  if (!r) return null;
  const length = (r.getStatus().durationMillis ?? 0) / 1000;
  try {
    await r.stop();
    await setAudioModeAsync({ allowsRecording: false });
    if (!r.uri) return null;
    const file = new File(r.uri);
    const bytes = await file.bytes();
    file.delete();
    return { bytes, seconds: Math.min(Math.max(length, 1), MAX_TALK_SECONDS) };
  } catch {
    return null;
  } finally {
    r.release();
  }
}

/** She left the talk screen: nothing is kept. */
export function cancelRecording() {
  const r = recorder;
  recorder = null;
  if (!r) return;
  r.stop()
    .then(() => { if (r.uri) new File(r.uri).delete(); })
    .catch(() => {})
    .finally(() => r.release());
  setAudioModeAsync({ allowsRecording: false }).catch(() => {});
}
