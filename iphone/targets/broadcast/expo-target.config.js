// Apple's screen broadcast add-on: when Mom taps Start Broadcast, iOS runs
// SampleHandler with her screen, and it passes the pictures to the app
// (react-native-webrtc's ScreenCapturer) through a socket in the shared
// app group. The app sends them on to her helper.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'broadcast-upload',
  name: 'broadcast',
  displayName: 'My Tech Kid',
  bundleIdentifier: '.broadcast',
  deploymentTarget: '16.4',
  frameworks: ['ReplayKit', 'CoreImage'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
