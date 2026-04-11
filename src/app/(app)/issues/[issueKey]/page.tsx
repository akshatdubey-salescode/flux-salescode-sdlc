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
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

function statusColor(cat: StatusCategory): string {
  if (cat === "Done" || cat === "Complete")
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (cat === "In Progress")
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
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
  // Use durationSeconds when available; otherwise derive from consecutive changedAt timestamps.
  const statusTotals: Record<string, number> = {};
  for (let i = 0; i < statusHistory.length; i++) {
    const row = statusHistory[i];
    if (!row.fromStatus) continue; // initial creation row — no previous status

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
  // Add time spent in current status since the last recorded transition
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
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

      <main className="flex-1 p-6 space-y-6 max-w-4xl">
        {/* Issue info card */}
        <div className="rounded-lg border border-zinc-200 p-4 space-y-3 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-zinc-400">{issue.jiraKey}</span>
                <span className="text-xs text-zinc-400">{issue.issueType}</span>
                {issue.priority && (
                  <span className="text-xs text-zinc-400">{issue.priority}</span>
                )}
              </div>
              <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 leading-snug">
                {issue.summary}
              </h1>
            </div>
            <span
              className={`shrink-0 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(issue.statusCategory)}`}
            >
              {issue.status}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
            {issue.assigneeName && (
              <span>
                <span className="text-zinc-400">Assignee</span>{" "}
                <span className="text-zinc-700 dark:text-zinc-300">{issue.assigneeName}</span>
              </span>
            )}
            {issue.reporterName && (
              <span>
                <span className="text-zinc-400">Reporter</span>{" "}
                <span className="text-zinc-700 dark:text-zinc-300">{issue.reporterName}</span>
              </span>
            )}
            {issue.jiraCreatedAt && (
              <span>
                <span className="text-zinc-400">Created</span>{" "}
                <span className="text-zinc-700 dark:text-zinc-300">{formatDateTime(issue.jiraCreatedAt)}</span>
              </span>
            )}
            {issue.jiraUpdatedAt && (
              <span>
                <span className="text-zinc-400">Updated</span>{" "}
                <span className="text-zinc-700 dark:text-zinc-300">{formatDateTime(issue.jiraUpdatedAt)}</span>
              </span>
            )}
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:bg-zinc-800"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Status time distribution */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Time in status
          </h2>
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <StatusTimeChart data={chartData} />
          </div>
        </section>

        {/* Activity timeline */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Timeline
            <span className="ml-2 font-normal normal-case text-zinc-300 dark:text-zinc-600">
              {events.length} events
            </span>
          </h2>

          {events.length === 0 && (
            <p className="text-xs text-zinc-400">No activity recorded yet.</p>
          )}

          <ol className="relative border-l border-zinc-200 dark:border-zinc-800 space-y-0">
            {events.map((event, i) => (
              <li key={event.id} className="ml-4 pb-6 last:pb-0">
                {/* Dot */}
                <span
                  className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-950 ${
                    event.kind === "comment"
                      ? "bg-zinc-400 dark:bg-zinc-600"
                      : "bg-blue-400 dark:bg-blue-600"
                  }`}
                />

                {event.kind === "status" ? (
                  <div className="space-y-0.5">
                    <p className="text-xs text-zinc-400">{formatDateTime(event.at)}</p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">
                      {event.fromStatus ? (
                        <>
                          Status changed{" "}
                          <span className="font-medium">{event.fromStatus}</span>
                          {" → "}
                          <span className="font-medium">{event.toStatus}</span>
                        </>
                      ) : (
                        <>
                          Issue created with status{" "}
                          <span className="font-medium">{event.toStatus}</span>
                        </>
                      )}
                      {event.changedByName && (
                        <span className="text-zinc-400"> by {event.changedByName}</span>
                      )}
                    </p>
                    {event.fromStatus && event.durationSeconds != null && (
                      <p className="text-xs text-zinc-400">
                        Spent {formatDuration(event.durationSeconds)} in{" "}
                        <span className="font-medium">{event.fromStatus}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-400">
                      {formatDateTime(event.at)}
                      {event.updatedAt &&
                        event.updatedAt.getTime() !== event.at.getTime() && (
                          <span className="ml-2 text-zinc-300 dark:text-zinc-600">
                            (edited {formatDateTime(event.updatedAt)})
                          </span>
                        )}
                    </p>
                    <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {event.authorName ?? event.authorEmail ?? "Unknown"} commented
                    </p>
                    {event.body && (
                      <p className="mt-1 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 whitespace-pre-wrap line-clamp-6">
                        {adfToText(event.body)}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
