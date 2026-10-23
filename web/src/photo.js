// The helper's photo for Mom's big button: cropped to a square, shrunk to
// 256 px and saved as a small JPEG, so it fits in the family circle record.

const SIZE = 256;
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

// Only ever put our own kind of photo into an <img src>.
export function isPhoto(src) {
  return typeof src === "string" && src.length <= 100_000 && PHOTO.test(src);
}

// The centered square of a w x h picture, as [x, y, side].
export function squareCrop(w, h) {
  const side = Math.min(w, h);
  return [Math.round((w - side) / 2), Math.round((h - side) / 2), side];
}

export async function shrinkPhoto(file) {
  // Older iPhones don't take the options; they already turn photos upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    .catch(() => createImageBitmap(file));
  const [x, y, side] = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.getContext("2d").drawImage(bitmap, x, y, side, side, 0, 0, SIZE, SIZE);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (isPhoto(url)) return url;
  }
  throw new Error("That photo didn't work. Try a different one.");
}
