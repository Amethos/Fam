// The kind of phone a family member uses, as their app reports it. Copied into
// the circle so the helper's app can choose how to help: in-app screen
// sharing for Android, FaceTime for iPhone.

const PLATFORMS = ["android", "ios", "computer"];

function cleanDevice(d) {
  if (!d || !PLATFORMS.includes(d.platform)) return null;
  const out = { platform: d.platform };
  if (typeof d.model === "string" && d.model.trim()) out.model = d.model.trim().slice(0, 60);
  if (Number.isInteger(d.osVersion) && d.osVersion > 0 && d.osVersion < 100) out.osVersion = d.osVersion;
  return out;
}

function sameDevice(a, b) {
  return (a?.platform ?? null) === (b?.platform ?? null)
    && (a?.model ?? null) === (b?.model ?? null)
    && (a?.osVersion ?? null) === (b?.osVersion ?? null);
}

module.exports = { cleanDevice, sameDevice };
