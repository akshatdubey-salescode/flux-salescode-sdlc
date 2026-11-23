import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OFFICE_HOURS } from "./types";
import type { SupportTicketRow } from "./ticket-row";
import { buildYtdRows, ytdAttachmentFilename } from "./ytd";

const ist = (s: string) => new Date(s + "+05:30");
const REPORT_DATE = "2026-11-20";

let seq = 0;
function mk(p: Partial<SupportTicketRow> = {}): SupportTicketRow {
  seq++;
  const createdAt = p.createdAt ?? ist("2026-06-01T11:00:00");
  return {
    issueId: `i${seq}`,
    jiraKey: `RL-${seq}`,
    summary: `Ticket ${seq}`,
    priority: "P3",
    category: "bug",
    createdAt,
    resolvedAt: null,
    firstRespondedAt: null,
    rcaGiven: false,
    usersReported: null,
    usersImpacted: null,
    eta: null,
    events: [],
    raisedAt: null,
    jiraCreatedAt: createdAt,
    status: "In Progress",
    issueType: "Bug",
    ownerSide: "salescode",
    storedCategory: "bug",
    fluxEta: null,
    jiraDueDate: null,
    ...p,
  };
}

const keys = (rows: { jiraKey: string }[]) => rows.map((r) => r.jiraKey);

test("everything from project start up to the report date; nothing after it", () => {
  const old = mk({ jiraKey: "OLD", createdAt: ist("2024-03-15T11:00:00") });
  const dec31 = mk({ jiraKey: "DEC31", createdAt: ist("2025-12-31T23:59:00") });
  const today = mk({ jiraKey: "TODAY", createdAt: ist("2026-11-20T23:59:00") });
  const tomorrow = mk({ jiraKey: "TOMORROW", createdAt: ist("2026-11-21T00:00:00") });
  const rows = buildYtdRows([today, dec31, tomorrow, old], REPORT_DATE, DEFAULT_OFFICE_HOURS);
  assert.deepEqual(keys(rows), ["OLD", "DEC31", "TODAY"]);
});

test("the effective raised time (Flux raised_at) decides inclusion, not Jira creation", () => {
  // Created in Jira before the report date, but raised (per Flux) after it: out.
  const movedOut = mk({
    jiraKey: "OUT",
    createdAt: ist("2026-11-21T12:00:00"),
    raisedAt: ist("2026-11-21T12:00:00"),
    jiraCreatedAt: ist("2026-11-19T12:00:00"),
  });
  // Created in Jira on 31 Dec, but raised on 1 Jan: in, with the Flux time.
  const movedIn = mk({
    jiraKey: "IN",
    createdAt: ist("2026-01-01T09:00:00"),
    raisedAt: ist("2026-01-01T09:00:00"),
    jiraCreatedAt: ist("2025-12-31T18:00:00"),
  });
  const rows = buildYtdRows([movedOut, movedIn], REPORT_DATE, DEFAULT_OFFICE_HOURS);
  assert.deepEqual(keys(rows), ["IN"]);
  assert.equal(rows[0].raisedAt, ist("2026-01-01T09:00:00").toISOString());
});

test("sorted by raised time ascending, open and closed, uncategorised kept", () => {
  const a = mk({ jiraKey: "A", createdAt: ist("2026-03-05T10:00:00"), category: null });
  const b = mk({ jiraKey: "B", createdAt: ist("2026-01-10T10:00:00"), resolvedAt: ist("2026-01-12T10:00:00") });
  const c = mk({ jiraKey: "C", createdAt: ist("2026-02-01T10:00:00") });
  const rows = buildYtdRows([a, b, c], REPORT_DATE, DEFAULT_OFFICE_HOURS);
  assert.deepEqual(keys(rows), ["B", "C", "A"]);
  assert.equal(rows[0].isOpen, false);
  assert.equal(rows[1].isOpen, true);
  assert.equal(rows[2].category, null);
});

test("response/resolution minutes honour office hours and client-owned stretches", () => {
  // Mon 2 Nov 2026, raised 18:00 IST; first response 10:30 Tue (1h + 30m office time).
  // Resolved Wed 4 Nov 12:00; the client owned it Tue 11:00 → Wed 11:00.
  // Salescode office time: Mon 18:00-19:00 (60) + Tue 10:00-11:00 (60) + Wed 11:00-12:00 (60) = 180.
  const t = mk({
    jiraKey: "SLA",
    priority: "P1",
    status: "Done",
    createdAt: ist("2026-11-02T18:00:00"),
    firstRespondedAt: ist("2026-11-03T10:30:00"),
    resolvedAt: ist("2026-11-04T12:00:00"),
    events: [
      { side: "client", at: ist("2026-11-03T11:00:00") },
      { side: "salescode", at: ist("2026-11-04T11:00:00") },
    ],
    ownerSide: "salescode",
    rcaGiven: true,
    usersReported: 3,
    usersImpacted: 40,
    eta: "2026-11-05",
  });
  const [row] = buildYtdRows([t], REPORT_DATE, DEFAULT_OFFICE_HOURS);
  assert.deepEqual(row, {
    jiraKey: "SLA",
    summary: t.summary,
    category: "bug",
    priority: "P1",
    status: "Done",
    isOpen: false,
    raisedAt: ist("2026-11-02T18:00:00").toISOString(),
    firstRespondedAt: ist("2026-11-03T10:30:00").toISOString(),
    responseMin: 90,
    resolvedAt: ist("2026-11-04T12:00:00").toISOString(),
    resolutionMin: 180,
    ownerSide: "salescode",
    rcaShared: true,
    usersReported: 3,
    usersImpacted: 40,
    eta: "2026-11-05",
  });
});

test("no response / open → null minutes and null instants; the row is JSON-safe", () => {
  const t = mk({ ownerSide: "client" });
  const [row] = buildYtdRows([t], REPORT_DATE, DEFAULT_OFFICE_HOURS);
  assert.equal(row.firstRespondedAt, null);
  assert.equal(row.responseMin, null);
  assert.equal(row.resolvedAt, null);
  assert.equal(row.resolutionMin, null);
  assert.equal(row.ownerSide, "client");
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row);
});

test("ytdAttachmentFilename formats the date and replaces characters invalid in file names", () => {
  assert.equal(
    ytdAttachmentFilename("Coke Argentina", "2026-11-20"),
    "Support tickets - Coke Argentina - 20 Nov 2026.xlsx",
  );
  assert.equal(
    ytdAttachmentFilename('A/B\\C:D*E?F"G<H>I|J', "2026-01-05"),
    "Support tickets - A-B-C-D-E-F-G-H-I-J - 5 Jan 2026.xlsx",
  );
});
