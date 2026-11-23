import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { YtdTicketRow } from "./types";
import { buildYtdWorkbook, ytdHeaders } from "./ytd-workbook";

const YTD_HEADERS = ytdHeaders();

const META = { projectName: "Demo", reportDate: "2026-11-20" };
const iso = (s: string) => new Date(s + "+05:30").toISOString();

function mk(p: Partial<YtdTicketRow> = {}): YtdTicketRow {
  return {
    jiraKey: "RL-1",
    summary: "Orders not syncing",
    category: "bug",
    priority: "P2",
    status: "In Progress",
    isOpen: true,
    raisedAt: iso("2026-01-15T10:00:00"),
    firstRespondedAt: null,
    responseMin: null,
    resolvedAt: null,
    resolutionMin: null,
    ownerSide: "salescode",
    rcaShared: false,
    usersReported: null,
    usersImpacted: null,
    eta: null,
    ...p,
  };
}

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

const rowValues = (ws: ExcelJS.Worksheet, n: number) =>
  (ws.getRow(n).values as unknown[]).slice(1); // exceljs rows are 1-based

test("one sheet per IST month that has tickets, chronological, empty months skipped", async () => {
  const wb = await load(
    await buildYtdWorkbook(
      [
        mk({ jiraKey: "RL-3", raisedAt: iso("2026-03-02T09:00:00") }),
        mk({ jiraKey: "RL-1", raisedAt: iso("2026-01-15T10:00:00") }),
        // 1 Feb 01:00 IST is still 31 Jan in UTC: the IST month wins.
        mk({ jiraKey: "RL-2", raisedAt: iso("2026-02-01T01:00:00") }),
        mk({ jiraKey: "RL-4", raisedAt: iso("2026-03-20T09:00:00") }),
      ],
      META,
    ),
  );
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["Jan 2026", "Feb 2026", "Mar 2026"],
  );
  const mar = wb.getWorksheet("Mar 2026")!;
  assert.equal(mar.rowCount, 3);
  // No Jira Key column (user decision, 2026-11-23): rows are identified by summary.
  assert.equal(mar.getCell("A1").value, "Summary");
  assert.equal(mar.rowCount, 3);
});

test("header row text, bold, frozen and filtered", async () => {
  const wb = await load(await buildYtdWorkbook([mk()], META));
  const ws = wb.worksheets[0];
  assert.deepEqual(rowValues(ws, 1), [
    "Summary",
    "Category",
    "Priority",
    "Open/Closed",
    "Raised (IST)",
    "First Response (IST)",
    "Response Time (office hrs)",
    "Resolved (IST)",
    "Resolution Time (office hrs)",
    "Currently With",
    "RCA Shared",
    "Users Reported",
    "Users Impacted",
    "ETA",
  ]);
  assert.deepEqual(YTD_HEADERS, rowValues(ws, 1));
  assert.equal(ws.getRow(1).font?.bold, true);
  assert.equal(ws.views[0]?.state, "frozen");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, 1);
  assert.ok(ws.autoFilter, "autoFilter set");
});

test("a closed ticket's formatted values", async () => {
  const wb = await load(
    await buildYtdWorkbook(
      [
        mk({
          jiraKey: "RL-9",
          summary: "Scheme not applied",
          category: "data_issue",
          priority: "P1",
          status: "Done",
          isOpen: false,
          raisedAt: iso("2026-11-20T15:22:00"),
          firstRespondedAt: iso("2026-11-20T15:30:00"),
          responseMin: 8,
          resolvedAt: iso("2026-11-21T11:00:00"),
          resolutionMin: 140,
          ownerSide: "client",
          rcaShared: true,
          usersReported: 2,
          usersImpacted: 150,
          eta: "2026-11-25",
        }),
      ],
      META,
    ),
  );
  const ws = wb.getWorksheet("Nov 2026")!;
  assert.deepEqual(rowValues(ws, 2), [
    "Scheme not applied",
    "Data Issue",
    "P1",
    "Closed",
    "20 Nov 2026, 15:22",
    "20 Nov 2026, 15:30",
    "8 min",
    "21 Nov 2026, 11:00",
    "2 hr 20 min",
    "Client",
    "Yes",
    2,
    150,
    "25 Nov 2026",
  ]);
});

test("an open, uncategorised ticket with no response: dashes and empty cells", async () => {
  const wb = await load(await buildYtdWorkbook([mk({ category: null })], META));
  const ws = wb.worksheets[0];
  const v = ws.getRow(2).values as unknown[];
  assert.equal(v[2], "Uncategorised");
  assert.equal(v[4], "Open");
  assert.equal(v[6], undefined); // First Response (IST) empty
  assert.equal(v[7], "–");
  assert.equal(v[8], undefined); // Resolved (IST) empty
  assert.equal(v[9], "–");
  assert.equal(v[10], "Salescode");
  assert.equal(v[11], "No");
  assert.equal(v[12], undefined);
  assert.equal(v[13], undefined);
  assert.equal(v[14], undefined);
});

test("no tickets → a single 'No tickets' sheet with the header row only", async () => {
  const wb = await load(await buildYtdWorkbook([], META));
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["No tickets"],
  );
  const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 1);
  assert.deepEqual(rowValues(ws, 1), YTD_HEADERS);
});

test("a project in another timezone: its months, times and header labels", async () => {
  const BA = "America/Argentina/Buenos_Aires";
  // 1 Dec 01:00 UTC is 30 Nov 22:00 in Buenos Aires: the Nov sheet.
  const wb = await load(
    await buildYtdWorkbook(
      [mk({ jiraKey: "RL-7", raisedAt: "2026-12-01T01:00:00.000Z" })],
      { ...META, reportDate: "2026-12-01", timeZone: BA },
    ),
  );
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Nov 2026"]);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell("E1").value, "Raised (GMT-3)");
  assert.equal(ws.getCell("E2").value, "30 Nov 2026, 22:00");
  assert.deepEqual(ytdHeaders(BA, "2026-12-01"), rowValues(ws, 1));
});
