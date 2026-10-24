import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from '@firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Same project as the helper's web app (web/src/config.js). None of these
// values are secret: access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyC5erd38-FD8DpJG3eHPyPQv9OWLuvAAbo',
  authDomain: 'my-tech-kid.firebaseapp.com',
  projectId: 'my-tech-kid',
  storageBucket: 'my-tech-kid.firebasestorage.app',
  messagingSenderId: '491750036445',
  appId: '1:491750036445:web:8e9b29050980b77b589c34',
};

export const app = initializeApp(firebaseConfig);
// The sign-in is kept on the phone, so this iPhone stays the same family member.
export const auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
export const db = getFirestore(app);
const functions = getFunctions(app);

export async function call<T = Record<string, unknown>>(name: string, data: object): Promise<T> {
  const result = await httpsCallable(functions, name)(data);
  return (result.data ?? {}) as T;
}

/** The backend's own message when it has one (it's written for Mom), else a plain one. */
export function friendly(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code?.startsWith('functions/') && e.message) return e.message;
  return "Couldn't reach your family. Check your internet and try again.";
}
