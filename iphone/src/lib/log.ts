import { ExtensionStorage } from '@bacons/apple-targets';

// A short diary of recent shares, kept only on this phone: the app's steps
// here, and the broadcast add-on's (targets/broadcast/ShareLog.swift) next to
// them in the shared app group. Steps and numbers only, never what's on the
// screen or the sign-in. The test screen shows it (hold "Test version").

export const APP_GROUP = 'group.com.amethos.mytechkid';
const MAX_LINES = 300;
const storage = new ExtensionStorage(APP_GROUP);

export function log(line: string) {
  try {
    const now = new Date();
    const time = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const lines = (storage.get('appLog') ?? '').split('\n').filter(Boolean);
    lines.push(`${time} app: ${line}`);
    storage.set('appLog', lines.slice(-MAX_LINES).join('\n'));
  } catch {
    // The diary is only for testing; never let it get in the way.
  }
}

/** Both diaries, oldest first. */
export function readLog(): string {
  const lines = [storage.get('appLog'), storage.get('shareLog')]
    .flatMap((text) => (text ?? '').split('\n'))
    .filter(Boolean);
  return lines.sort().join('\n');
}

export function clearLog() {
  storage.remove('appLog');
  storage.remove('shareLog');
}
