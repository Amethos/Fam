// Prints the smoothness numbers of the latest screen shares, so a test can be
// read back afterwards (run by .github/workflows/share-numbers.yml). Numbers
// only: no names, no ids, nothing from anyone's screen.
import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const count = Math.min(20, Math.max(1, Number(process.argv[2]) || 5));
const db = getFirestore(initializeApp({ projectId: "my-tech-kid" }));

const shares = [];
for (const circle of (await db.collection("circles").get()).docs) {
  const snap = await circle.ref.collection("screenShares").orderBy("createdAt", "desc").limit(count).get();
  shares.push(...snap.docs.map((d) => d.data()));
}
shares.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

const why = { c: "phone busy", b: "network", o: "other", n: "", "-": "?" };
for (const s of shares.slice(0, count)) {
  const q = s.quality;
  console.log(`\n=== ${s.createdAt?.toDate?.().toISOString() ?? "?"} · ${s.status ?? "?"}`);
  if (!q) { console.log("no numbers saved (older helper app, or the page closed early)"); continue; }
  console.log(`${q.seconds}s · ${q.relay ? "relay" : "direct"} · ${q.codec} · ${q.enc ?? "encoder ?"} · avg ${q.fps} fps · ${q.kbps} kbps · ${q.lossPct}% lost · ${q.freezes} freezes · ${q.height}p`);
  if (!q.timeline) continue;
  console.log("sec   ms  shown  sent  height  moving  held back by");
  for (const p of q.timeline.split(";").filter(Boolean)) {
    const [t, ms, shown, sent, h, w, m] = p.split(",");
    console.log(`${t.padStart(4)} ${ms.padStart(4)} ${shown.padStart(6)} ${sent.padStart(5)} ${h.padStart(7)}  ${m === "1" ? "  yes " : "      "}  ${why[w] ?? w}`);
  }
}
