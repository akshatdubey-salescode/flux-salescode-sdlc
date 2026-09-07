"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { RiDeleteBinLine, RiPencilLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { initials } from "@/components/project-tracking/helpers";
import { MAX_SPRINT_NOTE_LENGTH } from "@/lib/sprints/notes";
import type { SprintNoteRow } from "@/lib/sprints/entries";
import { Tip } from "./tip";

/**
 * The sprint's note log — the running record kept by whoever is driving the
 * sprint: blockers, decisions, standup takeaways, why a date moved.
 *
 * Sibling of ItemCommentsModal, and deliberately the other half of the same
 * idea: that one is per ISSUE and writes through to Jira (Jira owns issue
 * discussion); this one is per SPRINT and lives in Flux, because these
 * projects have no real Jira sprint to comment on.
 *
 * The notes arrive on the sprint payload, so there's no fetch here — every
 * mutation calls onChanged() and the parent's reload brings the new list.
 */
export function SprintNotesDialog({
  sprintId,
  sprintName,
  notes,
  canManage,
  onChanged,
  open,
  onOpenChange,
}: {
  sprintId: string;
  sprintName: string;
  /** Oldest-first, as the read layer returns them. */
  notes: SprintNoteRow[];
  /** Sprint managers can delete anyone's note; authors can always manage their own. */
  canManage: boolean;
  onChanged: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: session } = useSession();
  // users.id IS the email (see lib/auth/server) — that's what authorId holds.
  const viewerId = session?.user?.email?.toLowerCase() ?? null;

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SprintNoteRow | null>(null);

  // Reopening the dialog should never resume someone else's half-finished
  // edit from the last time it was open.
  useEffect(() => {
    if (open) {
      setEditingId(null);
      setEditDraft("");
    }
  }, [open]);

  // Newest first: you open the log to see where the sprint stands right now,
  // and it matches the issue comment modal sitting one click away.
  const ordered = [...notes].reverse();

  async function handlePost() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error ?? "Failed to add note");
        return;
      }
      setDraft("");
      onChanged();
    } finally {
      setPosting(false);
    }
  }

  async function handleSaveEdit(noteId: string) {
    const body = editDraft.trim();
    if (!body) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error ?? "Failed to save note");
        return;
      }
      setEditingId(null);
      setEditDraft("");
      onChanged();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(noteId: string) {
    const res = await fetch(`/api/sprints/${sprintId}/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error ?? "Failed to delete note");
      return;
    }
    setDeleteTarget(null);
    onChanged();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Sprint notes</DialogTitle>
            <DialogDescription className="truncate">
              {sprintName} — blockers, decisions and anything about the sprint itself. Per-issue
              discussion still belongs on the Jira issue.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {ordered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No notes yet — the first one is usually why this sprint looks the way it does.
              </p>
            ) : (
              ordered.map((note) => {
                const isAuthor = viewerId !== null && note.authorId.toLowerCase() === viewerId;
                const editing = editingId === note.id;
                return (
                  <div key={note.id} className="group rounded-md border border-border/60 p-2.5">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">
                        {initials(note.authorName)}
                      </span>
                      <span className="text-[11px] font-medium">{note.authorName ?? note.authorId}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(note.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {note.editedAt && (
                        <Tip
                          label={`Edited ${new Date(note.editedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`}
                        >
                          <span className="text-[10px] text-muted-foreground">(edited)</span>
                        </Tip>
                      )}
                      <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {isAuthor && !editing && (
                          <Tip label="Edit this note">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setEditingId(note.id);
                                setEditDraft(note.body);
                              }}
                            >
                              <RiPencilLine className="size-3.5" />
                            </Button>
                          </Tip>
                        )}
                        {(isAuthor || canManage) && (
                          <Tip label="Delete this note">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget(note)}
                            >
                              <RiDeleteBinLine className="size-3.5 text-destructive" />
                            </Button>
                          </Tip>
                        )}
                      </span>
                    </div>

                    {editing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          maxLength={MAX_SPRINT_NOTE_LENGTH}
                          rows={3}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={!editDraft.trim() || savingEdit}
                            onClick={() => handleSaveEdit(note.id)}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{note.body}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_SPRINT_NOTE_LENGTH}
              placeholder="What happened in the sprint today? Blockers, decisions, anything worth remembering at review…"
              rows={3}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                Visible to everyone with access to this sprint.
              </span>
              <Button size="sm" disabled={!draft.trim() || posting} onClick={handlePost}>
                {posting ? "Adding…" : "Add note"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops showing on the sprint. The row is kept in the database, so who wrote what is
              never lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
