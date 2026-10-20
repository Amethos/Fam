import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { qrSvg } from "./qr.js";

test("draws every dark square of the code, with a white border", () => {
  const url = "https://my-tech-kid.web.app/join?c=abc&i=def&t=0123456789";
  const svg = qrSvg(url, "Setup code");
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const dark = modules.data.filter(Boolean).length;
  assert.equal((svg.match(/h1v1h-1z/g) ?? []).length, dark);
  assert.match(svg, new RegExp(`viewBox="0 0 ${modules.size + 8} ${modules.size + 8}"`));
  assert.match(svg, /fill="#FFFFFF"/);
  assert.match(svg, /aria-label="Setup code"/);
});
