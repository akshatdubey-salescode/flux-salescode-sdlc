// Unit tests for bucketNowForCache.
//
// `now` is passed into the analytics routes' cached fetchers, so it forms part
// of the cache key. At minute precision the key changed 60x/hour, so every
// request missed the cache and paid the full query cost. Bucketing to 15
// minutes cuts that to 4x/hour.
//
// Run: ./node_modules/.bin/tsx --test "src/lib/date-utils.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketNowForCache, NOW_CACHE_BUCKET_MINUTES } from "./date-utils";

test("the bucket width is 15 minutes", () => {
  assert.equal(NOW_CACHE_BUCKET_MINUTES, 15);
});

test("minutes floor to the enclosing quarter-hour", () => {
  assert.equal(bucketNowForCache("2026-08-20T10:00:00"), "2026-08-20T10:00:00");
  assert.equal(bucketNowForCache("2026-08-20T10:07:41"), "2026-08-20T10:00:00");
  assert.equal(bucketNowForCache("2026-08-20T10:14:59"), "2026-08-20T10:00:00");
  assert.equal(bucketNowForCache("2026-08-20T10:15:00"), "2026-08-20T10:15:00");
  assert.equal(bucketNowForCache("2026-08-20T10:29:00"), "2026-08-20T10:15:00");
  assert.equal(bucketNowForCache("2026-08-20T10:44:00"), "2026-08-20T10:30:00");
  assert.equal(bucketNowForCache("2026-08-20T10:59:59"), "2026-08-20T10:45:00");
});

test("every minute of an hour collapses to exactly 4 distinct keys", () => {
  const keys = new Set<string>();
  for (let m = 0; m < 60; m++) {
    keys.add(bucketNowForCache(`2026-08-20T13:${String(m).padStart(2, "0")}:00`));
  }
  assert.equal(keys.size, 4);
});

test("the date portion is never altered — it decides 'overdue'", () => {
  // Both ends of the day must keep their own date.
  assert.ok(bucketNowForCache("2026-08-20T00:00:00").startsWith("2026-08-20T"));
  assert.ok(bucketNowForCache("2026-08-20T23:59:59").startsWith("2026-08-20T"));
  assert.equal(bucketNowForCache("2026-08-20T23:59:59"), "2026-08-20T23:45:00");
});

test("the hour is preserved and zero-padded", () => {
  assert.equal(bucketNowForCache("2026-08-20T09:05:00"), "2026-08-20T09:00:00");
  assert.equal(bucketNowForCache("2026-08-20T00:16:00"), "2026-08-20T00:15:00");
});

test("the result is idempotent — bucketing a bucketed value is a no-op", () => {
  const once = bucketNowForCache("2026-08-20T18:52:13");
  assert.equal(bucketNowForCache(once), once);
});

test("malformed input falls back to minute precision instead of throwing", () => {
  // Previous behaviour was `raw.slice(0, 16) + ":00"`; keep that as the floor.
  assert.equal(bucketNowForCache("2026-08-20"), "2026-08-20:00");
  // 16 chars exactly, so slice(0, 16) keeps all of it.
  assert.equal(bucketNowForCache("not-a-timestamp!"), "not-a-timestamp!:00");
  assert.equal(bucketNowForCache("2026-08-20 10:07:00"), "2026-08-20 10:07:00");
  assert.equal(bucketNowForCache("2026-08-20TAB:CD:00"), "2026-08-20TAB:CD:00");
});

test("out-of-range hour or minute falls back rather than producing nonsense", () => {
  assert.equal(bucketNowForCache("2026-08-20T99:07:00"), "2026-08-20T99:07:00");
  assert.equal(bucketNowForCache("2026-08-20T10:77:00"), "2026-08-20T10:77:00");
});
