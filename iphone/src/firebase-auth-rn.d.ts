// The React Native build of Firebase Auth (picked by Metro's "react-native"
// condition) has this, but the package's shared type file doesn't list it.
import type { Persistence } from '@firebase/auth';

declare module '@firebase/auth' {
  export function getReactNativePersistence(storage: unknown): Persistence;
}
