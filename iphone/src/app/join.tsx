import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { handleInviteLink, start } from '@/lib/family';

// Invite links open mytechkid://join?c=…&i=…&t=… (the join page on the
// helper's website sends iPhones here), the same as Mom's Android app.
export default function Join() {
  const { c, i, t } = useLocalSearchParams<{ c?: string; i?: string; t?: string }>();

  useEffect(() => {
    start();
    if (c && i && t) handleInviteLink({ circleId: c, inviteId: i, token: t });
  }, [c, i, t]);

  return <Redirect href="/" />;
}
