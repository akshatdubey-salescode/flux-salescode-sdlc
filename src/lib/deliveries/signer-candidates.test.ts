import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeLike, likePatterns, nameFromEmail, shapeSignerCandidates, validateSignerQuery } from "./signer-candidates";

describe("signer candidate search text", () => {
  it("accepts 2..60 characters of the allowed set and splits it into lower-case words", () => {
    assert.deepEqual(validateSignerQuery("  Aakash Patel "), { ok: true, terms: ["aakash", "patel"] });
    assert.deepEqual(validateSignerQuery("aa"), { ok: true, terms: ["aa"] });
    assert.deepEqual(validateSignerQuery("a.b+c@x-y.com"), { ok: true, terms: ["a.b+c@x-y.com"] });
  });
  it("refuses too short, too long, odd characters, too many words and non-strings", () => {
    for (const bad of ["", " a ", "x".repeat(61), "a'b", "a;b", "a,b", "a/b", "a\\b", "(x)", "a b c d e", undefined, 5, null]) {
      assert.equal(validateSignerQuery(bad).ok, false, String(bad));
    }
    assert.equal(validateSignerQuery("x".repeat(60)).ok, true);
  });
});

describe("LIKE patterns", () => {
  it("escapes the wildcards so they only mean themselves", () => {
    assert.equal(escapeLike("a_b%c\\d"), "a\\_b\\%c\\\\d");
    assert.deepEqual(likePatterns(["a_b", "x%"]), ["%a\\_b%", "%x\\%%"]);
  });
});

describe("candidate shaping", () => {
  it("derives a display name from the local part", () => {
    assert.equal(nameFromEmail("aakash.patel@salescode.ai"), "Aakash Patel");
    assert.equal(nameFromEmail("dev+tctest@salescode.ai"), "Dev");
    assert.equal(nameFromEmail("j_doe-smith@x.com"), "J Doe Smith");
    assert.equal(nameFromEmail("12345@x.com"), "12345@x.com");
  });
  it("sorts, lower-cases, de-duplicates and caps at 20", () => {
    const rows = [{ id: "B@x.com" }, { id: "a@x.com" }, { id: "b@x.com" }, { id: " " }];
    assert.deepEqual(shapeSignerCandidates(rows).map((c) => c.email), ["a@x.com", "b@x.com"]);
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `u${String(i).padStart(2, "0")}@x.com` }));
    assert.equal(shapeSignerCandidates(many).length, 20);
    assert.deepEqual(Object.keys(shapeSignerCandidates(rows)[0]).sort(), ["email", "name"]);
  });
});
