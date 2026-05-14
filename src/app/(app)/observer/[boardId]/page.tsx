import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BoardDetailClient } from "@/components/observer/board-detail-client";
import { Button } from "@/components/ui/button";
import { RiCheckboxCircleLine } from "@remixicon/react";

type Props = { params: Promise<{ boardId: string }> };

export default async function BoardDetailPage({ params }: Props) {
  const user = await requireAuth();
  const { boardId } = await params;

  const [board] = await db
    .select()
    .from(observerBoards)
    .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

  if (!board) notFound();

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

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
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{board.name}</BreadcrumbPage>
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
        <BoardDetailClient board={board} initialMembers={members} />
      </main>
    </div>
  );
}
