"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiAddLine,
  RiTeamLine,
  RiArrowRightLine,
  RiDeleteBin6Line,
  RiEdit2Line,
  RiMoreLine,
  RiSearchLine,
  RiUserLine,
  RiExternalLinkLine,
  RiLoader4Line,
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
  managerName: string | null;
  managerEmail: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  isOwned: boolean;
};

type PersonResult = {
  name: string;
  email: string;
};

// ---------------------------------------------------------------------------
// People search
// ---------------------------------------------------------------------------
function PeopleSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/observer/people/search?q=${encodeURIComponent(query)}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
          setOpen(data.length > 0);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function avatarInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <RiSearchLine
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        {loading && (
          <RiLoader4Line
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
          />
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any team member…"
          className="w-full h-9 pl-8 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-50 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-zinc-100 dark:border-zinc-800">
            People
          </p>
          {results.map((person) => (
            <Link
              key={person.email}
              href={`/observer/developer/${encodeURIComponent(person.email)}`}
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group"
            >
              <div className="size-7 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500 shrink-0">
                {avatarInitials(person.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {person.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {person.email}
                </p>
              </div>
              <RiExternalLinkLine
                size={13}
                className="text-zinc-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function BoardsListClient({ initialBoards }: Props) {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBoard, setEditBoard] = useState<Board | null>(null);
  const [deleteBoard, setDeleteBoard] = useState<Board | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const myBoards = boards.filter((b) => b.isOwned);
  const otherBoards = boards.filter((b) => !b.isOwned);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/observer/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          managerName: managerName.trim() || undefined,
          managerEmail: managerEmail.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const board = await res.json();
      setBoards((prev) => [{ ...board, memberCount: 0, isOwned: true }, ...prev]);
      setCreateOpen(false);
      resetForm();
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
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          managerName: managerName.trim() || undefined,
          managerEmail: managerEmail.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      setBoards((prev) =>
        prev.map((b) =>
          b.id === updated.id
            ? {
                ...b,
                name: updated.name,
                description: updated.description,
                managerName: updated.managerName,
                managerEmail: updated.managerEmail,
              }
            : b
        )
      );
      setEditBoard(null);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteBoard) return;
    const res = await fetch(`/api/observer/boards/${deleteBoard.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== deleteBoard.id));
    }
    setDeleteBoard(null);
  }

  function openEdit(board: Board) {
    setEditBoard(board);
    setName(board.name);
    setDescription(board.description ?? "");
    setManagerName(board.managerName ?? "");
    setManagerEmail(board.managerEmail ?? "");
  }

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function resetForm() {
    setName("");
    setDescription("");
    setManagerName("");
    setManagerEmail("");
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Team Pulse
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Track what your team is working on, spot risks early, and stay on top of delivery.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0 gap-1.5">
          <RiAddLine size={16} />
          New Board
        </Button>
      </div>

      {/* Search */}
      <div className="mb-8">
        <PeopleSearch />
      </div>

      {boards.length === 0 ? (
        <EmptyState onCreateClick={openCreate} />
      ) : (
        <div className="space-y-8">
          {myBoards.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-3">
                My Boards
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myBoards.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    canEdit
                    onEdit={() => openEdit(board)}
                    onDelete={() => setDeleteBoard(board)}
                  />
                ))}
              </div>
            </section>
          )}

          {otherBoards.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-3">
                Other Teams
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherBoards.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    canEdit={false}
                    onEdit={() => {}}
                    onDelete={() => {}}
                  />
                ))}
              </div>
            </section>
          )}
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
              <Label htmlFor="board-desc">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="board-desc"
                placeholder="Brief description of this team or group..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mgr-name">Manager name</Label>
                <Input
                  id="mgr-name"
                  placeholder="e.g. Nikhil Agarwal"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mgr-email">Manager email</Label>
                <Input
                  id="mgr-email"
                  type="email"
                  placeholder="nikhil@salescode.ai"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-mgr-name">Manager name</Label>
                <Input
                  id="edit-mgr-name"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-mgr-email">Manager email</Label>
                <Input
                  id="edit-mgr-email"
                  type="email"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBoard(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteBoard}
        onOpenChange={(o) => !o && setDeleteBoard(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteBoard?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the board and remove all its members.
              This action cannot be undone.
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

// ---------------------------------------------------------------------------
// Board card
// ---------------------------------------------------------------------------
function BoardCard({
  board,
  canEdit,
  onEdit,
  onDelete,
}: {
  board: Board;
  canEdit: boolean;
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
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
              {board.memberCount} {board.memberCount === 1 ? "member" : "members"}
            </span>
          </div>
        </div>

        {canEdit && (
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
        )}
      </div>

      {board.description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-3">
          {board.description}
        </p>
      )}

      {board.managerName && (
        <div className="flex items-center gap-1.5 mb-3">
          <RiUserLine size={11} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            {board.managerName}
          </span>
        </div>
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
        Create a board to group your team members and get a unified view of
        their Jira tasks and productivity.
      </p>
      <Button onClick={onCreateClick} className="gap-1.5">
        <RiAddLine size={16} />
        Create Your First Board
      </Button>
    </div>
  );
}

type Props = {
  initialBoards: Board[];
};
