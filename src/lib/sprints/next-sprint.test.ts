import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  deriveNextSprint,
  incrementSprintName,
  isNewSprintSpecReady,
  parseNewSprintSpec,
  sprintLengthDays,
} from "./next-sprint";

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-08-23", 1), "2026-08-24");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // leap year
});

test("sprintLengthDays counts inclusively", () => {
  assert.equal(sprintLengthDays("2026-08-04", "2026-08-04"), 1);
  assert.equal(sprintLengthDays("2026-08-04", "2026-08-23"), 20);
});

test("incrementSprintName bumps the last number in the name", () => {
  assert.equal(incrementSprintName("Demo 2"), "Demo 3");
  assert.equal(incrementSprintName("Sprint 9"), "Sprint 10");
  assert.equal(incrementSprintName("Demo 2 - WHoleSaler App"), "Demo 3 - WHoleSaler App");
  assert.equal(incrementSprintName("Q3 Sprint 11"), "Q3 Sprint 12");
});

test("incrementSprintName keeps zero-padding until the number outgrows it", () => {
  assert.equal(incrementSprintName("Sprint 09"), "Sprint 10");
  assert.equal(incrementSprintName("Sprint 007"), "Sprint 008");
  assert.equal(incrementSprintName("Sprint 99"), "Sprint 100");
});

test("incrementSprintName returns empty for a name with no number to bump", () => {
  // No sensible successor exists, and inventing "Hardening Sprint 2" would be
  // a guess the user never made — the dialog asks for a name instead.
  assert.equal(incrementSprintName("Hardening Sprint"), "");
  assert.equal(incrementSprintName(""), "");
});

test("deriveNextSprint continues the cadence from the day after this sprint ends", () => {
  // The real CPE case: a 20-day sprint ending 2026-08-23.
  assert.deepEqual(deriveNextSprint({ name: "Demo 2", startDate: "2026-08-04", endDate: "2026-08-23" }), {
    name: "Demo 3",
    startDate: "2026-08-24",
    endDate: "2026-09-12",
  });
});

test("deriveNextSprint preserves a two-week cadence across a month boundary", () => {
  assert.deepEqual(deriveNextSprint({ name: "Sprint 4", startDate: "2026-08-24", endDate: "2026-09-06" }), {
    name: "Sprint 5",
    startDate: "2026-09-07",
    endDate: "2026-09-20",
  });
});

test("deriveNextSprint leaves the name blank when it can't be derived", () => {
  const next = deriveNextSprint({ name: "Hardening", startDate: "2026-08-04", endDate: "2026-08-08" });
  assert.equal(next.name, "");
  assert.equal(next.startDate, "2026-08-09");
  assert.equal(next.endDate, "2026-08-13");
  // …and that spec must not be submittable until a name is typed.
  assert.equal(isNewSprintSpecReady(next), false);
});

test("parseNewSprintSpec accepts a valid spec and trims the name", () => {
  const out = parseNewSprintSpec({ name: "  Demo 3 ", startDate: "2026-08-24", endDate: "2026-09-12" });
  assert.deepEqual(out, { ok: true, spec: { name: "Demo 3", startDate: "2026-08-24", endDate: "2026-09-12" } });
});

test("parseNewSprintSpec rejects bad input the same way the create route does", () => {
  const cases: unknown[] = [
    null,
    "Demo 3",
    { name: "", startDate: "2026-08-24", endDate: "2026-09-12" },
    { name: "   ", startDate: "2026-08-24", endDate: "2026-09-12" },
    { name: "Demo 3", startDate: "24-08-2026", endDate: "2026-09-12" },
    { name: "Demo 3", startDate: "2026-02-30", endDate: "2026-09-12" },
    { name: "Demo 3", startDate: "2026-08-24" },
    { name: "Demo 3", startDate: "2026-09-12", endDate: "2026-08-24" }, // end before start
  ];
  for (const input of cases) {
    assert.equal(parseNewSprintSpec(input).ok, false, `should have rejected ${JSON.stringify(input)}`);
  }
});

test("a single-day sprint yields a single-day successor", () => {
  assert.deepEqual(deriveNextSprint({ name: "Spike 1", startDate: "2026-08-04", endDate: "2026-08-04" }), {
    name: "Spike 2",
    startDate: "2026-08-05",
    endDate: "2026-08-05",
  });
});
