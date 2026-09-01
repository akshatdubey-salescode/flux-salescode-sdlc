// Unit tests for filterPeopleProjects — the People & Projects view's search
// box and department multiselect. No filters must mean no change, so the
// default view (and its Excel export) always shows the full query result.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/views/people-projects/filter-people-projects.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPeopleProjects } from "./filter";
import type { PersonProjectsRow } from "./data";

function person(
  name: string,
  email: string,
  department: string | null,
  projects: { name: string; key: string }[]
): PersonProjectsRow {
  return {
    email,
    name,
    department,
    jobTitle: null,
    managerName: null,
    projects: projects.map((p, i) => ({
      projectId: `${email}-${i}`,
      projectName: p.name,
      projectKey: p.key,
      issueCount: 1,
      openCount: 1,
      completedInWindow: 0,
      p1Bugs: 0,
      p2Bugs: 0,
      p3Bugs: 0,
      bugTotal: 0,
    })),
    totalIssues: projects.length,
    totalOpen: projects.length,
    totalP1Bugs: 0,
    totalP2Bugs: 0,
    totalP3Bugs: 0,
    totalBugs: 0,
    locNet: null,
    locAdditions: null,
    locDeletions: null,
    daysPresent: null,
    daysAbsent: null,
    workingDays: null,
    avgEffectiveHours: null,
  };
}

const rows = [
  person("Aadish Jain", "aadish.jain@salescode.ai", "Technology", [
    { name: "CavinKare COE", key: "CAV" },
    { name: "Promo Service", key: "PROM" },
  ]),
  person("Priya Sharma", "priya.sharma@salescode.ai", "Quality Assurance", [
    { name: "Heritage Foods COE", key: "HFC" },
  ]),
  person("Bot Account", "bot@salescode.ai", null, [
    { name: "Promo Service", key: "PROM" },
  ]),
];

test("no search and no departments returns the rows unchanged", () => {
  assert.deepEqual(filterPeopleProjects(rows, "", []), rows);
  assert.deepEqual(filterPeopleProjects(rows, "   "), rows);
});

test("search matches person name case-insensitively", () => {
  const result = filterPeopleProjects(rows, "aadish");
  assert.deepEqual(
    result.map((r) => r.email),
    ["aadish.jain@salescode.ai"]
  );
});

test("search matches email and department", () => {
  assert.equal(filterPeopleProjects(rows, "priya.sharma@")[0].name, "Priya Sharma");
  assert.equal(filterPeopleProjects(rows, "quality")[0].name, "Priya Sharma");
});

test("search matches project name and project key, keeping the whole person row", () => {
  const byName = filterPeopleProjects(rows, "promo");
  assert.deepEqual(
    byName.map((r) => r.name).sort(),
    ["Aadish Jain", "Bot Account"]
  );
  // The matching person keeps ALL their projects, not just the matching one.
  assert.equal(byName.find((r) => r.name === "Aadish Jain")?.projects.length, 2);

  const byKey = filterPeopleProjects(rows, "hfc");
  assert.deepEqual(byKey.map((r) => r.name), ["Priya Sharma"]);
});

test("search with no match returns an empty list", () => {
  assert.deepEqual(filterPeopleProjects(rows, "does-not-exist"), []);
});

test("department multiselect keeps only people in the selected departments", () => {
  const one = filterPeopleProjects(rows, "", ["Technology"]);
  assert.deepEqual(one.map((r) => r.name), ["Aadish Jain"]);

  const two = filterPeopleProjects(rows, "", ["Technology", "Quality Assurance"]);
  assert.deepEqual(
    two.map((r) => r.name).sort(),
    ["Aadish Jain", "Priya Sharma"]
  );
});

test("department filter is case-insensitive and excludes people with no department", () => {
  const result = filterPeopleProjects(rows, "", ["technology"]);
  assert.deepEqual(result.map((r) => r.name), ["Aadish Jain"]);
  // "Bot Account" has department null — never matches any department selection.
  assert.ok(!result.some((r) => r.name === "Bot Account"));
});

test("search and department filters combine (AND)", () => {
  // "promo" alone matches Aadish and Bot; restricting to Technology leaves Aadish.
  const result = filterPeopleProjects(rows, "promo", ["Technology"]);
  assert.deepEqual(result.map((r) => r.name), ["Aadish Jain"]);
  // Same search restricted to a department with no promo people → empty.
  assert.deepEqual(filterPeopleProjects(rows, "promo", ["Quality Assurance"]), []);
});
