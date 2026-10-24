import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, findNodeHandle, NativeModules, Pressable, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenCapturePickerView } from 'react-native-webrtc';

import {
  acceptInvite, clearError, confirmPictures, rejectInvite, start, useFamily,
} from '@/lib/family';
import { clearLog, log, readLog } from '@/lib/log';
import { startShare, stopShare, useShare } from '@/lib/share';

// Plain test screens for the screen sharing trial. The real iPhone screens
// get designed and approved first, like Mom's Android app (Warm Home).

const C = {
  ground: '#F5F0E1', card: '#FFFBF3', clay: '#A3532F', onClay: '#FFF8EE', sand: '#E8DCC4',
  ink: '#3B2A20', muted: '#6B5444', green: '#1F6B45', red: '#9C2F1E',
};

export default function Home() {
  const family = useFamily();
  const share = useShare();
  const picker = useRef(null);
  const [diary, setDiary] = useState<string | null>(null);

  useEffect(() => { start(); }, []);

  const { screen } = family;
  const helper = family.helperNames[0] ?? 'your family';

  async function onShare() {
    if (!family.uid || !family.circleId) return;
    const ready = await startShare({ uid: family.uid, circleId: family.circleId, myName: family.myName });
    if (!ready) return;
    // Apple's own sheet: Mom taps Start Broadcast there.
    const tag = findNodeHandle(picker.current);
    const manager = NativeModules.ScreenCapturePickerViewManager;
    log(tag && manager ? "showing Apple's broadcast sheet" : `can't show Apple's sheet (view ${tag ? 'ok' : 'missing'}, manager ${manager ? 'ok' : 'missing'})`);
    if (tag) manager?.show(tag);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        {/* Hold to see the share diary (testing only). */}
        <Pressable onLongPress={() => setDiary(diary === null ? readLog() || 'Nothing yet.' : null)}>
          <Text style={styles.tag}>Test version</Text>
        </Pressable>
        {diary !== null ? (
          <View style={styles.card}>
            <Text style={styles.diary} selectable>{diary}</Text>
            <Big label="Send the diary" onPress={() => Share.share({ message: diary })} />
            <Big label="Clear" onPress={() => { clearLog(); setDiary('Nothing yet.'); }} quiet />
            <Big label="Close" onPress={() => setDiary(null)} quiet />
          </View>
        ) : null}
        {family.error ? (
          <Pressable onPress={clearError} style={styles.error}>
            <Text style={styles.errorText}>{family.error}</Text>
          </Pressable>
        ) : null}

        {screen.kind === 'loading' && <ActivityIndicator size="large" color={C.clay} style={{ marginTop: 80 }} />}

        {screen.kind === 'welcome' && (
          <View style={styles.card}>
            <Text style={styles.title}>My Tech Kid</Text>
            {screen.note ? <Text style={styles.body}>{screen.note}</Text> : null}
            <Text style={styles.body}>Ask your family to send you an invite link, then tap the link on this iPhone.</Text>
          </View>
        )}

        {screen.kind === 'ask' && (
          <View style={styles.card}>
            <Text style={styles.title}>{screen.helperName} wants to help you with your phone</Text>
            <Text style={styles.body}>Only continue if this is family you know.</Text>
            <Big label="Continue" onPress={acceptInvite} busy={family.busy} />
            <Big label="This isn't my family" onPress={rejectInvite} quiet />
          </View>
        )}

        {screen.kind === 'pictures' && (
          <View style={styles.card}>
            <Text style={styles.title}>Call {screen.helperName}. Do your pictures match?</Text>
            <View style={styles.pictures}>
              {screen.pictures.map((p) => (
                <View key={p.label} style={styles.picture}>
                  <Text style={styles.emoji}>{p.emoji}</Text>
                  <Text style={styles.label}>{p.label}</Text>
                </View>
              ))}
            </View>
            {screen.confirmed ? (
              <Text style={styles.body}>Waiting for {screen.helperName} to tap "They match"…</Text>
            ) : (
              <>
                <Big label="They match" onPress={() => confirmPictures(true)} busy={family.busy} />
                <Big label="They don't match" onPress={() => confirmPictures(false)} quiet />
              </>
            )}
          </View>
        )}

        {screen.kind === 'home' && (
          <View style={styles.card}>
            {share.status === 'off' || share.status === 'starting' ? (
              <>
                <Text style={styles.title}>Show {helper} my screen</Text>
                <Text style={styles.body}>
                  Then tap Start Broadcast. A red bar shows at the top the whole time, and you can stop any time.
                </Text>
                <Big label="Share my screen" onPress={onShare} busy={share.status === 'starting'} />
                {share.error ? <Text style={[styles.body, { color: C.red }]}>{share.error}</Text> : null}
              </>
            ) : (
              <>
                <Text style={styles.title}>
                  {share.status === 'live' ? `${share.watcher} can see your screen` : `Waiting for ${helper} to watch…`}
                </Text>
                <Text style={styles.body}>You can go to any app now. Tap the red bar at the top to stop.</Text>
                <Big label="Stop sharing" onPress={stopShare} danger />
              </>
            )}
          </View>
        )}

        {/* Apple's broadcast button, kept out of sight; "Share my screen" presses it. */}
        <View style={styles.hidden} pointerEvents="none">
          <ScreenCapturePickerView ref={picker} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Big({ label, onPress, busy, quiet, danger }: {
  label: string; onPress: () => void; busy?: boolean; quiet?: boolean; danger?: boolean;
}) {
  const bg = danger ? C.red : quiet ? C.sand : C.clay;
  const fg = quiet ? C.ink : C.onClay;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: pressed || busy ? 0.7 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ground },
  page: { padding: 20, gap: 16 },
  tag: { alignSelf: 'center', color: C.muted, fontSize: 14 },
  diary: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 15, color: C.ink },
  card: { backgroundColor: C.card, borderRadius: 24, padding: 24, gap: 16 },
  title: { fontFamily: 'VarelaRound-Regular', fontSize: 28, color: C.ink },
  body: { fontSize: 20, lineHeight: 28, color: C.muted },
  button: { minHeight: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 22, fontWeight: '700' },
  pictures: { flexDirection: 'row', justifyContent: 'space-around' },
  picture: { alignItems: 'center', gap: 4 },
  emoji: { fontSize: 56 },
  label: { fontSize: 18, color: C.ink },
  error: { backgroundColor: '#F6DDD5', borderRadius: 16, padding: 16 },
  errorText: { fontSize: 18, color: C.red },
  hidden: { width: 1, height: 1, opacity: 0 },
});
