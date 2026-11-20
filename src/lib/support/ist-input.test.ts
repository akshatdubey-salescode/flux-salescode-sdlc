import { test } from "node:test";
import assert from "node:assert/strict";
import { fromIstInputValue, toIstInputValue } from "./ist-input";

test("IST input value parses to the matching UTC instant", () => {
  assert.equal(fromIstInputValue("2026-11-20T10:30")?.toISOString(), "2026-11-20T05:00:00.000Z");
});

test("UTC instant formats as IST input value", () => {
  assert.equal(toIstInputValue("2026-11-20T05:00:00.000Z"), "2026-11-20T10:30");
  assert.equal(toIstInputValue(new Date("2026-11-20T05:00:00.000Z")), "2026-11-20T10:30");
});

test("round-trips across the IST day boundary", () => {
  // 19:00Z is 00:30 IST the next day.
  assert.equal(toIstInputValue("2026-11-19T19:00:00.000Z"), "2026-11-20T00:30");
  assert.equal(fromIstInputValue("2026-11-20T00:30")?.toISOString(), "2026-11-19T19:00:00.000Z");
  const v = "2026-03-08T02:30"; // a US DST gap; must not shift
  assert.equal(toIstInputValue(fromIstInputValue(v)!), v);
});

test("empty or malformed input is null", () => {
  assert.equal(fromIstInputValue(""), null);
  assert.equal(fromIstInputValue("2026-11-20"), null);
  assert.equal(fromIstInputValue("2026-11-20T10:30Z"), null);
  assert.equal(fromIstInputValue("2026-13-40T10:30"), null);
});
