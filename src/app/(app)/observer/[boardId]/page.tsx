import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BoardDetailClient } from "@/components/observer/board-detail-client";

type Props = {
  params: Promise<{ boardId: string }>;
  // Set when this team was reached by drilling down from another team's member,
  // so we can show a breadcrumb back to that parent team.
  searchParams: Promise<{ parentBoardId?: string; parentName?: string }>;
};

export default async function BoardDetailPage({ params, searchParams }: Props) {
  const user = await requireAuth();
  const { boardId } = await params;
  const { parentBoardId, parentName } = await searchParams;

  const [board] = await db
    .select()
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId));

  if (!board) notFound();

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  // Resolve the board THIS viewer manages, to target "Track on my board" adds.
  // A viewer manages a board when they are its designated MANAGER
  // (managerEmail == them) — NOT merely its creator. Matching createdBy here was
  // a bug: a superuser who bulk-provisions is the creator of *every* board, so
  // createdBy matched dozens of boards and "latest updated" picked an unrelated
  // one — adds landed on the wrong team. managerEmail resolves to their own team.
  const [managed] = await db
    .select({ id: observerBoards.id, name: observerBoards.name })
    .from(observerBoards)
    .where(sql`lower(${observerBoards.managerEmail}) = ${user.email.toLowerCase()}`)
    .orderBy(desc(observerBoards.updatedAt))
    .limit(1);

  // Fallback for a hand-made board that never had its manager email set: use it
  // only when the viewer created EXACTLY ONE board, so there's no ambiguity to
  // resolve wrong (a bulk-provisioner has many, so they get no fallback).
  let viewerBoard = managed;
  if (!viewerBoard) {
    const created = await db
      .select({ id: observerBoards.id, name: observerBoards.name })
      .from(observerBoards)
      .where(eq(observerBoards.createdBy, user.id))
      .limit(2);
    if (created.length === 1) viewerBoard = created[0];
  }

  // When the viewer's board differs from the one being viewed, the timeline
  // offers a per-member "Track on my board" action so the manager can pull
  // anyone shown here (e.g. a report's sub-team member) onto their own board.
  // Their board's current members seed the "tracked" markers.
  let addTarget: {
    boardId: string;
    boardName: string;
    members: { id: string; email: string }[];
  } | null = null;
  if (viewerBoard && viewerBoard.id !== boardId) {
    const viewerMembers = await db
      .select({ id: observerBoardMembers.id, email: observerBoardMembers.email })
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.boardId, viewerBoard.id));
    addTarget = {
      boardId: viewerBoard.id,
      boardName: viewerBoard.name,
      members: viewerMembers.map((m) => ({ ...m, email: m.email.toLowerCase() })),
    };
  }

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
            <BreadcrumbSeparator />
            {parentBoardId && parentName && (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/observer/${parentBoardId}`}>{parentName}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage>{board.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <BoardDetailClient
          board={board}
          initialMembers={members}
          isOwner={board.createdBy === user.id || board.managerEmail?.toLowerCase() === user.email.toLowerCase()}
          addTarget={addTarget}
          canManageSprints={canManageDeliveries(user)}
        />
      </main>
    </div>
  );
}
