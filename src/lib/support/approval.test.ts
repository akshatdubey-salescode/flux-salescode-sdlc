import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalBlocker, canApproveReports, isSendEnabled } from "./approval";
import type { SettingsInput } from "./store";
import type { SupportReportData } from "./types";

const ON = { SUPPORT_REPORTS_SEND_ENABLED: "true" };
const settings = (o: Partial<SettingsInput> = {}) =>
  ({ toEmails: ["a@x.com"], ccEmails: [], approverUserIds: [], ...o }) as SettingsInput;
const report = (status = "awaiting_approval", unc = 0) => ({
  status,
  data: { uncategorised: Array.from({ length: unc }, (_, i) => ({ jiraKey: `K-${i}` })) } as unknown as SupportReportData,
});

test("isSendEnabled", () => {
  assert.equal(isSendEnabled({}), false);
  assert.equal(isSendEnabled({ SUPPORT_REPORTS_SEND_ENABLED: "true" }), true);
});

test("isSendEnabled is strict", () => {
  for (const v of ["TRUE", "1", " true"]) {
    assert.equal(isSendEnabled({ SUPPORT_REPORTS_SEND_ENABLED: v }), false);
  }
});

test("approvalBlocker: sent wins over uncategorised", () => {
  assert.equal(approvalBlocker(report("sent", 2), settings(), ON), "Already sent");
});

test("canApproveReports", () => {
  const s = { approverUserIds: ["bob@x.com"] };
  assert.equal(canApproveReports({ id: "a@x.com", email: "a@x.com", role: "ADMIN" }, s), true);
  assert.equal(canApproveReports({ id: "bob@x.com", email: "bob@x.com", role: "USER" }, s), true);
  assert.equal(canApproveReports({ id: "Bob@X.com", email: "Bob@X.com", role: "USER" }, s), true);
  assert.equal(canApproveReports({ id: "c@x.com", email: "c@x.com", role: "USER" }, s), false);
});

test("approvalBlocker", () => {
  assert.equal(approvalBlocker(report("lapsed", 2), settings({ toEmails: [] }), {}), "Sending is disabled in this environment");
  assert.equal(approvalBlocker(report("lapsed"), settings(), ON), "This report has lapsed");
  assert.equal(approvalBlocker(report("sent"), settings(), ON), "Already sent");
  assert.equal(approvalBlocker(report("sending"), settings(), ON), "Already sent");
  assert.equal(
    approvalBlocker(report("awaiting_approval", 2), settings(), ON),
    "2 ticket(s) are uncategorised — categorise them and rebuild",
  );
  assert.equal(approvalBlocker(report(), settings({ toEmails: [] }), ON), "No To recipients configured");
  assert.equal(approvalBlocker(report("failed"), settings(), ON), null);
});
