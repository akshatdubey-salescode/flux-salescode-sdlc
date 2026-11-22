/** Test helpers: an ExportModel from the 7 real records, and a synthetic oversized one. */
import { buildChecklist, type Checklist } from "../checklist";
import { realJiras } from "../checklist/testkit";
import type { ItemSummary } from "../service/types";
import type { ExportModel } from "./model";

export function realChecklist(env: "demo" | "uat" | "prod" = "prod"): Checklist {
  return buildChecklist({ environment: env, jiras: realJiras(), branches: [{ repo: "channelkart", branch: "prod_blue_ckcoe" }] });
}

const item = (o: Partial<ItemSummary> & { key: string }): ItemSummary => ({
  issueId: `00000000-0000-4000-8000-0000000000${o.key.slice(-2)}`,
  summary: o.key,
  included: true,
  readiness: "ready",
  override: null,
  result: "pending",
  resultComment: null,
  warnings: [],
  records: [],
  ...o,
});

export function modelFor(cl: Checklist, extra: Partial<ExportModel> = {}): ExportModel {
  return {
    generatedAt: "2026-11-19T12:00:00.000Z",
    delivery: { id: "d1", name: "Release 19 Nov", date: "2026-11-19" },
    movement: { id: "m1", environment: cl.environment, status: "ready", hash: cl.hash, refreshedAt: "2026-11-19T11:30:00.000Z", createdAt: "2026-11-19T09:00:00.000Z", createdByName: "Asha", startedAt: null, doneAt: null, doneByName: null },
    signers: [
      { slot: "deployer", email: "dep@example.com", name: "Dev Ops", signedAt: "2026-11-19T11:45:00.000Z", signed: true, signedCurrent: true },
      { slot: "ba", email: "ba@example.com", name: null, signedAt: null, signed: false, signedCurrent: false },
      { slot: "lead", email: "lead@example.com", name: "Lee", signedAt: "2026-11-18T08:00:00.000Z", signed: true, signedCurrent: false },
    ],
    items: [
      item({ key: "CAV-7304", summary: "Account lock", records: [{ repo: "channelkart", pr: 1185, commentId: "81422", version: 1, updated: null, status: "BLOCKED" }], warnings: [{ code: "open_unknowns", message: "5 unknowns still open" }] }),
      item({ key: "CAV-7346", summary: "Partner banner", readiness: "blocked", included: false, warnings: [{ code: "pr_no_record", message: "channelkart#1190 has no deployment record" }] }),
      item({ key: "CAV-7399", summary: "Overridden", readiness: "override", override: { reason: "Hotfix agreed with the lead", by: "Admin", at: "2026-11-19T10:00:00.000Z" } }),
    ],
    checklist: cl,
    events: [
      { at: "2026-11-19T11:45:00.000Z", type: "signed", actor: "Dev Ops", detail: "" },
      { at: "2026-11-19T09:00:00.000Z", type: "created", actor: "Asha", detail: '{"env":"prod"}' },
    ],
    ...extra,
  };
}

/** A checklist with `n` items in one section (built directly: buildChecklist caps a section at 300). Every 10th item starts with a formula character. */
export function hugeChecklist(n: number): Checklist {
  const cl = realChecklist();
  const sec = cl.sections.find((s) => s.id === "verify")!;
  sec.items = Array.from({ length: n }, (_, i) => ({
    id: `verify|k${i}`,
    ih: `h${i}`,
    key: `k${i}`,
    text: `${i % 10 === 0 ? "=cmd|' /C calc'!A0 " : ""}Verify step ${i}: check the outlet list after the deploy, then the order screen for tenant ${i % 37}; expected result recorded in the sheet.`,
    sources: [{ jira: "CAV-7304", pr: "channelkart#1185" }],
    severity: i % 50 === 0 ? "warn" : "info",
  }));
  return cl;
}
