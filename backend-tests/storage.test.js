// Checks storage.rules (pictures of the parent's screen) against the local
// emulators: npm test
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

let env;
const ctx = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext());
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const put = (uid, path, data = jpeg, contentType = "image/jpeg") => ctx(uid).storage().ref(path).put(data, { contentType });
const read = (uid, path) => ctx(uid).storage().ref(path).getMetadata();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-fam",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../storage.rules", import.meta.url), "utf8") },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "circles/c1"), {
      name: "Smiths", helperIds: ["josh"], parentIds: ["mom"],
      members: { josh: { name: "Josh", role: "helper" }, mom: { name: "Mom", role: "parent" } },
    });
  });
});

test("only the parent's own phone adds a picture, into its own folder", async () => {
  await assertSucceeds(put("mom", "circles/c1/scamShots/mom/s1.jpg"));
  await assertFails(put("josh", "circles/c1/scamShots/josh/s2.jpg"));
  await assertFails(put("josh", "circles/c1/scamShots/mom/s2.jpg"));
  await assertFails(put("stranger", "circles/c1/scamShots/stranger/s2.jpg"));
  await assertFails(put(null, "circles/c1/scamShots/mom/s2.jpg"));
});

test("a sent picture can't be replaced", async () => {
  await assertSucceeds(put("mom", "circles/c1/scamShots/mom/r1.jpg"));
  await assertFails(put("mom", "circles/c1/scamShots/mom/r1.jpg"));
});

test("only pictures, and not huge ones", async () => {
  await assertFails(put("mom", "circles/c1/scamShots/mom/s1.jpg", jpeg, "text/html"));
  await assertFails(put("mom", "circles/c1/scamShots/mom/s1.png", jpeg));
  await assertFails(put("mom", "circles/c1/scamShots/mom/s1.jpg", new Uint8Array(3 * 1024 * 1024 + 1)));
  await assertFails(put("mom", "somewhere/else.jpg"));
});

test("only the family can look at a picture", async () => {
  await assertSucceeds(put("mom", "circles/c1/scamShots/mom/f1.jpg"));
  await assertSucceeds(read("josh", "circles/c1/scamShots/mom/f1.jpg"));
  await assertSucceeds(read("mom", "circles/c1/scamShots/mom/f1.jpg"));
  await assertFails(read("stranger", "circles/c1/scamShots/mom/f1.jpg"));
  await assertFails(read(null, "circles/c1/scamShots/mom/f1.jpg"));
});
