import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OFFICE_HOURS, type OfficeHours } from "./types";
import { ageDays, formatDuration, officeMinutesBetween, salescodeMinutes } from "./time";

const ist = (s: string) => new Date(s + "+05:30");
const H = DEFAULT_OFFICE_HOURS;
const ALL: OfficeHours = { start: "00:00", end: "24:00", days: [0, 1, 2, 3, 4, 5, 6] };
const S = ist("2026-11-02T00:00");
const h = (n: number) => new Date(S.getTime() + n * 3600_000);

test("officeMinutesBetween: within a day", () => {
  assert.equal(officeMinutesBetween(ist("2026-11-02T09:00"), ist("2026-11-02T20:00"), H), 540);
});
test("officeMinutesBetween: Fri evening to Mon morning", () => {
  assert.equal(officeMinutesBetween(ist("2026-11-06T18:30"), ist("2026-11-09T10:30"), H), 60);
});
test("officeMinutesBetween: overnight is 0", () => {
  assert.equal(officeMinutesBetween(ist("2026-11-02T20:00"), ist("2026-11-03T09:00"), H), 0);
});
test("officeMinutesBetween: Saturday is 0", () => {
  assert.equal(officeMinutesBetween(ist("2026-11-07T11:00"), ist("2026-11-07T15:00"), H), 0);
});
test("officeMinutesBetween: across two days", () => {
  assert.equal(officeMinutesBetween(ist("2026-11-02T10:00"), ist("2026-11-03T19:00"), H), 1080);
});
test("officeMinutesBetween: 24:00 end supported", () => {
  assert.equal(officeMinutesBetween(h(0), h(30), ALL), 1800);
});

test("ownership: no events", () => assert.equal(salescodeMinutes(S, h(10), [], ALL), 600));
test("ownership: client stretch excluded", () => {
  const ev = [{ side: "client" as const, at: h(2) }, { side: "salescode" as const, at: h(5) }];
  assert.equal(salescodeMinutes(S, h(10), ev, ALL), 420);
});
test("ownership: out-of-order sorted", () => {
  const ev = [{ side: "salescode" as const, at: h(5) }, { side: "client" as const, at: h(2) }];
  assert.equal(salescodeMinutes(S, h(10), ev, ALL), 420);
});
test("ownership: event before start clamps", () => {
  assert.equal(salescodeMinutes(S, h(3), [{ side: "client", at: h(-1) }], ALL), 0);
});
test("ownership: event after end ignored", () => {
  assert.equal(salescodeMinutes(S, h(10), [{ side: "client", at: h(12) }], ALL), 600);
});
test("ownership: open client stretch stops at end", () => {
  assert.equal(salescodeMinutes(S, h(10), [{ side: "client", at: h(4) }], ALL), 240);
});
test("ownership: same side twice is a no-op", () => {
  const ev = [
    { side: "salescode" as const, at: h(1) },
    { side: "client" as const, at: h(2) },
    { side: "client" as const, at: h(3) },
  ];
  assert.equal(salescodeMinutes(S, h(4), ev, ALL), 120);
});
test("ownership: end <= start is 0", () => {
  assert.equal(salescodeMinutes(h(5), h(5), [], ALL), 0);
  assert.equal(salescodeMinutes(h(5), h(2), [], ALL), 0);
});
test("combined with office hours", () => {
  const ev = [
    { side: "client" as const, at: ist("2026-11-02T15:00") },
    { side: "salescode" as const, at: ist("2026-11-03T12:00") },
  ];
  assert.equal(salescodeMinutes(ist("2026-11-02T10:00"), ist("2026-11-03T19:00"), ev, H), 720);
});

test("formatDuration", () => {
  assert.equal(formatDuration(null), "–");
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(5), "5 min");
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(720), "12 hr");
  assert.equal(formatDuration(818), "13 hr 38 min");
});

test("ageDays", () => {
  assert.equal(ageDays("2026-11-16", "2026-11-20"), 4);
  assert.equal(ageDays("2026-11-20", "2026-11-20"), 0);
});
