// Unit tests for attendanceWindow — the pure -trailing/+forward date-window
// arithmetic syncKekaAttendance resolves its actual Keka API pull range from.
// The rest of syncKekaAttendance touches the DB and the Keka client, so it
// isn't unit-tested here (consistent with leave-sync.ts/loc-sync.ts/every
// other DB+network sync function in this codebase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceWindow } from "./attendance-sync";

const NOW = new Date("2026-08-15T00:00:00.000Z");

test("default (no opts) → trailing 35 days inclusive of today, no forward extension", () => {
  const { from, to } = attendanceWindow(undefined, NOW);
  assert.equal(to, "2026-08-15");
  assert.equal(from, "2026-07-12"); // 35 days inclusive: today - 34
});

test("trailingDays=15, forwardDays=15 → the -15/+15 window this session's cron uses", () => {
  const { from, to } = attendanceWindow({ trailingDays: 15, forwardDays: 15 }, NOW);
  assert.equal(from, "2026-08-01"); // today - 14
  assert.equal(to, "2026-08-30"); // today + 15
});

test("trailingDays=1, no forward → from === to === today (just today)", () => {
  const { from, to } = attendanceWindow({ trailingDays: 1 }, NOW);
  assert.equal(from, "2026-08-15");
  assert.equal(to, "2026-08-15");
});

test("forwardDays alone (trailingDays defaults to 35) only extends `to`, not `from`", () => {
  const { from, to } = attendanceWindow({ forwardDays: 10 }, NOW);
  assert.equal(from, "2026-07-12"); // unaffected, same as the no-opts default
  assert.equal(to, "2026-08-25"); // today + 10
});

test("explicit from/to override trailingDays/forwardDays entirely", () => {
  const { from, to } = attendanceWindow(
    { from: "2020-01-01", to: "2020-01-31", trailingDays: 15, forwardDays: 15 },
    NOW
  );
  assert.equal(from, "2020-01-01");
  assert.equal(to, "2020-01-31");
});

test("forwardDays=0 explicitly behaves the same as omitting it", () => {
  const withZero = attendanceWindow({ forwardDays: 0 }, NOW);
  const omitted = attendanceWindow({}, NOW);
  assert.deepEqual(withZero, omitted);
});

test("window is stable across a month boundary (no off-by-one from date rollover)", () => {
  const endOfMonth = new Date("2026-02-28T00:00:00.000Z"); // 2026 is not a leap year
  const { from, to } = attendanceWindow({ trailingDays: 15, forwardDays: 15 }, endOfMonth);
  assert.equal(from, "2026-02-14");
  assert.equal(to, "2026-03-15");
});
