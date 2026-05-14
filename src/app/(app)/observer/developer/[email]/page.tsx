import Link from "next/link";
import { eq } from "drizzle-orm";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { observerBoards } from "@/lib/db/schema";
import { DeveloperInsightsClient } from "@/components/observer/developer-insights-client";
import { Button } from "@/components/ui/button";
import { RiCheckboxCircleLine } from "@remixicon/react";

type Props = {
  params: Promise<{ email: string }>;
  searchParams: Promise<{ boardId?: string; boardName?: string }>;
};

export default async function DeveloperInsightsPage({ params, searchParams }: Props) {
  await requireAuth();
  const { email } = await params;
  const { boardId, boardName } = await searchParams;
  const decodedEmail = decodeURIComponent(email);

  let stalenessThreshold = 5;
  if (boardId) {
    const [board] = await db
      .select({ stalenessThresholdDays: observerBoards.stalenessThresholdDays })
      .from(observerBoards)
      .where(eq(observerBoards.id, boardId));
    if (board) stalenessThreshold = board.stalenessThresholdDays;
  }

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/observer">Team Observer</Link>
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
        <div className="ml-auto">
          <Button variant="outline" size="sm" asChild className="h-8">
            <Link href="/observer/check-in">
              <RiCheckboxCircleLine className="mr-1.5 size-4" />
              My Check-in
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <DeveloperInsightsClient
          email={decodedEmail}
          boardId={boardId}
          boardName={boardName}
          stalenessThreshold={stalenessThreshold}
        />
      </main>
    </div>
  );
}
