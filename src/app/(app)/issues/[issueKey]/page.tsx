import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  jiraStatusHistory,
  jiraComments,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Separator } from "@/components/ui/separator";
import { StatusTimeChart } from "@/components/status-time-chart";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getIssueTimeline(issueKey: string) {
  const [issue] = await db
    .select()
    .from(jiraIssues)
    .where(eq(jiraIssues.jiraKey, issueKey))
    .limit(1);

  if (!issue) return null;

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name, jiraProjectKey: jiraProjects.jiraProjectKey })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, issue.projectId))
    .limit(1);

  const [statusHistory, comments] = await Promise.all([
    db
      .select()
      .from(jiraStatusHistory)
      .where(eq(jiraStatusHistory.issueId, issue.id))
      .orderBy(asc(jiraStatusHistory.changedAt)),

    db
      .select()
      .from(jiraComments)
      .where(eq(jiraComments.issueId, issue.id))
      .orderBy(asc(jiraComments.jiraCreatedAt)),
  ]);

  return { issue, project, statusHistory, comments };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusCategory = string | null;

function statusBadgeClass(cat: StatusCategory): string {
  if (cat === "Done" || cat === "Complete")
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400";
  if (cat === "In Progress")
    return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** Extract plain text from Atlassian Document Format JSON */
function adfToText(body: string | null): string {
  if (!body) return "";
  try {
    const doc = JSON.parse(body) as Record<string, unknown>;
    const texts: string[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "text" && typeof n.text === "string") {
        texts.push(n.text);
      }
      if (Array.isArray(n.content)) {
        for (const child of n.content) walk(child);
      }
    }
    walk(doc);
    return texts.join(" ").trim();
  } catch {
    return body;
  }
}

// ---------------------------------------------------------------------------
// Timeline event types
// ---------------------------------------------------------------------------

type TimelineEvent =
  | {
      kind: "status";
      id: string;
      at: Date;
      fromStatus: string | null;
      toStatus: string;
      changedByName: string | null;
      durationSeconds: number | null;
    }
  | {
      kind: "comment";
      id: string;
      at: Date;
      authorName: string | null;
      authorEmail: string | null;
      body: string | null;
      updatedAt: Date | null;
    };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IssuePage(props: {
  params: Promise<{ issueKey: string }>;
}) {
  await requireAuth();
  const { issueKey } = await props.params;

  const data = await getIssueTimeline(issueKey.toUpperCase());
  if (!data) notFound();

  const { issue, project, statusHistory, comments } = data;

  // Aggregate seconds per status for the bar chart.
  const statusTotals: Record<string, number> = {};
  for (let i = 0; i < statusHistory.length; i++) {
    const row = statusHistory[i];
    if (!row.fromStatus) continue;

    let seconds = row.durationSeconds;
    if (seconds == null && i > 0) {
      seconds = Math.floor(
        (new Date(row.changedAt).getTime() -
          new Date(statusHistory[i - 1].changedAt).getTime()) /
          1000
      );
    }
    if (seconds != null && seconds > 0) {
      statusTotals[row.fromStatus] = (statusTotals[row.fromStatus] ?? 0) + seconds;
    }
  }
  const lastTransition = statusHistory.at(-1);
  if (lastTransition) {
    const sinceSeconds = Math.floor(
      (Date.now() - new Date(lastTransition.changedAt).getTime()) / 1000
    );
    if (sinceSeconds > 0) {
      statusTotals[issue.status] = (statusTotals[issue.status] ?? 0) + sinceSeconds;
    }
  }
  const chartData = Object.entries(statusTotals)
    .filter(([, s]) => s > 0)
    .map(([status, seconds]) => ({ status, hours: seconds / 3600 }));

  // Merge status history + comments into a single sorted timeline
  const events: TimelineEvent[] = [
    ...statusHistory.map((h, i) => {
      let durationSeconds = h.durationSeconds;
      if (durationSeconds == null && h.fromStatus && i > 0) {
        durationSeconds = Math.floor(
          (new Date(h.changedAt).getTime() -
            new Date(statusHistory[i - 1].changedAt).getTime()) /
            1000
        );
      }
      return {
        kind: "status" as const,
        id: h.id,
        at: new Date(h.changedAt),
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedByName: h.changedByName,
        durationSeconds,
      };
    }),
    ...comments.map((c) => ({
      kind: "comment" as const,
      id: c.id,
      at: new Date(c.jiraCreatedAt ?? c.syncedAt),
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      body: c.body,
      updatedAt: c.jiraUpdatedAt ? new Date(c.jiraUpdatedAt) : null,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="flex flex-col min-h-svh">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/projects/${project?.id}`}>
                {project?.name ?? "Project"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{issue.jiraKey}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6 space-y-5 max-w-4xl">
        {/* Issue info */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            {/* Key + badges row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {issue.jiraKey}
              </span>
              {issue.issueType && (
                <Badge variant="outline" className="text-[10px]">
                  {issue.issueType}
                </Badge>
              )}
              {issue.priority && (
                <Badge variant="outline" className="text-[10px]">
                  {issue.priority}
                </Badge>
              )}
              <Badge
                className={cn("ml-auto text-[10px]", statusBadgeClass(issue.statusCategory))}
              >
                {issue.status}
              </Badge>
            </div>

            {/* Summary */}
            <h1 className="text-base font-semibold leading-snug text-foreground">
              {issue.summary}
            </h1>

            {/* Metadata */}
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
              {issue.assigneeName && (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Assignee</span>
                  <span className="font-medium text-foreground">{issue.assigneeName}</span>
                </span>
              )}
              {issue.reporterName && (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Reporter</span>
                  <span className="font-medium text-foreground">{issue.reporterName}</span>
                </span>
              )}
              {issue.jiraCreatedAt && (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground">{formatDateTime(issue.jiraCreatedAt)}</span>
                </span>
              )}
              {issue.jiraUpdatedAt && (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-foreground">{formatDateTime(issue.jiraUpdatedAt)}</span>
                </span>
              )}
            </div>

            {/* Labels */}
            {issue.labels && issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="font-mono text-[10px]">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time in status */}
        <Card>
          <CardHeader>
            <CardTitle>Time in Status</CardTitle>
            <CardAction>
              <ChartInfo description="How long this issue spent in each workflow status. Large time blocks in 'In Progress' or 'In Review' may indicate the work was paused, blocked, or waiting on a review." />
            </CardAction>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">
                No status history available yet.
              </p>
            ) : (
              <StatusTimeChart data={chartData} />
            )}
          </CardContent>
        </Card>

        {/* Activity timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Timeline
              <span className="font-normal normal-case text-[10px] tracking-normal text-muted-foreground/60">
                {events.length} events
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ol className="relative border-l border-border space-y-0">
                {events.map((event) => (
                  <li key={event.id} className="ml-4 pb-6 last:pb-0">
                    {/* Dot */}
                    <span
                      className={cn(
                        "absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-card",
                        event.kind === "comment"
                          ? "bg-muted-foreground/40"
                          : "bg-primary/70"
                      )}
                    />

                    {event.kind === "status" ? (
                      <div className="space-y-0.5">
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {formatDateTime(event.at)}
                        </p>
                        <p className="text-xs text-foreground">
                          {event.fromStatus ? (
                            <>
                              Status{" "}
                              <span className="font-medium text-muted-foreground line-through">
                                {event.fromStatus}
                              </span>
                              {" → "}
                              <span className="font-medium">{event.toStatus}</span>
                            </>
                          ) : (
                            <>
                              Created with status{" "}
                              <span className="font-medium">{event.toStatus}</span>
                            </>
                          )}
                          {event.changedByName && (
                            <span className="text-muted-foreground">
                              {" "}by {event.changedByName}
                            </span>
                          )}
                        </p>
                        {event.fromStatus && event.durationSeconds != null && (
                          <p className="text-[10px] text-muted-foreground">
                            Spent{" "}
                            <span className="font-medium tabular-nums">
                              {formatDuration(event.durationSeconds)}
                            </span>{" "}
                            in <span className="font-medium">{event.fromStatus}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {formatDateTime(event.at)}
                          {event.updatedAt &&
                            event.updatedAt.getTime() !== event.at.getTime() && (
                              <span className="ml-2 text-muted-foreground/50">
                                edited {formatDateTime(event.updatedAt)}
                              </span>
                            )}
                        </p>
                        <p className="text-xs font-medium text-foreground">
                          {event.authorName ?? event.authorEmail ?? "Unknown"}
                          <span className="font-normal text-muted-foreground"> commented</span>
                        </p>
                        {event.body && (
                          <p className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                            {adfToText(event.body)}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
