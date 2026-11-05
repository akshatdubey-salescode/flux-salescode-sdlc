// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/jira-comments.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_MAX_CHARS, COMMENTS_TOTAL_BUDGET, commentsBlock, formatComments } from "./jira-comments";
import { buildUserPrompt } from "./prompt";

const adf = (t: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const c = (name: string, created: string, body: unknown) => ({ author: { accountId: name, displayName: name, emailAddress: `${name}@x.com` }, body, created });

test("comments are plain text, oldest first, with people anonymised and stable", () => {
  const r = formatComments([
    c("asha", "2026-10-22T10:00:00.000+0530", adf("Also apply this to credit notes")),
    c("rahul", "2026-10-20T09:00:00.000+0530", adf("Scope: header level only")),
    c("asha", "2026-10-25T09:00:00.000+0530", adf("Dropped the SFTP part")),
  ]);
  assert.deepEqual(r.comments.map((x) => [x.who, x.at, x.text]), [
    ["Person 1", "2026-10-20", "Scope: header level only"],
    ["Person 2", "2026-10-22", "Also apply this to credit notes"],
    ["Person 2", "2026-10-25", "Dropped the SFTP part"],
  ]);
  assert.ok(!JSON.stringify(r).includes("asha") && !JSON.stringify(r).includes("@x.com"), "no names or emails reach the model");
});

test("empty comments are skipped; long ones are cut with a marker", () => {
  const r = formatComments([c("a", "2026-10-20", adf("  ")), c("a", "2026-10-21", adf("x".repeat(COMMENT_MAX_CHARS + 500)))]);
  assert.equal(r.comments.length, 1);
  assert.ok(r.comments[0].text.endsWith("[…]"));
});

test("when there are too many for the budget the newest are kept and the rest counted", () => {
  const many = Array.from({ length: 40 }, (_, i) => c("a", `2026-09-${String(i + 1).padStart(2, "0")}`, adf("y".repeat(1000))));
  const r = formatComments(many);
  assert.ok(r.comments.reduce((n, x) => n + x.text.length, 0) <= COMMENTS_TOTAL_BUDGET);
  assert.ok(r.omitted > 0);
  assert.equal(r.comments.at(-1)!.at, "2026-09-40", "the newest comment is the last one kept");
});

test("the prompt block says what it holds, and says so when comments are missing or unavailable", () => {
  const some = commentsBlock({ comments: [{ who: "Person 1", at: "2026-10-20", text: "Scope: header only" }], omitted: 2, unavailable: false });
  assert.match(some, /<jira_comments count="1">/);
  assert.match(some, /2 older comments omitted/);
  assert.match(some, /Person 1 \(2026-10-20\): Scope: header only/);
  assert.match(commentsBlock({ comments: [], omitted: 0, unavailable: false }), /no comments/);
  assert.match(commentsBlock({ comments: [], omitted: 0, unavailable: true }), /could not be loaded/);
});

test("the user prompt carries the comments after the item, and nothing when not passed", () => {
  const base = { issue: { key: "CT-1", type: "Task", summary: "s", description: "d" }, roundNo: 1, allCases: [], cases: [], history: [] };
  const withC = buildUserPrompt({ ...base, jiraComments: { comments: [{ who: "Person 1", at: "2026-10-20", text: "Only header level" }], omitted: 0, unavailable: false } });
  assert.ok(withC.indexOf("</jira_item>") < withC.indexOf("<jira_comments"));
  assert.match(withC, /Only header level/);
  assert.ok(!buildUserPrompt(base).includes("<jira_comments"));
});
