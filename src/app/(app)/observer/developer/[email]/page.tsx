import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { requireAuth } from "@/lib/auth/server";
import { DeveloperInsightsClient } from "@/components/observer/developer-insights-client";

type Props = {
  params: Promise<{ email: string }>;
  searchParams: Promise<{ boardId?: string; boardName?: string }>;
};

export default async function DeveloperInsightsPage({ params, searchParams }: Props) {
  await requireAuth();
  const { email } = await params;
  const { boardId, boardName } = await searchParams;
  const decodedEmail = decodeURIComponent(email);

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader className="bg-white dark:bg-zinc-900">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/observer">Team Pulse</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {boardId && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/observer/${boardId}`}>{boardName ?? "Board"}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{decodedEmail}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <DeveloperInsightsClient
          email={decodedEmail}
          boardId={boardId}
          boardName={boardName}
        />
      </main>
    </div>
  );
}
