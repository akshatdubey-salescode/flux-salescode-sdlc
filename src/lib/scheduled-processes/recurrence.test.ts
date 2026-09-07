import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  computeNextRunOn,
  dayOfWeekOf,
  firstRunOn,
  istToday,
  nextRunAfter,
} from "./recurrence";
import { SCHEDULE_FREQUENCY_VALUES } from "./types";

// 2026-09-07 is a Monday; every weekly case below is anchored to it.
const MONDAY = "2026-09-07";

test("daily advances one calendar day, across month and year ends", () => {
  assert.equal(computeNextRunOn({ frequency: "daily" }, MONDAY), "2026-09-08");
  assert.equal(computeNextRunOn({ frequency: "daily" }, "2026-09-30"), "2026-10-01");
  assert.equal(computeNextRunOn({ frequency: "daily" }, "2026-12-31"), "2027-01-01");
});

test("weekly on the same weekday means next week, not today", () => {
  assert.equal(dayOfWeekOf(MONDAY), 1);
  assert.equal(computeNextRunOn({ frequency: "weekly", dayOfWeek: 1 }, MONDAY), "2026-09-14");
});

test("weekly finds the next occurrence 1–6 days out", () => {
  // Tuesday is tomorrow; Sunday is six days off.
  assert.equal(computeNextRunOn({ frequency: "weekly", dayOfWeek: 2 }, MONDAY), "2026-09-08");
  assert.equal(computeNextRunOn({ frequency: "weekly", dayOfWeek: 0 }, MONDAY), "2026-09-13");
});

test("monthly picks this month when the day is still ahead, next month once it isn't", () => {
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 15 }, "2026-09-07"), "2026-09-15");
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 15 }, "2026-09-15"), "2026-10-15");
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 1 }, "2026-12-15"), "2027-01-01");
});

// The bug this prevents: a "31st of the month" schedule silently skipping
// every short month instead of landing on its last day.
test("monthly clamps to the last day of a shorter month, leap years included", () => {
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 31 }, "2026-01-31"), "2026-02-28");
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 31 }, "2028-01-31"), "2028-02-29");
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 31 }, "2026-04-15"), "2026-04-30");
});

test("a clamped month still advances — Feb 28 rolls to Mar 31, never back to Feb", () => {
  assert.equal(computeNextRunOn({ frequency: "monthly", dayOfMonth: 31 }, "2026-02-28"), "2026-03-31");
});

// The invariant the midnight loop leans on: advancing from the day just sent
// can never return that same day, so one night's run can't send twice.
test("every cadence returns a day strictly after the one handed in", () => {
  const days = ["2026-01-31", "2026-02-28", "2026-09-07", "2026-12-31"];
  const specs = [
    { frequency: "daily" as const },
    ...[0, 1, 6].map((dayOfWeek) => ({ frequency: "weekly" as const, dayOfWeek })),
    ...[1, 15, 28, 31].map((dayOfMonth) => ({ frequency: "monthly" as const, dayOfMonth })),
  ];
  for (const day of days) {
    for (const spec of specs) {
      const next = computeNextRunOn(spec, day);
      assert.ok(next > day, `${spec.frequency} from ${day} returned ${next}`);
    }
  }
});

test("every frequency value in the enum is handled", () => {
  for (const frequency of SCHEDULE_FREQUENCY_VALUES) {
    const next = computeNextRunOn({ frequency, dayOfWeek: 1, dayOfMonth: 1 }, MONDAY);
    assert.match(next, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("a next run past the end date ends the schedule instead of parking it", () => {
  assert.deepEqual(
    nextRunAfter({ frequency: "daily" }, MONDAY, "2026-09-08"),
    { nextRunOn: "2026-09-08" }
  );
  assert.deepEqual(nextRunAfter({ frequency: "daily" }, MONDAY, "2026-09-07"), { ended: true });
  assert.deepEqual(
    nextRunAfter({ frequency: "weekly", dayOfWeek: 1 }, MONDAY, "2026-09-10"),
    { ended: true }
  );
});

test("a schedule created today first sends at the next occurrence, never today", () => {
  assert.deepEqual(firstRunOn({ frequency: "daily" }, MONDAY), { nextRunOn: "2026-09-08" });
  assert.deepEqual(
    firstRunOn({ frequency: "weekly", dayOfWeek: 1 }, MONDAY),
    { nextRunOn: "2026-09-14" }
  );
  assert.deepEqual(
    firstRunOn({ frequency: "monthly", dayOfMonth: 7 }, MONDAY),
    { nextRunOn: "2026-10-07" }
  );
});

// Same trap as istNowStr: a UTC "today" reports yesterday until 05:30 IST, so
// a schedule due today would look due tomorrow and mail a day late.
test("istToday resolves the IST calendar day, not the UTC one", () => {
  assert.equal(istToday(new Date("2026-09-07T19:00:00Z")), "2026-09-08");
  assert.equal(istToday(new Date("2026-09-07T12:00:00Z")), "2026-09-07");
});

test("addDays is UTC-based, so it never drifts on a DST boundary", () => {
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
});
