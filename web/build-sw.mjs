// Bundles the push service worker; it must live at the site root.
import { build } from "esbuild";

await build({
  entryPoints: ["src/sw.js"],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: "dist/firebase-messaging-sw.js",
});
