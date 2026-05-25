import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/server";
import { isEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbLink,
} from "@/components/ui/breadcrumb";
import { RequirementBuilderForm } from "@/components/requirement-builder";

export default async function NewRequirementPage() {
  await requireAuth();
  const enabled = await isEnabled(FEATURE_FLAGS.REQUIREMENT_BUILDER);
  if (!enabled) redirect("/requirements");

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/requirements">Requirements</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>New Requirement</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Build a Requirement with AI
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Select the repositories your requirement touches, launch the AI builder, and let
            Charjan analyse the codebase. When you&apos;re done, publish to your team.
          </p>
        </div>

        <RequirementBuilderForm />
      </main>
    </div>
  );
}
