// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/notify.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAssignedEmail, buildDecisionEmail, escapeHtml, sendEmail } from "./notify";

const base = {
  issueKey: "CT-614",
  issueSummary: "Dry <Sampling> & Exclusion",
  projectName: "Coke Thainamthip",
  roundLabel: "Round 2, 14 Oct 2026 15:42 IST",
  url: "http://localhost:3000/test-cases/abc",
};

test("user-supplied text is HTML-escaped", () => {
  assert.equal(escapeHtml(`<b>"x" & 'y'</b>`), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  const e = buildAssignedEmail({ ...base, committerName: `<script>alert(1)</script>`, tcCount: 3, notes: `<img src=x onerror=1>` });
  assert.ok(!e.html.includes("<script>"));
  assert.ok(!e.html.includes("<img"));
  assert.ok(e.html.includes("Dry &lt;Sampling&gt; &amp; Exclusion"));
});

test("the assignment email says who, what, how many and links to the page", () => {
  const e = buildAssignedEmail({ ...base, committerName: "Asha", tcCount: 67, notes: null });
  assert.equal(e.subject, "Review requested: CT-614 test cases (Round 2, 14 Oct 2026 15:42 IST)");
  assert.ok(e.html.includes("67"));
  assert.ok(e.html.includes(base.url));
  assert.ok(e.text.includes("Asha submitted 67 test cases"));
  assert.ok(!e.html.includes("Notes"));
});

test("decision emails differ for approve and request-changes and carry the comment", () => {
  const ok = buildDecisionEmail({ ...base, reviewerName: "Bo", decision: "approved", comment: "" });
  assert.match(ok.subject, /approved/);
  assert.ok(ok.html.includes("Bo approved"));
  const no = buildDecisionEmail({ ...base, reviewerName: "Bo", decision: "changes_requested", comment: "Add negative cases" });
  assert.match(no.subject, /need changes/);
  assert.ok(no.html.includes("Add negative cases"));
  assert.ok(no.text.includes("requested changes to"));
});

test("sending never throws: missing config and empty recipients are reported", async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const content = buildDecisionEmail({ ...base, reviewerName: "Bo", decision: "approved", comment: "" });
    assert.deepEqual(await sendEmail([], content), { ok: false, error: "No recipients" });
    const r = await sendEmail(["a@b.co"], content);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /RESEND_API_KEY/);
  } finally {
    if (saved) process.env.RESEND_API_KEY = saved;
  }
});
