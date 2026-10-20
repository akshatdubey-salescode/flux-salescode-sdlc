// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/filenames.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTcFileName, buildTcS3Key, istDateTime, istStamp, roundLabel, safeSegment } from "./filenames";

// 2026-10-14 10:12:03 UTC is 15:42:03 IST.
const AT = new Date("2026-10-14T10:12:03Z");

test("IST stamp and round label do not depend on the server timezone", () => {
  assert.equal(istStamp(AT), "20261014-154203");
  assert.equal(roundLabel(2, AT), "Round 2, 14 Oct 2026 15:42 IST");
  assert.equal(istDateTime(AT), "14 Oct 2026 15:42 IST");
  // Crossing midnight: 20:00 UTC on the 14th is 01:30 IST on the 15th.
  assert.equal(istStamp(new Date("2026-10-14T20:00:00Z")), "20261015-013000");
});

test("file names carry project, Jira ID, feature, user and date/time", () => {
  const name = buildTcFileName({
    kind: "testcases", round: 2, project: "Coke Thainamthip", jiraKey: "CT-614",
    feature: "Dry Sampling Exclusion", user: "asha.rao@salescode.ai", at: AT,
  });
  assert.equal(name, "TCs_r2_Coke_Thainamthip_CT-614_Dry_Sampling_Exclusion_asha.rao_20261014-154203.xlsx");
});

test("kinds have distinct prefixes", () => {
  const base = { round: 1, project: "P", jiraKey: "K-1", feature: "f", user: "u", at: AT };
  assert.match(buildTcFileName({ ...base, kind: "signoff_dev" }), /^DevSignoff_/);
  assert.match(buildTcFileName({ ...base, kind: "signoff_tester" }), /^TesterSignoff_/);
  assert.match(buildTcFileName({ ...base, kind: "llm_feedback" }), /^LLMFeedback_/);
  assert.match(buildTcFileName({ ...base, kind: "reviewer_feedback" }), /^ReviewerFeedback_/);
});

test("segments are sanitised: no separators, traversal, or odd characters", () => {
  assert.equal(safeSegment("../../etc/passwd"), "etc_passwd");
  assert.equal(safeSegment("a/b\\c:d*e?f"), "a_b_c_d_e_f");
  assert.equal(safeSegment("Café Münch"), "Cafe_Munch");
  assert.equal(safeSegment("   "), "x");
  assert.equal(safeSegment("a".repeat(100), 10).length, 10);
  const key = buildTcS3Key({
    kind: "testcases", round: 1, project: "../x", jiraKey: "CT/1", feature: "a/b", user: "u@x.com", at: AT, projectKey: "CT",
  });
  assert.ok(key.startsWith("tc/CT/CT_1/"));
  assert.ok(!key.includes(".."), key);
  assert.equal(key.split("/").length, 4, "exactly tc/<project>/<jira>/<file>");
});

test("a Jira summary with dots in it still gives a storable key and a readable name", () => {
  assert.equal(safeSegment("Loading... spinner"), "Loading._spinner");
  assert.equal(safeSegment("a..b...c"), "a.b.c");
  const parts = { kind: "testcases" as const, round: 3, project: "P", jiraKey: "CT-1", feature: "Loading... spinner", user: "u@x.com", at: AT, projectKey: "CT" };
  const key = buildTcS3Key(parts);
  assert.ok(!key.includes(".."), key);
  assert.ok(buildTcFileName(parts).includes("_r3_"), "the display name keeps the round");
});

test("keys carry no round, end in a nonce, and are unique per call even within one second", () => {
  const parts = { kind: "signoff_dev" as const, round: 2, project: "P", jiraKey: "CT-1", feature: "F", user: "u@x.com", at: AT, projectKey: "CT" };
  const a = buildTcS3Key(parts);
  const b = buildTcS3Key(parts);
  assert.notEqual(a, b);
  assert.ok(!/_r\d+_/.test(a), a);
  assert.match(a, /_[0-9a-f]{8}\.xlsx$/);
  assert.equal(buildTcS3Key({ ...parts, nonce: "abcd1234" }).endsWith("_20261014-154203_abcd1234.xlsx"), true);
});
