// What kind of phone the helper is on, and the best way to help each parent.

export function thisDevice(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0) {
  // iPads report themselves as Macs; a touch screen gives them away.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ipad || /iPhone|iPod/.test(ua)) {
    // Newer Safari freezes "OS 18_6" in the agent string, so take the higher of
    // that and Safari's own version.
    const os = Number(ua.match(/OS (\d+)_/)?.[1] ?? 0);
    const safari = Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0);
    const version = Math.max(os, safari);
    return { platform: "ios", model: ipad ? "iPad" : "iPhone", ...(version ? { osVersion: version } : {}) };
  }
  const android = ua.match(/Android (\d+)/);
  if (android) return { platform: "android", osVersion: Number(android[1]) };
  return { platform: "computer" };
}

// "app": Mom shows her screen from the My Tech Kid app (Android).
// "facetime-control": FaceTime screen sharing, and the helper can tap too
//   (both on iOS 18 or newer).
// "facetime-view": FaceTime screen sharing to watch and talk her through it.
// null: we don't know her phone yet.
export function helpMethod(parent, helper) {
  if (parent?.platform === "android") return "app";
  if (parent?.platform === "ios") {
    const canTap = helper?.platform === "ios" && (helper.osVersion ?? 0) >= 18 && (parent.osVersion ?? 0) >= 18;
    return canTap ? "facetime-control" : "facetime-view";
  }
  return null;
}

export function deviceLabel(d) {
  if (!d) return "";
  const os = { android: "Android", ios: "iOS" }[d.platform];
  return [d.model, os && d.osVersion ? `${os} ${d.osVersion}` : os].filter(Boolean).join(" · ");
}
