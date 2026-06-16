import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { featureRequests } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbLink,
} from "@/components/ui/breadcrumb";
import Link from "next/link";

const PRIORITY_STYLES = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default async function FeatureRequestsPage() {
  await requireRole("SUPERUSER");

  const requests = await db
    .select()
    .from(featureRequests)
    .orderBy(desc(featureRequests.createdAt));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/superuser">Superuser</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Feature Requests</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Feature Requests</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {requests.length} request{requests.length !== 1 ? "s" : ""} submitted by users.
            </p>
          </div>

          {requests.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">No feature requests yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {req.title}
                        </h2>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_STYLES[req.priority]}`}
                        >
                          {req.priority}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {req.description}
                      </p>
                      {req.useCaseProblem && (
                        <div className="mt-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                            Use case / problem
                          </p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {req.useCaseProblem}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                    <span>{req.submittedByName ?? req.submittedByEmail}</span>
                    <span>·</span>
                    <span>{req.submittedByEmail}</span>
                    <span>·</span>
                    <span>
                      {new Date(req.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
