import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements } from "@/lib/db/schema";
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
import {
  RiGitRepositoryLine,
  RiCalendarLine,
  RiArrowLeftLine,
  RiSparklingLine,
} from "@remixicon/react";

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  draft: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export default async function RequirementDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await props.params;

  const [req] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.id, id))
    .limit(1);

  if (!req || req.createdBy !== user.id) notFound();

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/requirements">Requirements</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-xs truncate">{req.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Back link */}
          <Link
            href="/requirements"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <RiArrowLeftLine size={14} />
            Back to Requirements
          </Link>

          {/* Title + badges */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold capitalize",
                  STATUS_STYLES[req.status] ?? "bg-zinc-100 text-zinc-500"
                )}
              >
                {req.status}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold capitalize",
                  PRIORITY_STYLES[req.priority] ?? "bg-zinc-100 text-zinc-500"
                )}
              >
                {req.priority} priority
              </span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {req.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <RiGitRepositoryLine size={13} />
                <span className="font-mono">{req.githubRepoName}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <RiCalendarLine size={13} />
                {formatDate(req.createdAt)}
              </span>
            </div>
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          {/* Description */}
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              Description
            </h2>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {req.description}
              </p>
            </div>
          </section>

          {/* Acceptance criteria */}
          {req.acceptanceCriteria && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                Acceptance Criteria
              </h2>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                <pre className="text-sm font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {req.acceptanceCriteria}
                </pre>
              </div>
            </section>
          )}

          {/* AI context (if any) */}
          {req.charjanContext && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                <RiSparklingLine size={12} />
                AI Research Context
              </h2>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-4">
                {req.charjanContext.answer && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {req.charjanContext.answer}
                  </p>
                )}
                {req.charjanContext.citations?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      Sources
                    </p>
                    {req.charjanContext.citations.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3"
                      >
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                          {c.title}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{c.snippet}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
