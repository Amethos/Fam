import { useEffect, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Image, Pressable, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';

// Warm Home, the look of Mom's app (docs/design/DESIGN.md), the same as
// android/.../ui/Screens.kt: big, calm and high-contrast. Varela Round for
// headings and the big buttons, the iPhone's own font for the rest. Text
// follows the phone's text size.

export const C = {
  ground: '#F5F0E1', card: '#FFFBF3', clay: '#A3532F', onClay: '#FFF8EE', olive: '#5C6B30', sand: '#E8DCC4',
  clayInk: '#6E3A1E', claySoft: '#F6E3D0', line: '#D9CBAE', infoSoft: '#EFE6D2',
  ink: '#3B2A20', muted: '#6B5444', green: '#1F6B45', greenSoft: '#E1EBD9',
  red: '#9C2F1E', redSoft: '#F6DDD6', redInk: '#5E1B12',
};
export const ROUNDED = 'VarelaRound-Regular';

/** Fades and settles in slowly the first time it shows (no bounce), unless Reduce Motion is on. */
export function PopIn({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) shown.setValue(1);
      else Animated.timing(shown, { toValue: 1, duration: 600, delay, useNativeDriver: true }).start();
    });
    return () => { cancelled = true; };
  }, [delay, shown]);
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={[style, { opacity: shown, transform: [{ translateY: rise }] }]}>{children}</Animated.View>;
}

/** A slow breathing dot while something is on its way. */
export function LiveDot({ color }: { color: string }) {
  const glow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(glow, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => loop?.stop();
  }, [glow]);
  return <Animated.View style={[s.dot, { backgroundColor: color, opacity: glow }]} />;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={s.title}>{children}</Text>;
}

export function Body({ children, color = C.muted, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.body, { color }, style]}>{children}</Text>;
}

export function Heading({ children, size = 26 }: { children: ReactNode; size?: number }) {
  return <Text style={[s.heading, { fontSize: size, lineHeight: size * 1.23 }]}>{children}</Text>;
}

export function BigButton({ label, onPress, color = C.clay, disabled, busy }: {
  label: string; onPress: () => void; color?: string; disabled?: boolean; busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.big, { backgroundColor: disabled ? C.line : color, opacity: pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={C.onClay} /> : <Text style={s.bigText}>{label}</Text>}
    </Pressable>
  );
}

export function QuietButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.quiet, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      <Text style={s.quietText}>{label}</Text>
    </Pressable>
  );
}

export function Panel({ background, children }: { background: string; children: ReactNode }) {
  return <View style={[s.panel, { backgroundColor: background }]}>{children}</View>;
}

/** Their helper's initial in a circle. */
export function Avatar({ name, size, onClay = false }: { name: string; size: number; onClay?: boolean }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: onClay ? C.ground : C.clay }]}>
      <Text style={{ fontFamily: ROUNDED, fontSize: size / 2.1, color: onClay ? C.clay : C.onClay }} allowFontScaling={false}>
        {name.trim().slice(0, 1).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

/** Their photo if they added one (a face is easier to spot than a letter), else their initial. */
export function Face({ name, photo, size, onClay }: { name: string; photo: string | null; size: number; onClay?: boolean }) {
  if (!photo) return <Avatar name={name} size={size} onClay={onClay} />;
  return (
    <Image
      source={{ uri: photo }}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: onClay ? 0 : 4, borderColor: C.card }}
    />
  );
}

/** The olive shield with a check mark, drawn with plain views (no icon library). */
export function Shield({ size = 44 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <View style={{
        width: size * 0.72, height: size * 0.84, borderWidth: size * 0.08, borderColor: C.olive,
        borderTopLeftRadius: size * 0.12, borderTopRightRadius: size * 0.12,
        borderBottomLeftRadius: size * 0.36, borderBottomRightRadius: size * 0.36,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: C.olive, fontSize: size * 0.4, fontWeight: '900', marginTop: -size * 0.04 }} allowFontScaling={false}>✓</Text>
      </View>
    </View>
  );
}

/** Quoted text from a message, cut short. */
export function Quote({ text }: { text: string }) {
  return <Text style={s.quote}>{text.slice(0, 300)}</Text>;
}

const s = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontFamily: ROUNDED, fontSize: 30, lineHeight: 36, color: C.ink },
  heading: { fontFamily: ROUNDED, color: C.ink, flexShrink: 1 },
  body: { fontSize: 20, lineHeight: 28 },
  big: { minHeight: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  bigText: { fontSize: 22, fontWeight: '800', color: C.onClay, textAlign: 'center' },
  quiet: {
    minHeight: 64, borderRadius: 20, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  quietText: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center' },
  panel: { borderRadius: 28, padding: 22, gap: 16 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  quote: { fontSize: 17, lineHeight: 23, color: C.muted, backgroundColor: C.card, borderRadius: 14, padding: 12, overflow: 'hidden' },
});
