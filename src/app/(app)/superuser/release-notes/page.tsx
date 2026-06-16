import { desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { releaseNotes } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ReleaseNotesManager, type ReleaseNoteRow } from "./release-notes-manager";

export default async function ReleaseNotesPage() {
  await requireRole("SUPERUSER");

  const rows = await db
    .select({
      id: releaseNotes.id,
      title: releaseNotes.title,
      body: releaseNotes.body,
      type: releaseNotes.type,
      linkLabel: releaseNotes.linkLabel,
      linkHref: releaseNotes.linkHref,
      isPublished: releaseNotes.isPublished,
      publishedAt: releaseNotes.publishedAt,
      createdAt: releaseNotes.createdAt,
    })
    .from(releaseNotes)
    .orderBy(desc(releaseNotes.createdAt));

  const notes: ReleaseNoteRow[] = rows.map((r) => ({
    ...r,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>What&apos;s New</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              What&apos;s New
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Author release notes that appear in every user&apos;s notification
              bell. Mark a note as an <span className="font-medium">Alert</span>{" "}
              to also pop it up as a modal the first time each user sees it. Only{" "}
              <span className="font-medium">published</span> notes are visible to
              users.
            </p>
          </div>

          <ReleaseNotesManager notes={notes} />
        </div>
      </main>
    </div>
  );
}
