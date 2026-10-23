// Every piece of text that came from a person (names, scam texts, notes) goes
// through esc() before it is put into HTML.
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function initial(name) {
  return esc((String(name ?? "").trim()[0] ?? "?").toUpperCase());
}

function toDate(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
}

export function timeAgo(ts) {
  const date = toDate(ts);
  if (!date) return "just now";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return date.toLocaleDateString();
}

export function formatTime(ts) {
  const date = toDate(ts);
  return date ? date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
}

export function isPast(ts) {
  const date = toDate(ts);
  return !date || date.getTime() <= Date.now();
}

export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode: link just won't survive a reload */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* nothing to forget */ }
  },
};
