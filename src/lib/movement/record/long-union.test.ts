/**
 * A union record of a big story (CAV-7052: 34 merged PRs, 23 release rows, 25-30 KB) is read WHOLE: the later release rows, the
 * "LIKELY TO BE MISSED" / ORDER / OPEN / UNDO / VERIFY blocks and the last PR lines are not cut, and the newest union retires the
 * per-PR records it names even when its PR list does not show their PR.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeploymentRecord } from "./parse";
import { pickNewestRecords } from "./pick";

const ROWS = [
  "Production meeting + everyone invited", "Services to deploy", "App release required?", "Code reviewed, no breakage other LOBs", "Previous data fix required?",
  "New code works with old data?", "DB change queries required?", "DB index required?", "Bundle code review required / done?", "Bundle SDK build required?",
  "Configs to add or update", "Services to restart", "UI code review required / done?", "UI index db versions update required?", "Performance tests required?",
  "Automation tests to run", "Automation suite update required?", "Features work with old data", "Beta app backward compatibility req.?", "Different designations required?",
  "Old app version testing required?", "Scenarios to be tested", "Cherry-pick + re-test effort",
];
const filler = (n: number) => `${"a long sentence about one more detail of the release that a reviewer wrote down; ".repeat(n)}end`;

function longUnion(opts: { id: number; supersedes?: string; prs?: number; padPerRow?: number }): string {
  const prs = opts.prs ?? 34;
  const pr = Array.from({ length: prs }, (_, i) => `  repo-${i % 7}#${1000 + i} master abcdef${String(i).padStart(4, "0")} change number ${i} | dev-a, approved dev-b, merged by dev-b 2026-11-0${(i % 9) + 1}`);
  const rows = ROWS.map((t, i) => `${String(i + 1).padStart(2, " ")}  ${t.padEnd(38)}  YES  ${filler(opts.padPerRow ?? 12)}`);
  return [
    `DEPLOYMENT-RECORD v3 | CAV-9 | union of ${prs} merged PRs | 2026-11-22 17:38 UTC | Claude (pr-review)`,
    `supersedes: ${opts.supersedes ?? "none"}`,
    "",
    "STATUS   HELD · NOT READY: x",
    "WHAT     a big story",
    "",
    "MERGED PRs (repo#n base merge-commit what | author, approval, merged by, date)",
    ...pr,
    "",
    ...rows,
    "",
    "LIKELY TO BE MISSED IN TESTING",
    ...Array.from({ length: 9 }, (_, i) => `  ${i + 1}. missed point number ${i + 1}: ${filler(2)}`),
    "ORDER    1 first step -> 2 second step -> 3 third step",
    "OPEN     BA: one open question",
    "UNDO     flags off",
    "VERIFY   one invoice keeps its pack size",
  ].join("\n");
}

/** How the long records are posted: the whole record inside one code block of the Jira comment (ADF). */
const inCodeBlock = (text: string) => ({ type: "doc", version: 1, content: [{ type: "codeBlock", content: [{ type: "text", text }] }] });

describe("a union record longer than 20 KB is read whole", () => {
  const body = longUnion({ id: 1, supersedes: "81439, 81440" });
  const r = parseDeploymentRecord({ id: 81791, body: inCodeBlock(body), created: "2026-11-22T17:40:00.000+0000" });
  it("is bigger than the old 20 KB cap and smaller than the new one", () => {
    assert.ok(body.length > 25_000 && body.length < 60_000, String(body.length));
  });
  it("raises no truncation warning and reads all 23 rows", () => {
    assert.ok(r);
    assert.ok(!r.warnings.some((w) => w.code === "truncated"), JSON.stringify(r.warnings.map((w) => w.code)));
    assert.equal((r.facts.releaseRows ?? []).length, 23);
  });
  it("keeps the blocks after the last row: likely missed (9), order, open, undo, verify", () => {
    assert.ok(r);
    assert.equal((r.facts.likelyMissed ?? []).length, 9);
    const labels = (r.facts.labelled ?? []).map((b) => b.label);
    for (const l of ["ORDER", "OPEN", "UNDO", "VERIFY"]) assert.ok(labels.includes(l), `${l} missing in ${labels.join(",")}`);
  });
  it("lists all 34 PRs of the MERGED block (one per line; the block used to stop at 30 lines) and the header count matches", () => {
    assert.ok(r);
    assert.equal((r.facts.covers ?? []).length, 34);
    assert.ok(!r.warnings.some((w) => w.code === "covers_count_mismatch"));
  });
});

describe("a union record names the older comments it replaces", () => {
  it("retires a per-PR record whose id is in `supersedes` even when the union's PR list does not show its PR", () => {
    const perPr = parseDeploymentRecord({
      id: 81440,
      body: "DEPLOYMENT-RECORD v1 | CAV-9 | other-repo#1343 | 2026-11-19 14:21 | Claude (pr-review)\nsupersedes: none",
      created: "2026-11-19T13:23:48.000+0000",
    });
    const union = parseDeploymentRecord({ id: 81791, body: inCodeBlock(longUnion({ id: 1, supersedes: "81439, 81440, 81441", prs: 5 })), created: "2026-11-22T17:40:00.000+0000" });
    assert.ok(perPr && union);
    assert.deepEqual(pickNewestRecords([perPr, union]).map((x) => x.comment.id), ["81791"]);
  });
  it("keeps a per-PR record the union does not name and does not list", () => {
    const perPr = parseDeploymentRecord({
      id: 81500,
      body: "DEPLOYMENT-RECORD v1 | CAV-9 | other-repo#1343 | 2026-11-19 14:21 | Claude (pr-review)\nsupersedes: none",
      created: "2026-11-19T13:23:48.000+0000",
    });
    const union = parseDeploymentRecord({ id: 81791, body: inCodeBlock(longUnion({ id: 1, supersedes: "81439", prs: 5 })), created: "2026-11-22T17:40:00.000+0000" });
    assert.ok(perPr && union);
    assert.deepEqual(pickNewestRecords([perPr, union]).map((x) => x.comment.id).sort(), ["81500", "81791"]);
  });
});
