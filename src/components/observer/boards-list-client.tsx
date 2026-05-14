"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiAddLine,
  RiTeamLine,
  RiArrowRightLine,
  RiDeleteBin6Line,
  RiEdit2Line,
  RiMoreLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDistanceToNow } from "date-fns";

type Board = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
};

type Props = {
  initialBoards: Board[];
};

export function BoardsListClient({ initialBoards }: Props) {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBoard, setEditBoard] = useState<Board | null>(null);
  const [deleteBoard, setDeleteBoard] = useState<Board | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/observer/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      const board = await res.json();
      setBoards((prev) => [{ ...board, memberCount: 0 }, ...prev]);
      setCreateOpen(false);
      setName("");
      setDescription("");
      router.push(`/observer/${board.id}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editBoard || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/observer/boards/${editBoard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      setBoards((prev) =>
        prev.map((b) => (b.id === updated.id ? { ...b, name: updated.name, description: updated.description } : b))
      );
      setEditBoard(null);
      setName("");
      setDescription("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteBoard) return;
    const res = await fetch(`/api/observer/boards/${deleteBoard.id}`, { method: "DELETE" });
    if (res.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== deleteBoard.id));
    }
    setDeleteBoard(null);
  }

  function openEdit(board: Board) {
    setEditBoard(board);
    setName(board.name);
    setDescription(board.description ?? "");
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Team Observer
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Create custom boards to monitor your team&apos;s workload and productivity.
          </p>
        </div>
        <Button onClick={() => { setName(""); setDescription(""); setCreateOpen(true); }} className="shrink-0 gap-1.5">
          <RiAddLine size={16} />
          New Board
        </Button>
      </div>

      {boards.length === 0 ? (
        <EmptyState onCreateClick={() => { setName(""); setDescription(""); setCreateOpen(true); }} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onEdit={() => openEdit(board)}
              onDelete={() => setDeleteBoard(board)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Observer Board</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Board name</Label>
              <Input
                id="board-name"
                placeholder="e.g. Promotions Team"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="board-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="board-desc"
                placeholder="Brief description of this team or group..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? "Creating…" : "Create Board"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editBoard} onOpenChange={(o) => !o && setEditBoard(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Board</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Board name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBoard(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteBoard} onOpenChange={(o) => !o && setDeleteBoard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteBoard?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the board and remove all its members. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete Board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BoardCard({
  board,
  onEdit,
  onDelete,
}: {
  board: Board;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-zinc-200/60 bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-zinc-300 dark:border-zinc-800/60 dark:bg-zinc-900/50">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary border border-primary/10 transition-colors group-hover:bg-primary/10">
            <RiTeamLine size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-50 truncate leading-tight tracking-tight">
              {board.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                {board.memberCount} {board.memberCount === 1 ? "member" : "members"}
              </span>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <RiMoreLine size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit} className="gap-2">
              <RiEdit2Line size={14} />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <RiDeleteBin6Line size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {board.description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-6 h-10">
          {board.description}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800/60">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">
            Last Updated
          </span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {formatDistanceToNow(new Date(board.updatedAt), { addSuffix: true })}
          </span>
        </div>
        <Link
          href={`/observer/${board.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-xs font-bold transition-transform hover:scale-105"
        >
          View Board
          <RiArrowRightLine size={14} />
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 mb-4">
        <RiTeamLine size={28} className="text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
        No observer boards yet
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mb-6">
        Create a board to group your team members and get a unified view of their Jira tasks and productivity.
      </p>
      <Button onClick={onCreateClick} className="gap-1.5">
        <RiAddLine size={16} />
        Create Your First Board
      </Button>
    </div>
  );
}
