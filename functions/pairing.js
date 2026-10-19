// Pure helpers for invite pairing, kept separate so they can be unit tested.

const crypto = require("node:crypto");

// Shown on both phones during pairing. Everyday things that are easy to say
// out loud and hard to confuse with each other.
const PICTURES = [
  { key: "apple", label: "Apple", emoji: "🍎" },
  { key: "bicycle", label: "Bicycle", emoji: "🚲" },
  { key: "moon", label: "Moon", emoji: "🌙" },
  { key: "dog", label: "Dog", emoji: "🐶" },
  { key: "cat", label: "Cat", emoji: "🐱" },
  { key: "tree", label: "Tree", emoji: "🌳" },
  { key: "house", label: "House", emoji: "🏠" },
  { key: "car", label: "Car", emoji: "🚗" },
  { key: "fish", label: "Fish", emoji: "🐟" },
  { key: "flower", label: "Flower", emoji: "🌻" },
  { key: "sun", label: "Sun", emoji: "☀️" },
  { key: "boat", label: "Boat", emoji: "⛵" },
  { key: "key", label: "Key", emoji: "🔑" },
  { key: "guitar", label: "Guitar", emoji: "🎸" },
  { key: "banana", label: "Banana", emoji: "🍌" },
  { key: "umbrella", label: "Umbrella", emoji: "☂️" },
  { key: "cake", label: "Cake", emoji: "🎂" },
  { key: "train", label: "Train", emoji: "🚆" },
  { key: "star", label: "Star", emoji: "⭐" },
  { key: "horse", label: "Horse", emoji: "🐴" },
  { key: "pizza", label: "Pizza", emoji: "🍕" },
  { key: "book", label: "Book", emoji: "📘" },
  { key: "bell", label: "Bell", emoji: "🔔" },
  { key: "rocket", label: "Rocket", emoji: "🚀" },
];

// How the helper knows the person they're inviting. The helper picks one when
// adding someone; the other phone is shown the matching word for the helper
// ("Josh, your grandchild") so it can tell whether that sounds right.
const RELATIONSHIPS = {
  parent: "your child",
  grandparent: "your grandchild",
  partner: "your partner",
  relative: "your relative",
  friend: "your friend",
  neighbor: "your neighbor",
  other: null,
};

function cleanRelationship(value) {
  const key = String(value ?? "");
  return Object.hasOwn(RELATIONSHIPS, key) ? key : "other";
}

function pickPictures(count, randomInt = crypto.randomInt) {
  const pool = [...PICTURES];
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(pool.splice(randomInt(pool.length), 1)[0]);
  return picked;
}

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { PICTURES, RELATIONSHIPS, cleanRelationship, pickPictures, newToken, hashToken };
