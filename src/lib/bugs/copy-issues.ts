// Builds the shareable text behind the Bug Board's "Copy Issues" button — same
// idea as Team Pulse's "Copy Alert": a header, a one-line summary, then one
// block per issue with a Jira link, ready to paste into Slack / email.

import { ALL_TIME_START } from "@/lib/date-utils";

export type CopyIssue = {
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  projectName: string;
  jiraBaseUrl: string;
  environment: string;
  isCustomerFound: boolean;
  ownerName: string | null;
  assigneeName: string | null;
  createdAt: string | null;
};

export type CopyRca = { given: boolean; text: string | null };

/** Longest RCA excerpt copied per issue — the Jira link carries the full text. */
export const RCA_EXCERPT_MAX = 400;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtIsoDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function rcaExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > RCA_EXCERPT_MAX ? `${flat.slice(0, RCA_EXCERPT_MAX).trimEnd()}…` : flat;
}

export function buildIssuesMessage({
  title,
  from,
  to,
  env,
  cfOnly,
  issues,
  rca,
  truncated,
  today,
}: {
  /** What the list is scoped to, e.g. "CavinKare COE — Rohit Mittal — P3". */
  title: string;
  from?: string;
  to?: string;
  env?: string;
  cfOnly?: boolean;
  issues: CopyIssue[];
  /** RCA per issue key; omit/undefined entry means "unknown" and the line is skipped. */
  rca: Record<string, CopyRca | null | undefined>;
  truncated?: boolean;
  /** YYYY-MM-DD, injectable for tests. */
  today: string;
}): string {
  const lines: string[] = [`🐞 Bug Report — ${fmtIsoDay(today)}`, title];

  if (from && to) {
    lines.push(from === ALL_TIME_START ? "Raised: all time" : `Raised: ${fmtIsoDay(from)} → ${fmtIsoDay(to)}`);
  }
  const filters = [env && `Env: ${env}`, cfOnly && "Customer-found only"].filter(Boolean);
  if (filters.length) lines.push(`Filters: ${filters.join(" · ")}`);

  const byPriority = new Map<string, number>();
  for (const i of issues) byPriority.set(i.priority ?? "No priority", (byPriority.get(i.priority ?? "No priority") ?? 0) + 1);
  const known = issues.map((i) => rca[i.jiraKey]).filter((r): r is CopyRca => !!r);
  const given = known.filter((r) => r.given).length;

  const summary = [`${issues.length} issue${issues.length === 1 ? "" : "s"}`];
  if (byPriority.size > 1) summary.push([...byPriority].map(([p, n]) => `${p}: ${n}`).join(", "));
  if (known.length) summary.push(`RCA given: ${given} · not given: ${known.length - given}`);
  lines.push("", summary.join(" · "));
  if (truncated) lines.push(`(first ${issues.length} shown — narrow the date range for the rest)`);

  issues.forEach((i, idx) => {
    const url = `${i.jiraBaseUrl.replace(/\/+$/, "")}/browse/${i.jiraKey}`;
    const meta = [
      i.priority,
      i.status,
      i.environment && i.environment !== "—" ? i.environment : null,
      i.isCustomerFound ? "Customer-found" : "QA-found",
    ].filter(Boolean);
    const people = [
      `Owner: ${i.ownerName ?? "Missing Issue Owner"}`,
      i.assigneeName ? `Assignee: ${i.assigneeName}` : null,
      i.createdAt ? `Raised: ${fmtIsoDay(i.createdAt)}` : null,
    ].filter(Boolean);

    lines.push("", `${idx + 1}. ${i.jiraKey} — ${i.summary}`, `   ${i.projectName} · ${meta.join(" · ")}`, `   ${people.join(" · ")}`);

    const r = rca[i.jiraKey];
    if (r) lines.push(r.given && r.text ? `   RCA: ${rcaExcerpt(r.text)}` : r.given ? "   RCA: given" : "   RCA: not given");

    lines.push(`   ${url}`);
  });

  return lines.join("\n");
}
