// A QR code as an SVG, for setting up a phone in person: Mom points her
// camera at it instead of getting a text. Dark on white with a quiet border,
// in any theme, so every phone camera can read it.
import QRCode from "qrcode";

export function qrSvg(text, label) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const pad = 4;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (modules.get(y, x)) path += `M${x + pad} ${y + pad}h1v1h-1z`;
  }
  const size = n + pad * 2;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#FFFFFF"/><path d="${path}" fill="#0F172A"/></svg>`;
}
