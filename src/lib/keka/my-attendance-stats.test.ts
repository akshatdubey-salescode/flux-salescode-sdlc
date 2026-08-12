// Unit tests for summarizeAttendance — the pure "days present / days absent /
// avg hours" arithmetic over a raw attendance-row window.
// Run: ./node_modules/.bin/tsx --test src/lib/keka/my-attendance-stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAttendance } from "./my-attendance-stats";

test("empty window → zero counts, null average", () => {
  assert.deepEqual(summarizeAttendance([]), {
    daysPresent: 0,
    daysAbsent: 0,
    avgEffectiveHours: null,
  });
});

test("a normal working day with logged hours counts as present", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8, isAbsent: false },
  ]);
  assert.equal(summary.daysPresent, 1);
  assert.equal(summary.daysAbsent, 0);
  assert.equal(summary.avgEffectiveHours, 8);
});

test("isAbsent=true counts toward daysAbsent, not daysPresent", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: null, isAbsent: true },
  ]);
  assert.equal(summary.daysPresent, 0);
  assert.equal(summary.daysAbsent, 1);
});

test("a weekly-off/holiday row (!isAbsent, no hours) counts toward neither", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-09", totalEffectiveHours: 0, isAbsent: false },
    { attendanceDate: "2026-08-08", totalEffectiveHours: null, isAbsent: false },
  ]);
  assert.equal(summary.daysPresent, 0);
  assert.equal(summary.daysAbsent, 0);
  assert.equal(summary.avgEffectiveHours, null);
});

test("average only considers days with real logged hours, rounded to 1 decimal", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8.25, isAbsent: false },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 7.5, isAbsent: false },
    { attendanceDate: "2026-08-08", totalEffectiveHours: 0, isAbsent: false }, // excluded
    { attendanceDate: "2026-08-07", totalEffectiveHours: null, isAbsent: true }, // excluded
  ]);
  assert.equal(summary.daysPresent, 2);
  assert.equal(summary.daysAbsent, 1);
  assert.equal(summary.avgEffectiveHours, 7.9); // (8.25 + 7.5) / 2 = 7.875 -> 7.9
});

test("a mixed realistic window", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8, isAbsent: false },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 6.5, isAbsent: false },
    { attendanceDate: "2026-08-08", totalEffectiveHours: null, isAbsent: true },
    { attendanceDate: "2026-08-07", totalEffectiveHours: 0, isAbsent: false },
    { attendanceDate: "2026-08-06", totalEffectiveHours: 9, isAbsent: false },
  ]);
  assert.equal(summary.daysPresent, 3);
  assert.equal(summary.daysAbsent, 1);
  assert.equal(summary.avgEffectiveHours, 7.8); // (8 + 6.5 + 9) / 3 = 7.8333 -> 7.8
});

test("every row absent → daysPresent 0, avg null, daysAbsent = row count", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: null, isAbsent: true },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 0, isAbsent: true },
    { attendanceDate: "2026-08-08", totalEffectiveHours: null, isAbsent: true },
  ]);
  assert.equal(summary.daysPresent, 0);
  assert.equal(summary.daysAbsent, 3);
  assert.equal(summary.avgEffectiveHours, null);
});

test("every row present → daysAbsent 0, avg over the full window", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8, isAbsent: false },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 8, isAbsent: false },
  ]);
  assert.equal(summary.daysPresent, 2);
  assert.equal(summary.daysAbsent, 0);
  assert.equal(summary.avgEffectiveHours, 8);
});

test("a negative hours value (sync anomaly) is excluded from present and from the average", () => {
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: -1, isAbsent: false },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 8, isAbsent: false },
  ]);
  assert.equal(summary.daysPresent, 1);
  assert.equal(summary.avgEffectiveHours, 8);
});

test("exact half-decimal average rounds up, not to even (round-half-away-from-zero, not banker's)", () => {
  // (8.1 + 7.6) / 2 = 7.85 -> *10 = 78.5 -> round -> 79 -> 7.9
  const summary = summarizeAttendance([
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8.1, isAbsent: false },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 7.6, isAbsent: false },
  ]);
  assert.equal(summary.avgEffectiveHours, 7.9);
});

test("row order does not affect the result — same rows, reversed", () => {
  const rows = [
    { attendanceDate: "2026-08-06", totalEffectiveHours: 9, isAbsent: false },
    { attendanceDate: "2026-08-07", totalEffectiveHours: 0, isAbsent: false },
    { attendanceDate: "2026-08-08", totalEffectiveHours: null, isAbsent: true },
    { attendanceDate: "2026-08-09", totalEffectiveHours: 6.5, isAbsent: false },
    { attendanceDate: "2026-08-10", totalEffectiveHours: 8, isAbsent: false },
  ];
  const forward = summarizeAttendance(rows);
  const reversed = summarizeAttendance([...rows].reverse());
  assert.deepEqual(forward, reversed);
});

test("a full 30-day window with a realistic mix of working/off/absent days", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({
      attendanceDate: `2026-07-${String(i + 1).padStart(2, "0")}`,
      totalEffectiveHours: 8,
      isAbsent: false,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      attendanceDate: `2026-07-${String(21 + i).padStart(2, "0")}`,
      totalEffectiveHours: 0,
      isAbsent: false,
    })), // weekly-offs
    ...Array.from({ length: 5 }, (_, i) => ({
      attendanceDate: `2026-07-${String(26 + i).padStart(2, "0")}`,
      totalEffectiveHours: null,
      isAbsent: true,
    })),
  ];
  const summary = summarizeAttendance(rows);
  assert.equal(summary.daysPresent, 20);
  assert.equal(summary.daysAbsent, 5);
  assert.equal(summary.avgEffectiveHours, 8);
});
