import { Image, StyleSheet, Text, View } from 'react-native';

// Placeholder until the iPhone screens are designed and approved.
// Colors and the title font follow Warm Home (docs/design/DESIGN.md).
export default function Home() {
  return (
    <View style={styles.screen}>
      <Image source={require('../../assets/images/icon.png')} style={styles.icon} />
      <Text style={styles.title}>My Tech Kid</Text>
      <Text style={styles.body}>The iPhone app is on its way.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  icon: { width: 120, height: 120, borderRadius: 28 },
  title: { fontFamily: 'VarelaRound-Regular', fontSize: 34, color: '#3B2A20' },
  body: { fontSize: 20, color: '#6B5444', textAlign: 'center' },
});
