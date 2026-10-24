// Apple's screen broadcast add-on: when Mom taps Start Broadcast, iOS runs
// SampleHandler with her screen for as long as the red bar shows, and
// ShareSession sends it straight to her helper (the app itself is paused
// while she's in other apps). The app hands it the share through the
// shared app group.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'broadcast-upload',
  name: 'broadcast',
  displayName: 'My Tech Kid',
  bundleIdentifier: '.broadcast',
  deploymentTarget: '16.4',
  frameworks: ['ReplayKit'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
