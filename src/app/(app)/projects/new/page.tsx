import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CreateProjectForm } from "./form";

export default async function NewProjectPage() {
  const user = await requireRole("SUPERUSER");

  if (user.role !== "SUPERUSER") redirect("/projects");

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <span className="text-sm text-zinc-500">Add Project</span>
      </header>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-md space-y-6">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Connect a Jira project
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Flux will sync all issues, comments, and status history. After
              adding the project, configure the webhook in Jira to receive
              real-time updates.
            </p>
          </div>

          <CreateProjectForm />

          <WebhookInstructions />
        </div>
      </main>
    </div>
  );
}

function WebhookInstructions() {
  return (
    <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        After adding the project
      </p>
      <ol className="mt-2 space-y-1 text-xs text-zinc-500 list-decimal list-inside">
        <li>
          Go to your Jira project → <strong>Project settings</strong> →{" "}
          <strong>Integrations</strong> → <strong>Webhooks</strong>
        </li>
        <li>
          Create a new webhook pointing to the URL shown on the project page
        </li>
        <li>
          Enable events: <em>Issue created, updated, deleted</em> and{" "}
          <em>Comment created, updated, deleted</em>
        </li>
      </ol>
    </div>
  );
}
