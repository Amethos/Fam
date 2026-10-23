import { test } from "node:test";
import assert from "node:assert/strict";
import { isPhoto, squareCrop } from "./photo.js";

test("only our own small JPEG goes into a picture", () => {
  assert.ok(isPhoto("data:image/jpeg;base64,/9j/4AAQSkZJRg=="));
  assert.ok(!isPhoto('data:image/jpeg;base64,/9j/" onerror="alert(1)'));
  assert.ok(!isPhoto("javascript:alert(1)"));
  assert.ok(!isPhoto("https://example.com/a.jpg"));
  assert.ok(!isPhoto(undefined));
});

test("crops the middle square", () => {
  assert.deepEqual(squareCrop(400, 300), [50, 0, 300]);
  assert.deepEqual(squareCrop(300, 500), [0, 100, 300]);
});
