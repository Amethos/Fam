import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { arrayUnion, doc, setDoc } from 'firebase/firestore';

import { db } from './firebase';
import { log } from './log';

// Alerts from family ("Josh is coming to help", scam answers, "ringing your
// phone"). iPhones get them through Expo's push service, which passes them
// to Apple (functions/index.js notifyExpo). Like Android, an alert only ever
// says who and what happened, never her messages.

// Shown even while the app is open, with sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks once (after the practice run, where the screen explains it) and
 * saves this iPhone's alert address. Later launches only refresh the address
 * if she said yes; they never ask again.
 */
export async function setUpAlerts(uid: string, ask: boolean) {
  try {
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted && ask) granted = (await Notifications.requestPermissionsAsync()).granted;
    log(`alerts ${granted ? 'allowed' : 'not allowed'}`);
    if (!granted) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await setDoc(doc(db, 'users', uid), { expoTokens: arrayUnion(token), platform: 'ios' }, { merge: true });
  } catch (err) {
    // Alerts are a bonus; the app still works without them.
    log(`alerts not set up: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
}
