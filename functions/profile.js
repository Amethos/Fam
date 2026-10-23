// What a helper can change about how their family looks: the family's name
// and their own photo (shown on Mom's big "Tap for help" button).

const MAX_NAME = 40;
// A 256 px square JPEG from the web app is about 20-40 KB as text. The cap
// keeps the family circle document small, since every phone reads it.
const MAX_PHOTO = 100_000;
const PHOTO = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

// Shown exactly as typed ("Team Blue" stays "Team Blue"), minus stray spaces
// and invisible control characters.
function cleanCircleName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

// Only a small, real JPEG goes in. Anything else comes back null.
function cleanPhoto(value) {
  if (typeof value !== "string" || value.length > MAX_PHOTO) return null;
  const m = PHOTO.exec(value);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return value;
}

module.exports = { cleanCircleName, cleanPhoto, MAX_PHOTO };
