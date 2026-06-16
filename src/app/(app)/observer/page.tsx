import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { BoardsListClient } from "@/components/observer/boards-list-client";

export default async function ObserverPage() {
  const user = await requireAuth();

  const boards = await db
    .select({
      id: observerBoards.id,
      name: observerBoards.name,
      description: observerBoards.description,
      managerName: observerBoards.managerName,
      managerEmail: observerBoards.managerEmail,
      createdBy: observerBoards.createdBy,
      createdAt: observerBoards.createdAt,
      updatedAt: observerBoards.updatedAt,
    })
    .from(observerBoards)
    .orderBy(desc(observerBoards.updatedAt));

  const allMembers =
    boards.length > 0
      ? await db
          .select({
            boardId: observerBoardMembers.boardId,
            id: observerBoardMembers.id,
          })
          .from(observerBoardMembers)
      : [];

  const countMap: Record<string, number> = {};
  for (const b of boards) countMap[b.id] = 0;
  for (const m of allMembers) {
    if (m.boardId in countMap) countMap[m.boardId]++;
  }

  const boardsWithCount = boards.map((b) => ({
    ...b,
    memberCount: countMap[b.id] ?? 0,
    isOwned: b.createdBy === user.id,
  }));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader className="bg-white dark:bg-zinc-900">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Team Pulse</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-5xl mx-auto">
          <BoardsListClient initialBoards={boardsWithCount} />
        </div>
      </main>
    </div>
  );
}
