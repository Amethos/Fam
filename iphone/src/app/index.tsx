import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, findNodeHandle, Linking, NativeModules, Pressable, ScrollView, Share, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenCapturePickerView } from 'react-native-webrtc';

import {
  BigButton, Body, C, Face, Heading, LiveDot, Panel, PopIn, Quote, QuietButton, ROUNDED, Shield, Title, Avatar,
} from '@/components/ui';
import {
  acceptInvite, askForHelp, askWithoutTalking, clearError, confirmPictures, finishHelp, finishIntro, finishTalking,
  goHome, leaveTalk, names, openScamCheck, rejectInvite, sendScamCheck, start, startTalking, tryPractice, useFamily,
  type ScamCheck,
} from '@/lib/family';
import { clearLog, log, readLog } from '@/lib/log';
import { startShare, stopShare, useShare } from '@/lib/share';

// Mom's iPhone app, the same screens as her Android app (ui/Screens.kt) in
// the approved Warm Home look. iPhone differences: Apple's own Start
// Broadcast sheet shows her screen, and the helper can see but not tap.

const SITE = 'https://my-tech-kid.web.app/';

export default function Home() {
  const family = useFamily();
  const share = useShare();
  const picker = useRef(null);
  const [diary, setDiary] = useState<string | null>(null);

  useEffect(() => { start(); }, []);

  const { screen } = family;
  const first = family.helperNames[0] ?? 'Your helper';

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
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {/* Testing only: hold to see the share diary. */}
        <Pressable onLongPress={() => setDiary(diary === null ? readLog() || 'Nothing yet.' : null)} accessible={false}>
          <Text style={styles.tag}>Test version</Text>
        </Pressable>
        {diary !== null ? (
          <Panel background={C.card}>
            <Text style={styles.diary} selectable>{diary}</Text>
            <BigButton label="Send the diary" onPress={() => Share.share({ message: diary })} />
            <QuietButton label="Clear" onPress={() => { clearLog(); setDiary('Nothing yet.'); }} />
            <QuietButton label="Close" onPress={() => setDiary(null)} />
          </Panel>
        ) : null}
        {family.error ? (
          <Pressable onPress={clearError} accessibilityRole="button" accessibilityHint="Hides this message">
            <Panel background={C.redSoft}><Body color={C.redInk}>{family.error}</Body></Panel>
          </Pressable>
        ) : null}

        {screen.kind === 'loading' && <ActivityIndicator size="large" color={C.clay} style={{ marginTop: 120 }} />}
        {screen.kind === 'welcome' && <Welcome note={screen.note} />}
        {screen.kind === 'ask' && (
          <>
            <View style={styles.center}>
              <Face name={screen.helperName} photo={screen.helperPhoto} size={120} />
              {/* "Your son": what the helper said, so a stranger's claim can sound wrong. */}
              {screen.helperRelation ? <Text style={styles.relation}>{screen.helperRelation}</Text> : null}
            </View>
            <Title>Link with {screen.helperName}?</Title>
            <Panel background={C.claySoft}>
              <Text style={styles.strong}>Only continue if you know {screen.helperName} personally and trust them with your phone.</Text>
              <Body color={C.clayInk}>Once linked, each time you tap Start Broadcast, {screen.helperName} can see your screen. You can stop at any time.</Body>
              <Body color={C.clayInk}>Banks, Apple, Google, Microsoft and the police will never ask you to use this app.</Body>
            </Panel>
            <BigButton label={`I know ${screen.helperName}, continue`} onPress={acceptInvite} busy={family.busy} />
            <QuietButton label="I don't know this person" onPress={rejectInvite} disabled={family.busy} />
          </>
        )}
        {screen.kind === 'pictures' && (
          <>
            <Title>{screen.confirmed ? 'Almost done' : `Call ${screen.helperName} and check these pictures`}</Title>
            <Body>{screen.confirmed
              ? `Waiting for ${screen.helperName} to tap "They match" on their phone.`
              : `${screen.helperName} should see the same three pictures.`}</Body>
            {screen.pictures.map((p) => (
              <View key={p.label} style={styles.picture}>
                <Text style={styles.emoji}>{p.emoji}</Text>
                <Text style={styles.pictureLabel}>{p.label}</Text>
              </View>
            ))}
            {!screen.confirmed && (
              <>
                <BigButton label="They match" color={C.green} onPress={() => confirmPictures(true)} busy={family.busy} />
                <QuietButton label="They don't match, stop" onPress={() => confirmPictures(false)} disabled={family.busy} />
              </>
            )}
          </>
        )}
        {screen.kind === 'intro' && <Intro first={first} />}
        {screen.kind === 'home' && <HomeScreen first={first} onShare={onShare} />}
        {screen.kind === 'talk' && <Talk first={first} />}
        {screen.kind === 'scam' && <Scam />}

        {/* Apple's broadcast button, kept out of sight; "Show … my screen" presses it. */}
        <View style={styles.hidden} pointerEvents="none">
          <ScreenCapturePickerView ref={picker} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );

}

// ---------- Screens ----------

// One job: reach someone who can help. The button opens Messages with a
// ready-made text; she picks who gets it. Linking still needs their invite
// and the picture check.
function Welcome({ note }: { note?: string }) {
  const text = `Can you help me with my phone? I'm using My Tech Kid. Start here, then send me an invite link: ${SITE}?start=helper`;
  return (
    <>
      <View style={{ height: 24 }} />
      <Title>Welcome to My Tech Kid</Title>
      {note ? <Panel background={C.claySoft}><Body color={C.clayInk}>{note}</Body></Panel> : null}
      <Body>My Tech Kid puts a big button on your phone that reaches someone you trust when you need help.</Body>
      <BigButton
        label="Text someone who can help"
        onPress={() => Linking.openURL(`sms:&body=${encodeURIComponent(text)}`).catch(() => Share.share({ message: text }))}
      />
      <Panel background={C.claySoft}>
        <Body color={C.clayInk}>Only send this to people you know. Banks, Apple, Google, Microsoft and the police will never ask you to.</Body>
      </Panel>
      <Body>Already got a link? Tap it in your messages.</Body>
    </>
  );
}

function Intro({ first }: { first: string }) {
  const family = useFamily();
  const practice = family.practiceHelp;
  if (!practice) {
    // Step 1: meet the button, and try it once for real.
    return (
      <>
        <Title>This is your help button</Title>
        <Body color={C.ink}>Let's try it once together. Tap it now. {first} will see it's just practice.</Body>
        <PopIn delay={250}>
          <HelpButton first={first} height={320} onPress={tryPractice} />
        </PopIn>
        <QuietButton label="Not now" onPress={finishIntro} />
      </>
    );
  }
  if (practice.status === 'waiting') {
    // Step 2: waiting for the helper's "Got it".
    return (
      <>
        <Title>Asking {first}…</Title>
        <Panel background={C.infoSoft}>
          <View style={styles.row}><LiveDot color={C.clay} /><Heading size={24}>{first}'s phone is buzzing</Heading></View>
          <Body color={C.ink}>When {first} taps Got it, you'll see it here.</Body>
        </Panel>
        <QuietButton label="Not now" onPress={finishIntro} />
      </>
    );
  }
  // Step 3: it worked. Next comes Apple's one question about alerts.
  return (
    <>
      <PopIn>
        <Panel background={C.greenSoft}>
          <Face name={first} photo={family.helperPhoto} size={72} />
          <Heading size={32}>{first} got it!</Heading>
          <Body color={C.ink}>That's all there is to it. Whenever you're stuck on your phone, tap your button and {first} will call you.</Body>
        </Panel>
      </PopIn>
      <Panel background={C.claySoft}>
        <Body color={C.clayInk}>Next, your iPhone will ask about notifications. Tap Allow so you can see {first}'s answers.</Body>
      </Panel>
      <BigButton label="OK, got it" onPress={finishIntro} />
    </>
  );
}

function HelpButton({ first, height, onPress }: { first: string; height: number; onPress: () => void }) {
  const family = useFamily();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tap for help from ${first}`}
      disabled={family.busy}
      onPress={onPress}
      style={({ pressed }) => [styles.help, { minHeight: height, opacity: pressed ? 0.85 : 1 }]}
    >
      <Face name={first} photo={family.helperPhoto} size={family.helperPhoto ? 150 : 116} onClay />
      <Text style={styles.helpTitle}>Tap for help</Text>
      <Text style={styles.helpFrom}>from {first}</Text>
    </Pressable>
  );
}

function HomeScreen({ first, onShare }: { first: string; onShare: () => void }) {
  const family = useFamily();
  const share = useShare();
  const help = family.activeHelp;
  const helpers = names(family.helperNames);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const sharing = share.status !== 'off';
  return (
    <>
      <View style={{ gap: 4 }}>
        <Text style={styles.day}>{now.toLocaleDateString(undefined, { weekday: 'long' })}</Text>
        <Text style={styles.date}>{now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</Text>
        <Text style={styles.greeting}>{family.myName ? `${greeting}, ${family.myName}` : greeting}</Text>
      </View>
      {sharing && <SharingPanel onStop={stopShare} />}
      {share.error ? <Panel background={C.redSoft}><Body color={C.redInk}>{share.error}</Body></Panel> : null}
      {help?.status === 'waiting' ? (
        <Panel background={C.infoSoft}>
          <View style={styles.row}><LiveDot color={C.clay} /><Heading>Asking {helpers} for help…</Heading></View>
          <Body color={help.hasVoice ? C.ink : C.muted}>
            {help.hasVoice ? 'They got your voice message.' : "They're getting an alert on their phone right now."}
          </Body>
          <QuietButton label="Never mind, I'm OK" onPress={() => finishHelp('cancelled')} disabled={family.busy} />
        </Panel>
      ) : help?.status === 'accepted' ? (
        <PopIn>
          <Panel background={C.greenSoft}>
            <View style={styles.row}>
              <Avatar name={help.helperName ?? first} size={56} />
              <Heading>{help.helperName ?? first} is coming to help</Heading>
            </View>
            {/* Show … my screen, then Start Broadcast: Mom's own two taps each time. */}
            <Body color={C.ink}>{sharing
              ? "They'll call you in a moment."
              : `Tap the button, then tap Start Broadcast so ${help.helperName ?? first} can see your screen. You can stop any time.`}</Body>
            {!sharing && <BigButton label={`Show ${help.helperName ?? first} my screen`} color={C.green} onPress={onShare} />}
            <QuietButton label="All fixed, thank you" onPress={() => finishHelp('done')} disabled={family.busy} />
          </Panel>
        </PopIn>
      ) : (
        <PopIn delay={120}>
          <HelpButton first={first} height={360} onPress={askForHelp} />
        </PopIn>
      )}
      <PopIn delay={320}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Is this a scam? Ask before you tap or pay"
          onPress={openScamCheck}
          style={({ pressed }) => [styles.scamButton, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Shield size={44} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.scamTitle}>Is this a scam?</Text>
            <Text style={styles.scamSub}>Ask before you tap or pay</Text>
          </View>
        </Pressable>
      </PopIn>
    </>
  );
}

// Always visible while the screen is shared: who can see it, and a big Stop.
function SharingPanel({ onStop }: { onStop: () => void }) {
  const share = useShare();
  const watcher = share.status === 'live' ? share.watcher : null;
  return (
    <Panel background={C.claySoft}>
      {watcher ? (
        <>
          <View style={styles.row}><Avatar name={watcher} size={56} /><Heading>{watcher} is helping you</Heading></View>
          <View style={styles.row}><LiveDot color={C.green} /><Body color={C.ink}>{watcher} can see your screen</Body></View>
          <Body color={C.clayInk}>{watcher} will tell you where to tap. You can go to any app now; the red bar at the top shows it's still on.</Body>
        </>
      ) : (
        <View style={styles.row}><LiveDot color={C.clay} /><Heading>Getting your screen ready…</Heading></View>
      )}
      <Body color={C.clayInk}>Nothing is recorded.</Body>
      <BigButton label="Stop" color={C.red} onPress={onStop} />
    </Panel>
  );
}

// After Tap for help: say what's wrong first, then it all goes to the
// helper in one alert. The microphone is on only while "I'm listening" shows.
function Talk({ first }: { first: string }) {
  const family = useFamily();
  const { talk } = family;
  if (talk.kind === 'sending') {
    return (
      <View style={[styles.center, { marginTop: 120, gap: 16 }]}>
        <ActivityIndicator size="large" color={C.clay} />
        <Title>Sending to {first}…</Title>
      </View>
    );
  }
  if (talk.kind === 'recording') {
    return (
      <>
        <View style={styles.recording}>
          <LiveDot color={C.onClay} />
          <Text style={styles.recordingText}>{first} will hear this</Text>
        </View>
        <Title>I'm listening…</Title>
        <Text style={styles.clock}>{Math.floor(talk.seconds / 60)}:{String(talk.seconds % 60).padStart(2, '0')}</Text>
        <Body>Tap Send when you're done talking.</Body>
        <BigButton label={`Send to ${first}`} onPress={finishTalking} />
      </>
    );
  }
  return (
    <>
      <PopIn>
        <View style={styles.row}><Avatar name={first} size={56} /><Heading size={30}>What do you need help with?</Heading></View>
      </PopIn>
      <PopIn delay={200} style={[styles.center, { gap: 16, marginTop: 24 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tell ${first} what's wrong`}
          disabled={family.busy}
          onPress={startTalking}
          style={({ pressed }) => [styles.mic, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={styles.micInner}>
            <View style={styles.micHead} />
            <View style={styles.micCup} />
            <View style={styles.micStand} />
          </View>
        </Pressable>
        <Text style={styles.micLabel}>Tell {first}{'\n'}what's wrong</Text>
        <Body>Tap and talk. Only {first} will hear it.</Body>
      </PopIn>
      <View style={{ height: 24 }} />
      <QuietButton label={`Just ask ${first} to call me`} onPress={askWithoutTalking} disabled={family.busy} />
      <QuietButton label="Back" onPress={leaveTalk} />
    </>
  );
}

function Scam() {
  const family = useFamily();
  const [text, setText] = useState('');
  const latest = family.scamChecks[0];
  const helpers = names(family.helperNames);
  return (
    <>
      <Title>Is this a scam?</Title>
      {latest ? <LatestAnswer check={latest} helpers={helpers} /> : null}
      <Body>Paste or type the message you got. Tip: in Messages, press and hold a text, tap Copy, then come back here.</Body>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="The message goes here"
        placeholderTextColor={C.muted}
        accessibilityLabel="The message"
        style={styles.input}
      />
      <BigButton
        label={`Send to ${helpers}`}
        disabled={!text.trim()}
        busy={family.busy}
        onPress={() => { sendScamCheck(text); setText(''); }}
      />
      <QuietButton label="Back to home" onPress={goHome} />
    </>
  );
}

function LatestAnswer({ check, helpers }: { check: ScamCheck; helpers: string }) {
  if (!check.verdict) {
    return (
      <Panel background={C.infoSoft}>
        <Heading size={24}>Waiting for {helpers} to answer…</Heading>
        <Body color={C.ink}>Don't tap any links or pay anything until they do.</Body>
        <Quote text={check.text} />
      </Panel>
    );
  }
  if (check.verdict === 'safe') {
    return (
      <Panel background={C.greenSoft}>
        <Text style={[styles.verdict, { color: C.green }]}>{check.answeredByName}: It's safe</Text>
        {check.note ? <Body color={C.ink}>"{check.note}"</Body> : null}
        <Quote text={check.text} />
      </Panel>
    );
  }
  const headline = check.verdict === 'scam' ? "Scam, don't tap it" : "Not sure, don't tap it yet";
  return (
    <Panel background={C.redSoft}>
      <Text style={[styles.verdict, { color: C.redInk }]}>{check.answeredByName}: {headline}</Text>
      {check.note ? <Body color={C.redInk}>"{check.note}"</Body> : null}
      <Quote text={check.text} />
    </Panel>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ground },
  page: { padding: 22, paddingBottom: 40, gap: 20 },
  tag: { alignSelf: 'center', color: C.muted, fontSize: 14 },
  diary: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 15, color: C.ink },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  relation: { fontSize: 21, fontWeight: '800', color: C.olive, marginTop: 8 },
  strong: { fontSize: 21, lineHeight: 28, fontWeight: '700', color: C.clayInk },
  picture: { flexDirection: 'row', alignItems: 'center', gap: 20, backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 14 },
  emoji: { fontSize: 44 },
  pictureLabel: { fontSize: 28, fontWeight: '700', color: C.ink, flexShrink: 1 },
  day: { fontSize: 22, fontWeight: '700', color: C.olive },
  date: { fontFamily: ROUNDED, fontSize: 40, lineHeight: 46, color: C.ink },
  greeting: { fontSize: 22, lineHeight: 28, color: C.muted, marginTop: 6 },
  help: {
    backgroundColor: C.clay, borderRadius: 40, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20,
    shadowColor: C.ink, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
  },
  helpTitle: { fontFamily: ROUNDED, fontSize: 40, lineHeight: 46, color: C.onClay, textAlign: 'center' },
  helpFrom: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: C.onClay, textAlign: 'center' },
  scamButton: {
    backgroundColor: C.sand, borderRadius: 40, minHeight: 128, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 16, padding: 20,
  },
  scamTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: C.ink },
  scamSub: { fontSize: 18, color: C.muted },
  recording: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.red, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 14 },
  recordingText: { fontSize: 22, fontWeight: '800', color: C.onClay, flexShrink: 1 },
  clock: { fontSize: 30, fontWeight: '800', color: C.ink, textAlign: 'center' },
  mic: { width: 170, height: 170, borderRadius: 85, backgroundColor: C.claySoft, padding: 16 },
  micInner: { flex: 1, borderRadius: 69, backgroundColor: C.clay, alignItems: 'center', justifyContent: 'center' },
  micHead: { width: 18, height: 34, borderRadius: 9, backgroundColor: C.onClay },
  micCup: { width: 38, height: 22, marginTop: -14, borderBottomLeftRadius: 19, borderBottomRightRadius: 19, borderWidth: 5, borderTopWidth: 0, borderColor: C.onClay },
  micStand: { width: 5, height: 10, backgroundColor: C.onClay },
  micLabel: { fontFamily: ROUNDED, fontSize: 30, lineHeight: 36, color: C.ink, textAlign: 'center' },
  input: {
    minHeight: 140, borderWidth: 2, borderColor: C.line, borderRadius: 18, backgroundColor: C.card, padding: 14,
    fontSize: 20, color: C.ink, textAlignVertical: 'top',
  },
  verdict: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  hidden: { width: 1, height: 1, opacity: 0 },
});
