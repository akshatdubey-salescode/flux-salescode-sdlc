// Assembles the data for the summary workbook from the stored stats and the
// latest round, so the download always agrees with the details page.

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcCases } from "@/lib/db/schema";
import { effectiveResult } from "./analytics";
import { istDateTime, istStamp, roundLabel, safeSegment } from "./filenames";
import { fetchHistory } from "./history-service";
import { fetchSignoffs } from "./signoff-service";
import { fetchSetDetail, findIssue } from "./service";
import { fetchStoredStats, loadLatestSignoffResults } from "./stats-service";
import { buildSummaryXlsx } from "./summary-xlsx";

export async function buildSummaryForIssue(issueId: string, requestedBy: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const lookup = await findIssue({ issueId });
  if (lookup.kind !== "found") return null;
  const issue = lookup.issue;

  const detail = await fetchSetDetail(issue.id);
  const latest = detail?.rounds[0];
  if (!detail || !latest) return null;

  const [stored, signoffs, cases, results, history] = await Promise.all([
    fetchStoredStats(detail.setId),
    fetchSignoffs(latest.id),
    db.select().from(tcCases).where(eq(tcCases.roundId, latest.id)).orderBy(asc(tcCases.rowNo)),
    loadLatestSignoffResults(latest.id),
    fetchHistory(detail.setId),
  ]);
  if (!stored) return null;

  const now = new Date();
  const buffer = await buildSummaryXlsx({
    issueKey: issue.jiraKey,
    issueSummary: issue.summary,
    projectName: issue.projectName,
    roundLabel: roundLabel(latest.roundNo, new Date(latest.committedAt)),
    generatedAt: `${istDateTime(now)} (stats computed ${istDateTime(stored.computedAt)})`,
    stats: stored.stats,
    history,
    trend: stored.stats.trend ?? [],
    signoffs,
    cases: cases.map((c) => {
      const dev = results.hasDev ? (results.dev.get(c.id) ?? "not_run") : null;
      const tester = results.hasTester ? (results.tester.get(c.id) ?? "not_run") : null;
      return {
        section: c.section,
        tcCode: c.tcCode,
        title: c.title,
        category: c.category,
        polarity: c.polarity,
        priority: c.priority,
        severity: c.severity,
        dev,
        tester,
        effective: effectiveResult(dev, tester),
      };
    }),
  });

  const user = safeSegment(requestedBy.includes("@") ? requestedBy.split("@")[0] : requestedBy, 24);
  const fileName = [
    "Summary",
    `r${latest.roundNo}`,
    safeSegment(issue.projectName, 30),
    safeSegment(issue.jiraKey, 20),
    safeSegment(issue.summary, 40),
    user,
    istStamp(now),
  ].join("_") + ".xlsx";
  return { buffer, fileName };
}
