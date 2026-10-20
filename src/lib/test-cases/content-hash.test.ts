// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/content-hash.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, sha256Hex } from "./content-hash";

const grid = [["ID", "Title"], ["TC-1", "Login works"], ["TC-2", "Logout works"]];

test("padding rows and columns and the order tabs were ticked in don't change the hash", () => {
  const a = contentHash([{ title: "A", grid }, { title: "B", grid: [["x"]] }]);
  const padded = contentHash([{ title: "B", grid: [["x", "", null], [], [""]] }, { title: "A", grid: [...grid, [], ["", ""]] }]);
  assert.equal(a, padded);
});

test("any edit to a cell, a new row, a renamed tab or a different tab set changes it", () => {
  const base = contentHash([{ title: "A", grid }]);
  assert.notEqual(base, contentHash([{ title: "A", grid: [["ID", "Title"], ["TC-1", "Login works!"], ["TC-2", "Logout works"]] }]));
  assert.notEqual(base, contentHash([{ title: "A", grid: [...grid, ["TC-3", "New"]] }]));
  assert.notEqual(base, contentHash([{ title: "A2", grid }]));
  assert.notEqual(base, contentHash([{ title: "A", grid }, { title: "B", grid }]));
});

test("cells can't be shuffled across a boundary to forge the same hash", () => {
  assert.notEqual(contentHash([{ title: "A", grid: [["ab", "c"]] }]), contentHash([{ title: "A", grid: [["a", "bc"]] }]));
  assert.notEqual(contentHash([{ title: "A", grid: [["a"], ["b"]] }]), contentHash([{ title: "A", grid: [["a", "b"]] }]));
});

test("sha256Hex is the standard digest", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(Buffer.from("abc")), sha256Hex("abc"));
});
