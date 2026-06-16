import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { EditForm } from "./edit-form";

export default async function EditRequirementPage(props: {
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

  // Locked once pushed to Jira
  if (req.jiraIssueKey) {
    redirect(`/requirements/${id}`);
  }

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/requirements">Requirements</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink
                href={`/requirements/${id}`}
                className="max-w-xs truncate"
              >
                {req.title}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Edit Requirement
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Changes are saved as-is. Push to Jira from the requirement page when ready.
            </p>
          </div>

          <EditForm
            id={id}
            initial={{
              title: req.title,
              description: req.description,
              acceptanceCriteria: req.acceptanceCriteria ?? "",
            }}
          />
        </div>
      </main>
    </div>
  );
}
